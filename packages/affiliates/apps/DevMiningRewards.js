// This file is meant to be run in the command line. It takes in a configuration to generate
// final deployer reward output.
// example: node apps/DevMiningRewards ./config.example.js --network=mainnet_mnemonic >> output.json
require("dotenv").config();
const assert = require("assert");
const { getAbi } = require("@uma/contracts-node");
const { BigQuery } = require("@google-cloud/bigquery");
const Promise = require("bluebird");
const Web3 = require("web3");

const { DevMining } = require("../libs/affiliates");
const { Emp } = require("../libs/contracts");
const Queries = require("../libs/bigquery");
const Coingecko = require("../libs/coingecko");
const SynthPrices = require("../libs/synthPrices");

const { makeUnixPipe } = require("../libs/affiliates/utils");

// dont know why, but the common getWeb3 is causing contract calls to fail
function getWeb3() {
  return new Web3(process.env.CUSTOM_NODE_URL);
}

// TODO: stub. There is a function being introduced in another PR in common that will do this for us.
// eslint-disable-next-line no-unused-vars
function getContractsNodePackageAliasForVerion(_version) {
  return "@uma/contracts-node";
}

function getEmpAbiForVersion(version) {
  const packageName = getContractsNodePackageAliasForVerion(version);
  const { getAbi } = require(packageName);
  return getAbi("ExpiringMultiParty");
}

const v1 = async (env, params, DevMining) => {
  const web3 = getWeb3();
  const { config } = params;
  assert(config, "requires config object on params");
  let { empWhitelist = [], startTime, endTime, totalRewards, fallbackPrices } = config;
  assert(empWhitelist, "requires whitelist");
  assert(startTime, "requires startTime");
  assert(endTime, "requires endTime");
  assert(totalRewards, "requires totalRewards");

  const client = new BigQuery();
  const queries = Queries({ client });
  const coingecko = Coingecko();
  const synthPrices = SynthPrices({
    web3,
    cryptowatchApiKey: env.CRYPTOWATCH_KEY,
    tradermadeApiKey: env.TRADERMADE_KEY,
  });

  const rewards = DevMining({ queries, coingecko, synthPrices });

  // This just sets a default abi version in case no abi is passed along with the emp address.
  // This should default to the latest version
  const defaultEmpAbi = getAbi("ExpiringMultiParty");

  // API has changed, we need to validate input. Emps will be required to include payout address.
  empWhitelist = empWhitelist.map((empInput) => {
    rewards.utils.validateEmpInput(empInput);
    // convert to standard eth checksum address otherwise lookups through BQ or web3 will fail
    // Allow for non standard payout address at empInput[1] since this has no impact on processing.
    let [empAddress, payoutAddress, empVersion] = empInput;

    // we want to make sure these addresses are standarized since we do many lookups internally
    empAddress = rewards.utils.toChecksumAddress(empAddress);

    // this converts a version number from the config into an abi which gets passed into the calculator
    // so each emp contract will have the correct abi passed along with it.
    const empAbi = empVersion ? getEmpAbiForVersion(empVersion) : defaultEmpAbi;

    return [empAddress, payoutAddress, empAbi];
  });

  fallbackPrices = fallbackPrices.map(([empAddress, price]) => {
    // convert to standard eth checksum address otherwise lookups through BQ or web3 will fail
    return [rewards.utils.toChecksumAddress(empAddress), price];
  });

  // get emp info
  const { collateralTokens, collateralTokenDecimals, syntheticTokenDecimals, syntheticTokens } = await Promise.reduce(
    empWhitelist,
    async (result, [empAddress, , abi]) => {
      const emp = Emp({ web3, abi });
      // switch this to tokenInfo if you want to base prices off tokens
      const collateralInfo = await emp.collateralInfo(empAddress);
      result.collateralTokens.push(collateralInfo.address);
      result.collateralTokenDecimals.push(collateralInfo.decimals);

      const syntheticInfo = await emp.tokenInfo(empAddress);
      result.syntheticTokenDecimals.push(syntheticInfo.decimals);
      result.syntheticTokens.push(syntheticInfo.address);
      return result;
    },
    { collateralTokens: [], collateralTokenDecimals: [], syntheticTokenDecimals: [], syntheticTokens: [] }
  );

  const result = await rewards.getRewards({
    totalRewards,
    startTime,
    endTime,
    empWhitelist,
    collateralTokens,
    collateralTokenDecimals,
    syntheticTokens,
    syntheticTokenDecimals,
    fallbackPrices,
  });

  return {
    ...params,
    // result will contain deployer rewards as well as per emp rewards
    result,
  };
};

const v2 = async (env, params, DevMining) => {
  const web3 = getWeb3();
  const { config } = params;
  assert(config, "requires config object on params");
  let { empWhitelist = [], startTime, endTime, totalRewards } = config;
  assert(empWhitelist, "requires whitelist");
  assert(startTime, "requires startTime");
  assert(endTime, "requires endTime");
  assert(totalRewards, "requires totalRewards");

  const client = new BigQuery();
  const queries = Queries({ client });
  const coingecko = Coingecko();

  const rewards = DevMining({ queries, coingecko });

  // This just sets a default abi version in case no abi is passed along with the emp address.
  // This should default to the latest version
  const defaultEmpAbi = getAbi("ExpiringMultiParty");

  // API has changed, we need to validate input. Emps will be required to include payout address.
  empWhitelist = empWhitelist.map((empInput) => {
    rewards.utils.validateEmpInput(empInput);
    // convert to standard eth checksum address otherwise lookups through BQ or web3 will fail
    // Allow for non standard payout address at empInput[1] since this has no impact on processing.
    let [empAddress, payoutAddress, empVersion] = empInput;

    // we want to make sure these addresses are standarized since we do many lookups internally
    empAddress = rewards.utils.toChecksumAddress(empAddress);

    // this converts a version number from the config into an abi which gets passed into the calculator
    // so each emp contract will have the correct abi passed along with it.
    const empAbi = empVersion ? getEmpAbiForVersion(empVersion) : defaultEmpAbi;

    return [empAddress, payoutAddress, empAbi];
  });

  // get emp info
  const { collateralTokens, collateralTokenDecimals } = await Promise.reduce(
    empWhitelist,
    async (result, [empAddress, , abi]) => {
      const emp = Emp({ web3, abi });
      // switch this to tokenInfo if you want to base prices off tokens
      const collateralInfo = await emp.collateralInfo(empAddress);
      result.collateralTokens.push(collateralInfo.address);
      result.collateralTokenDecimals.push(collateralInfo.decimals);
      return result;
    },
    { collateralTokens: [], collateralTokenDecimals: [] }
  );

  const result = await rewards.getRewards({
    totalRewards,
    startTime,
    endTime,
    empWhitelist,
    collateralTokens,
    collateralTokenDecimals,
  });

  return {
    ...params,
    // result will contain deployer rewards as well as per emp rewards
    result,
  };
};

// This is the main function which configures all data sources for the calculation.
const App = (env) => async (params) => {
  const { version = "v2" } = env;
  assert(
    DevMining[version],
    "Invalid version in DevMining config, must be one of: " + Object.keys(DevMining).join(", ")
  );
  const devMining = DevMining[version];
  switch (version) {
    case "v1": {
      return v1(env, params, devMining);
    }
    case "v2": {
      return v2(env, params, devMining);
    }
    default:
      throw new Error("Invalid version number: " + version);
  }
};

makeUnixPipe(App(process.env))
  .then(console.log)
  .catch(console.error)
  .finally(() => process.exit());

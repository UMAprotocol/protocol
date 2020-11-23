// This file is meant to be run in the command line. It takes in a configuration to generate
// final deployer reward output.
// example: node apps/DeployerRewards ./config.example.js --network=mainnet_mnemonic >> output.json
const assert = require("assert");
const { getAbi, getAddress } = require("@uma/core");
const { BigQuery } = require("@google-cloud/bigquery");
const Promise = require("bluebird");

const Config = require("../libs/config");
const { DeployerRewards } = require("../libs/affiliates");
const { Emp } = require("../libs/contracts");
const Queries = require("../libs/bigquery");
const Coingecko = require("../libs/coingecko");
const SynthPrices = require("../libs/synthPrices");
const { getWeb3 } = require("@uma/common");

// This is the main function which configures all data sources for the calculation.
async function App(config) {
  const web3 = getWeb3();
  const { empWhitelist = [], startTime, endTime, totalRewards, network = 1 } = config;
  assert(empWhitelist, "requires whitelist");
  assert(startTime, "requires startTime");
  assert(endTime, "requires endTime");
  assert(totalRewards, "requires totalRewards");

  // this needs alookup by network
  const empCreator = getAddress("ExpiringMultiPartyCreator", network);
  const empAbi = getAbi("ExpiringMultiParty");
  const empCreatorAbi = getAbi("ExpiringMultiPartyCreator");

  const emp = Emp({ web3 });
  const client = new BigQuery();
  const queries = Queries({ client });
  const coingecko = Coingecko();
  const synthPrices = SynthPrices({ web3 });

  const rewards = DeployerRewards({
    queries,
    empCreatorAbi,
    empAbi,
    coingecko,
    synthPrices
  });

  // get emp info
  const { collateralTokens, collateralTokenDecimals, syntheticTokenDecimals } = await Promise.reduce(
    empWhitelist,
    async (result, address) => {
      // switch this to tokenInfo if you want to base prices off tokens
      const collateralInfo = await emp.collateralInfo(address);
      result.collateralTokens.push(collateralInfo.address);
      result.collateralTokenDecimals.push(collateralInfo.decimals);

      const syntheticInfo = await emp.tokenInfo(address);
      result.syntheticTokenDecimals.push(syntheticInfo.decimals);
      return result;
    },
    { collateralTokens: [], collateralTokenDecimals: [], syntheticTokenDecimals: [] }
  );

  const result = await rewards.getRewards({
    totalRewards,
    startTime,
    endTime,
    empWhitelist,
    empCreatorAddress: empCreator,
    collateralTokens,
    collateralTokenDecimals,
    syntheticTokenDecimals
  });

  return {
    config,
    // result will contain deployer rewards as well as per emp rewards
    ...result
  };
}

const config = Config();

App(config)
  .then(console.log)
  .catch(console.error)
  // Process hangs if not forcibly closed. Unknown how to disconnect web3 or bigquery client.
  .finally(() => process.exit());

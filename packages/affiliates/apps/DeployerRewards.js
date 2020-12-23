// This file is meant to be run in the command line. It takes in a configuration to generate
// final deployer reward output.
// example: node apps/DeployerRewards ./config.example.js --network=mainnet_mnemonic >> output.json
const assert = require("assert");
const { getAbi } = require("@uma/core");
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
  let { empWhitelist = [], startTime, endTime, totalRewards } = config;
  assert(empWhitelist, "requires whitelist");
  assert(startTime, "requires startTime");
  assert(endTime, "requires endTime");
  assert(totalRewards, "requires totalRewards");

  const empAbi = getAbi("ExpiringMultiParty");

  const emp = Emp({ web3 });
  const client = new BigQuery();
  const queries = Queries({ client });
  const coingecko = Coingecko();
  const synthPrices = SynthPrices({ web3 });

  const rewards = DeployerRewards({
    queries,
    empAbi,
    coingecko,
    synthPrices
  });

  // API has changed, we need to validate input. Emps will be required to include payout address.
  empWhitelist = empWhitelist.map(empInput => {
    rewards.utils.validateEmpInput(empInput);
    // convert to standard eth checksum address otherwise lookups through BQ or web3 will fail
    return empInput.map(rewards.utils.toChecksumAddress);
  });

  // get emp info
  const { collateralTokens, collateralTokenDecimals, syntheticTokenDecimals, syntheticTokens } = await Promise.reduce(
    empWhitelist,
    async (result, [empAddress]) => {
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
  .then(x => console.log(JSON.stringify(x, null, 2)))
  .catch(console.error)
  // Process hangs if not forcibly closed. Unknown how to disconnect web3 or bigquery client.
  .finally(() => process.exit());

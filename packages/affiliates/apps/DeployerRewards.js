// run as node apps/DeployerRewards ./config.example.js >> output.json
const assert = require("assert");
const { getAbi, getAddress } = require("@uma/core");
const { BigQuery } = require("@google-cloud/bigquery");
const Promise = require("bluebird");

const Start = require("../libs/start");
const { DeployerRewards } = require("../libs/affiliates");
const { Emp } = require("../libs/contracts");
const Queries = require("../libs/bigquery");
const Coingecko = require("../libs/coingecko");

async function App(config, { web3 }) {
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

  const rewards = DeployerRewards({
    queries,
    coingecko,
    empAbi,
    empCreatorAbi
  });

  // get emp info
  const { tokensToPrice, tokenDecimals } = await Promise.reduce(
    empWhitelist,
    async (result, address) => {
      // switch this to tokenInfo if you want to base prices off tokens
      const info = await emp.collateralInfo(address);
      result.tokensToPrice.push(info.address);
      result.tokenDecimals.push(info.decimals);
      return result;
    },
    { tokensToPrice: [], tokenDecimals: [] }
  );

  const result = await rewards.getRewards({
    empWhitelist,
    startTime,
    endTime,
    empCreatorAddress: empCreator,
    tokensToPrice,
    tokenDecimals,
    totalRewards
  });

  return {
    config,
    result
  };
}

Start(App)
  .then(console.log)
  .catch(console.error);

require("dotenv").config();
const { getWeb3 } = require("@uma/common");
const { getAbi } = require("@uma/core");
const { BigQuery } = require("@google-cloud/bigquery");

const { DappMining } = require("../libs/affiliates");
const Queries = require("../libs/bigquery");
const { makeUnixPipe } = require("../libs/affiliates/utils");

// This is the main function which configures all data sources for the calculation.
const App = async params => {
  const { config } = params;
  const web3 = getWeb3();

  const empAbi = getAbi("ExpiringMultiParty");
  const client = new BigQuery();
  const queries = Queries({ client });

  const dappmining = DappMining({ empAbi, queries, web3 });
  const result = await dappmining.getRewards(config);

  return {
    ...params,
    result
  };
};

makeUnixPipe(App)
  .then(console.log)
  .catch(console.error)
  .finally(() => process.exit());

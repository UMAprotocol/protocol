const { getWeb3 } = require("@uma/common");
const { getAbi } = require("@uma/core");
const { BigQuery } = require("@google-cloud/bigquery");

const Config = require("../libs/config");
const { DappMining } = require("../libs/affiliates");
const Queries = require("../libs/bigquery");

// This is the main function which configures all data sources for the calculation.
async function App(config) {
  const web3 = getWeb3();

  const empAbi = getAbi("ExpiringMultiParty");
  const client = new BigQuery();
  const queries = Queries({ client });

  const dappmining = DappMining({ empAbi, queries, web3 });
  const result = await dappmining.getRewards(config);

  return {
    config,
    ...result
  };
}

const config = Config();

App(config)
  .then(x => console.log(JSON.stringify(x, null, 2)))
  .catch(console.error)
  // Process hangs if not forcibly closed. Unknown how to disconnect web3 or bigquery client.
  .finally(() => process.exit());

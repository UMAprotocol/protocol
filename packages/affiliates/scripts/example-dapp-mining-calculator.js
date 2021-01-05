const { BigQuery } = require("@google-cloud/bigquery");
const { getWeb3 } = require("@uma/common");
const { getAbi } = require("@uma/core");
const { DappMining } = require("../libs/affiliates");
const Queries = require("../libs/bigquery");

const web3 = getWeb3();

// See this file for what the config parameters are
const config = require("../dappmining-config.example");

const client = new BigQuery();
const queries = Queries({ client });
const empAbi = getAbi("ExpiringMultiParty");

DappMining({ queries, empAbi, web3 })
  .getRewards(config)
  .then(console.log)
  .catch(console.log);

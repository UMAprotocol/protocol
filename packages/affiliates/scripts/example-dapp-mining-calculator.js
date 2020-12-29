const { BigQuery } = require("@google-cloud/bigquery");
const { getWeb3 } = require("@uma/common");
const moment = require("moment");
const { getAbi } = require("@uma/core");
const { DappMining } = require("../libs/affiliates");
const Queries = require("../libs/bigquery");

const web3 = getWeb3();

const empAddress = "0xE4256C47a3b27a969F25de8BEf44eCA5F2552bD5";
const defaultAddress = "0xa0dfF1F09a0DCEda7641b7eB07c3BDbe66a06C35";
const whitelist = ["0x9a9dcd6b52b45a78cd13b395723c245dabfbab71"];
const startTime = moment("2020-12-12", "YYYY-MM-DD").valueOf();
const endTime = moment("2020-12-25", "YYYY-MM-DD").valueOf();
const totalRewards = 25000;

const client = new BigQuery();
const queries = Queries({ client });
const empAbi = getAbi("ExpiringMultiParty");

DappMining({ queries, empAbi, web3 })
  .getRewards({
    empAddress,
    startTime,
    endTime,
    defaultAddress,
    whitelist,
    totalRewards
  })
  .then(console.log)
  .catch(console.log);

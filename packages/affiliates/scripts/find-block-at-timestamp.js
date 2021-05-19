const moment = require("moment");
const FindBlockAtTimestamp = require("@uma/core/scripts/liquidity-mining/FindBlockAtTimeStamp");
const { getWeb3 } = require("@uma/common");
const { BigQuery } = require("@google-cloud/bigquery");
const Queries = require("../libs/bigquery");

// const timeStr = "2020-11-02 23:00:00"
const timeStr = "2020-11-10 23:00:00";
const time = moment(timeStr, "YYYY-MM-DD  HH:mm Z").valueOf(); // utc timestamp

async function run() {
  const client = new BigQuery();
  const queries = Queries({ client });
  const web3 = getWeb3();
  const [a, b] = await Promise.all([
    queries.getBlocks(time, time + 30000, ["timestamp", "number"]),
    FindBlockAtTimestamp._findBlockNumberAtTimestamp(web3, Number(time / 1000)),
  ]);
  console.log(timeStr, a, b);
}

run().then(console.log).catch(console.log);

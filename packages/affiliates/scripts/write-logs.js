// Generates a sample logs file uUSDwETH-DEC-logs.json containing mocked transaction logs. Used in  testing so the
// scripts dont need to rerun the GCP big query.

const { BigQuery } = require("@google-cloud/bigquery");
const Queries = require("../libs/bigquery");
const moment = require("moment");
const highland = require("highland");
const Path = require("path");
const fs = require("fs");

// uUSDwETH Synthetic Token Expiring  uUSDwETH-DEC
const empContract = "0x3605Ec11BA7bD208501cbb24cd890bC58D2dbA56";
const dir = Path.join(__dirname, "../datasets/uUSDwETH-DEC-logs.json");
const start = moment("9/20/2020", "MM/DD/YYYY").valueOf();
const end = moment("10/20/2020", "MM/DD/YYYY").valueOf();

const client = new BigQuery();
const queries = Queries({ client });

async function runTest() {
  const queryStream = highland(await queries.streamLogsByContract(empContract, start, end))
    .map(JSON.stringify)
    .intersperse(",\n");
  const writeStream = fs.createWriteStream(dir);

  return new Promise(res => {
    highland(["[\n", queryStream])
      .append("]\n")
      .flatten()
      .pipe(writeStream)
      .on("done", res);
  });
}

runTest()
  .then(console.log)
  .catch(console.log);

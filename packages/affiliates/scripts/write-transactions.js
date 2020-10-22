// Generates a sample transactions file uUSDwETH-DEC-transactions.json containing mocked tagged function calls. Used in
// testing so the scripts dont need to rerun the GCP big query.

const { BigQuery } = require("@google-cloud/bigquery");
const Queries = require('../libs/bigquery')
const moment = require("moment");
const highland = require("highland");
const assert = require("assert");
const Path = require("path");
const fs = require("fs");

// 64 `f`s followed by 40 `0`s to define a unique tagging prefix for sample set.
const tagPrefex = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff000000000000000000000000";

// uUSDwETH Synthetic Token Expiring  uUSDwETH-DEC
const empContract = "0x3605Ec11BA7bD208501cbb24cd890bC58D2dbA56";
const start = moment("9/20/2020", "MM/DD/YYYY").valueOf()
const end = moment("10/20/2020", "MM/DD/YYYY").valueOf()
// Create a set of developes to tag in the sample transactions data set.
const developersToTag = [
  "0x3b39fdd79406db62d5418c220fa918d33e94f92e",
  "0xB9929435dAD8D6fFBAF1Ff3a62A925e7857b5381",
  "0x28205eec54180bd77c5263e9378e2db8baa92a95"
];
const dir = Path.join(__dirname, "../datasets/uUSDwETH-DEC-transactions.json");

const client = new BigQuery();
const queries = Queries({client})

async function runTest() {
  let tagIndex = 0;
  const queryStream = highland(await queries.streamTransactionsByContract(empContract,start,end))
    .map(log => {
      log.input = `${log.input}${tagPrefex}${developersToTag[tagIndex].substring(2, 42).toLowerCase()}`;
      tagIndex = (tagIndex + 1) % developersToTag.length; // increment the developer to tag index to get a fresh one next loop.
      return JSON.stringify(log);
    })
    .intersperse(",\n");
  const writeStream = fs.createWriteStream(dir);

  return new Promise((res, rej) => {
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

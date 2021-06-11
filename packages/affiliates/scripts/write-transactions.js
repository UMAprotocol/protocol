const { BigQuery } = require("@google-cloud/bigquery");
const Queries = require("../libs/bigquery");
const highland = require("highland");
const Path = require("path");
const fs = require("fs");
const Promise = require("bluebird");
const mkdirp = require("mkdirp");
const params = require("../test/datasets/set1");

const { empContracts, startingTimestamp, endingTimestamp } = params;

// 64 `f`s followed by 40 `0`s to define a unique tagging prefix for sample set.
const tagPrefex = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff000000000000000000000000";

// Create a set of developes to tag in the sample transactions data set.
const developersToTag = [
  "0x3b39fdd79406db62d5418c220fa918d33e94f92e",
  "0xB9929435dAD8D6fFBAF1Ff3a62A925e7857b5381",
  "0x28205eec54180bd77c5263e9378e2db8baa92a95",
];
const basePath = Path.join(__dirname, "../test/datasets");
const subDir = Path.join(basePath, params.name, "tagged-transactions");

const client = new BigQuery();
const queries = Queries({ client });

async function saveContractEvents(empContract) {
  let tagIndex = 0;
  const path = Path.join(subDir, `${empContract}.json`);
  const queryStream = highland(
    await queries.streamTransactionsByContract(empContract, startingTimestamp, endingTimestamp)
  )
    .map((log) => {
      log.input = `${log.input}${tagPrefex}${developersToTag[tagIndex].substring(2, 42).toLowerCase()}`;
      tagIndex = (tagIndex + 1) % developersToTag.length; // increment the developer to tag index to get a fresh one next loop.
      return JSON.stringify(log);
    })
    .intersperse(",\n");
  const writeStream = fs.createWriteStream(path);

  return new Promise((res) => {
    highland(["[\n", queryStream]).append("]\n").flatten().pipe(writeStream).on("done", res);
  });
}
async function run() {
  await mkdirp(subDir);
  await Promise.map(empContracts, saveContractEvents);
}

run().then(console.log).catch(console.log);

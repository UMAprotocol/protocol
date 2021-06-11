// Generates a sample logs file uUSDwETH-DEC-logs.json containing mocked transaction logs. Used in  testing so the
// scripts dont need to rerun the GCP big query.

const { BigQuery } = require("@google-cloud/bigquery");
const Queries = require("../libs/bigquery");
const Path = require("path");
const fs = require("fs");
const mkdirp = require("mkdirp");
const params = require("../test/datasets/set1");

const Promise = require("bluebird");

const { empContracts, startingTimestamp, endingTimestamp } = params;

const basePath = Path.join(__dirname, "../test/datasets");
const subDir = Path.join(basePath, params.name, "logs");

const client = new BigQuery();
const queries = Queries({ client });

async function runTest() {
  await mkdirp(subDir);
  await Promise.map(empContracts, async (contract) => {
    const data = await queries.getLogsByContract(contract, startingTimestamp, endingTimestamp);
    const path = Path.join(subDir, `${contract}.json`);
    console.log("writing", data.length, "events");
    fs.writeFileSync(path, JSON.stringify(data, null, 2));
  });
}

runTest().then(console.log).catch(console.log);

// Generates a sample deployers file uUSDwETH-DEC-deployers.json containing logs sent to the emp factor used to find the
// creator of a given EMP.

const { BigQuery } = require("@google-cloud/bigquery");
const Queries = require("../libs/bigquery");
const Path = require("path");
const fs = require("fs");
const mkdirp = require("mkdirp");
const params = require("../test/datasets/set1");

const { empCreator, startingTimestamp, endingTimestamp } = params;
const basePath = Path.join(__dirname, "../test/datasets");
const subDir = Path.join(basePath, params.name, "logs");
const path = Path.join(subDir, `${empCreator}.json`);

const client = new BigQuery();
const queries = Queries({ client });

async function runTest() {
  await mkdirp(subDir);
  const data = await queries.getLogsByContract(empCreator, startingTimestamp, endingTimestamp);
  console.log("wrote", data.length, "deployer events");
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

runTest().then(console.log).catch(console.log);

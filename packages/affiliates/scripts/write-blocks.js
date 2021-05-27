// Generates a sample deployers file uUSDwETH-DEC-deployers.json containing logs sent to the emp factor used to find the
// creator of a given EMP.

const { BigQuery } = require("@google-cloud/bigquery");
const Queries = require("../libs/bigquery");
const Path = require("path");
const fs = require("fs");
const mkdirp = require("mkdirp");
const params = require("../test/datasets/set1");

const { startingTimestamp, endingTimestamp } = params;
const basePath = Path.join(__dirname, "../test/datasets");
const subDir = Path.join(basePath, params.name, "blocks");
const path = Path.join(subDir, "index.json");

const client = new BigQuery();
const queries = Queries({ client });

async function runTest() {
  console.time("done");
  await mkdirp(subDir);
  const data = await queries.getBlocks(startingTimestamp, endingTimestamp, ["timestamp", "number"]);
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
  console.timeEnd("done");
  return `wrote ${data.length} blocks`;
}

runTest().then(console.log).catch(console.log);

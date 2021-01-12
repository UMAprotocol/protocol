// This creates a dataset to run dapp mining for testing or offline.
// Run with the example config node apps/CreatedappMiningDataset dappmining-config.example.js
// This ends up creating a new folder with files in it in
const assert = require("assert");
const { Dataset } = require("../libs/datasets");
const Config = require("../libs/config");
const { BigQuery } = require("@google-cloud/bigquery");
const Queries = require("../libs/bigquery");

async function Run(config) {
  assert(config.name, "requires a dataset name");
  const client = new BigQuery();
  const queries = Queries({ client });
  const ds = Dataset(config.datasetPath || process.cwd(), { queries });
  return ds.saveDappMining(config.name, config);
}

const config = Config();
Run(config)
  .then(console.log)
  .catch(console.error)
  .finally(() => process.exit());

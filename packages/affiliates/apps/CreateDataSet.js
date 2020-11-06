// saves a dataset to a folder. Users a config file, see example in createdataset.example.js
// outputs a path for you to load the mocks from.
// node apps/CreateDataSet.js ./createdataset.example.js
const { Dataset } = require("../libs/datasets");
const Config = require("../libs/config");
const { BigQuery } = require("@google-cloud/bigquery");
const Coingecko = require("../libs/coingecko");
const Queries = require("../libs/bigquery");

async function Run(config) {
  const client = new BigQuery();
  const queries = Queries({ client });
  const coingecko = Coingecko();
  const ds = Dataset(config.datasetPath || process.cwd(), { queries, coingecko });
  return ds.save(config.name, config);
}

const config = Config();
Run(config)
  .then(console.log)
  .catch(console.error);

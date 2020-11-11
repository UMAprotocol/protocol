// saves a dataset to a folder. Users a config file, see example in createdataset.example.js
// outputs a path for you to load the mocks from.
// node apps/CreateDataSet.js ./createdataset.example.js --network=mainnet_mnemonic
const { Dataset } = require("../libs/datasets");
const Config = require("../libs/config");
const { BigQuery } = require("@google-cloud/bigquery");
const Coingecko = require("../libs/coingecko");
const SynthPrices = require("../libs/synthPrices");
const Queries = require("../libs/bigquery");
const { getWeb3 } = require("@uma/common");

async function Run(config) {
  const web3 = getWeb3();
  const client = new BigQuery();
  const queries = Queries({ client });
  const coingecko = Coingecko();
  const synthPrices = SynthPrices({ web3 });
  const ds = Dataset(config.datasetPath || process.cwd(), { queries, coingecko, synthPrices });
  return ds.save(config.name, config);
}

const config = Config();
Run(config)
  .then(console.log)
  .catch(console.error)
  .finally(() => process.exit());

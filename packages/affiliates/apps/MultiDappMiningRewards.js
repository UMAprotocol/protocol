const lodash = require("lodash");
const Promise = require("bluebird");

const { getWeb3 } = require("@uma/common");
const { getAbi } = require("@uma/core");
const { BigQuery } = require("@google-cloud/bigquery");

const { DappMining } = require("../libs/affiliates");
const Queries = require("../libs/bigquery");
const {
  generateDappMiningConfig,
  dappMiningTemplate,
  createGithubIssue,
  saveToDisk,
  makeDappMiningFilename,
  makeUnixPipe
} = require("../libs/affiliates/utils");

// This runs the full pipeline for dapp mining all emps in the configuration.
// This will probably be deprecated in favor of a more composable approach.
// Currently theres no good "whitelist" available for dapp mining emps, like there is for dev mining.
const App = env => async params => {
  const web3 = getWeb3();

  const empAbi = getAbi("ExpiringMultiParty");
  const client = new BigQuery();
  const queries = Queries({ client });

  const dappmining = DappMining({ empAbi, queries, web3 });
  params = lodash.castArray(params);
  await Promise.map(params, async param => {
    const config = generateDappMiningConfig(param);
    const markdown = dappMiningTemplate(config);
    await createGithubIssue({ auth: env.github, ...markdown });
    const result = await dappmining.getRewards(config);
    const fn = makeDappMiningFilename(config);
    return saveToDisk(fn, { config, ...result });
  });
  return "done";
};

makeUnixPipe(App(process.env))
  .then(console.log)
  .catch(console.error);

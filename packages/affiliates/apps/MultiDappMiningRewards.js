const lodash = require("lodash");
const Promise = require("bluebird");
const fs = require("fs");
const moment = require("moment");
const Path = require("path");

const { getWeb3 } = require("@uma/common");
const { getAbi } = require("@uma/core");
const { BigQuery } = require("@google-cloud/bigquery");

const Config = require("../libs/config");
const { DappMining } = require("../libs/affiliates");
const Queries = require("../libs/bigquery");
const {
  generateDappMiningConfig,
  dappMiningTemplate,
  createGithubIssue,
  saveToDisk,
  makeDappMiningFilename
} = require("../libs/affiliates/utils");

// This is the main function which configures all data sources for the calculation.
async function App(params, env) {
  const web3 = getWeb3();

  const empAbi = getAbi("ExpiringMultiParty");
  const client = new BigQuery();
  const queries = Queries({ client });

  const dappmining = DappMining({ empAbi, queries, web3 });
  params = lodash.castArray(params);
  await Promise.map(params, async param => {
    const config = generateDappMiningConfig(param);
    const markdown = dappMiningTemplate(config);
    // await createGithubIssue({ auth: env.github, ...markdown });
    const result = await dappmining.getRewards(config);
    const fn = makeDappMiningFilename(config);
    return saveToDisk(fn, { config, ...result });
  });
  return "done";
}

const config = Config();

App(config, process.env)
  .then(x => console.log(JSON.stringify(x, null, 2)))
  .catch(console.error)
  // Process hangs if not forcibly closed. Unknown how to disconnect web3 or bigquery client.
  .finally(() => process.exit());

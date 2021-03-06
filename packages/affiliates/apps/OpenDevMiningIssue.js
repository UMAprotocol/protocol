// This opens a devmining issue with github. It requires some environment variables:
// github=your github key
// It by default will use umaproject/protocol repo.
// It returns the issue number as well as all parameters which were passed in and logs to console.
// You must pipe in a json object with the data needed to generate the template:
// cat data.json | node/apps/OpenDevMiningIssue
// {
//   config: //standard dev mining config as returned by apps/GenerateDevMiningConfig
//   whitelist: the whitelist of enabled emps, along with names and addresses, and returned by apps/GetSheetsDevminingStatus.js
// }
require("dotenv").config();
const assert = require("assert");
const { makeUnixPipe, devMiningTemplate, createGithubIssue } = require("../libs/affiliates/utils");

const App = env => async params => {
  const { config, whitelist } = params;
  assert(config, "requires config");
  assert(whitelist, "requires whitelist");
  const issueTemplate = await devMiningTemplate({ config, whitelist });
  const githubIssue = await createGithubIssue({ auth: env.github, ...issueTemplate });
  return {
    // data.number is the issue number
    issueNumber: githubIssue.data.number,
    ...params
  };
};

makeUnixPipe(App(process.env))
  .then(console.log)
  .catch(console.error);

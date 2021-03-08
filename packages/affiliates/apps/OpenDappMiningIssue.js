// This opens an issue with github. It requires some environment variables:
// github=your github key
// It by default will use umaproject/protocol repo.
// It returns the issue number as well as all parameters which were passed in and logs to console.
// You must pipe in a json object with the data needed to generate the template.
// cat data.json | node/apps/OpenDappMiningIssue
require("dotenv").config();
const assert = require("assert");
const { makeUnixPipe, dappMiningTemplate, createGithubIssue } = require("../libs/affiliates/utils");

const App = env => async params => {
  const { config } = params;
  assert(config, "requires config");
  const issueTemplate = await dappMiningTemplate(config);
  const githubIssue = await createGithubIssue({ auth: env.github, ...issueTemplate });
  return {
    // data.number is the issue number
    issueNumber: githubIssue.data.number,
    issueTemplate,
    ...params
  };
};

makeUnixPipe(App(process.env))
  .then(console.log)
  .catch(console.error);

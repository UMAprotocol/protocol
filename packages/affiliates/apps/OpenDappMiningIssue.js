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

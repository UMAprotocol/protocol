require("dotenv").config();
const assert = require('assert')
const { makeUnixPipe, devMiningTemplate, createGithubIssue } = require("../libs/affiliates/utils");

const App = env => async params => {
  const {config,whitelist} = params
  const issueTemplate = await devMiningTemplate({config,whitelist})
  const githubIssue = await createGithubIssue({auth:env.github,...issueTemplate})
  return {
    //data.number is the issue number
    issueNumber:githubIssue.data.number,
    ...params,
  }
}

makeUnixPipe(App(process.env)).then(console.log).catch(console.error)




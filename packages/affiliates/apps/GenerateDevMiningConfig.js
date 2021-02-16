const Config = require("../libs/config");
const { generateDevMiningConfig,  makeUnixPipe } = require("../libs/affiliates/utils");

// This is the main function which configures all data sources for the calculation.
async function App(whitelist) {
  const config = generateDevMiningConfig({whitelist})
  return {
    config,
    whitelist,
  }
}

makeUnixPipe(App).then(console.log).catch(console.error)


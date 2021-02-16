const { generateDevMiningConfig, devMiningPeriodByWeek, makeUnixPipe } = require("../libs/affiliates/utils");

// This is the main function which configures all data sources for the calculation.
async function App(whitelist) {
  const period = devMiningPeriodByWeek()
  const config = generateDevMiningConfig({whitelist,period})
  return {
    config,
    whitelist,
    period,
  }
}

makeUnixPipe(App).then(console.log).catch(console.error)


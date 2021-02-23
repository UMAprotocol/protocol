const assert = require("assert");
const Config = require("../libs/config");
const { generateDappMiningConfig, makeUnixPipe } = require("../libs/affiliates/utils");

// This is the main function which configures all data sources for the calculation.
const App = params => devMiningOutput => {
  const empRewards = devMiningOutput.empPayouts[params.empAddress];
  assert(empRewards, "emp rewards not found in dev mining output for: " + params.empAddress);
  const config = generateDappMiningConfig({ ...params, empRewards });
  return {
    params,
    config
  };
};

const config = Config();

makeUnixPipe(App(config))
  .then(console.log)
  .catch(console.error);

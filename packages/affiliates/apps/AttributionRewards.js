const Config = require("../libs/config");
const assert = require("assert");

// This is the main function which configures all data sources for the calculation.
async function App(config) {
}

const config = Config();

App(config)
  .then(x => console.log(JSON.stringify(x, null, 2)))
  .catch(console.error)
  // Process hangs if not forcibly closed. Unknown how to disconnect web3 or bigquery client.
  .finally(() => process.exit());

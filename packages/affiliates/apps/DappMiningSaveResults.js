const assert = require("assert");
const { makeDappMiningFilename, makeUnixPipe, saveToDisk } = require("../libs/affiliates/utils");

// This basically just saves the output of dapp mining, along with config to a file with a standard filename.
async function App(params) {
  const { config, result } = params;
  assert(result, "requires dev mining results json");
  const filename = makeDappMiningFilename(config);
  saveToDisk(filename, { config, ...result });
  return { filename, ...params };
}

makeUnixPipe(App)
  .then(console.log)
  .catch(console.error);

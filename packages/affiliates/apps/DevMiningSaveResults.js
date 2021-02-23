const assert = require("assert");
const { makeDevMiningFilename, makeUnixPipe, saveToDisk } = require("../libs/affiliates/utils");

async function App(params) {
  const { config, result } = params;
  const fn = makeDevMiningFilename(config);
  assert(result, "requires dev mining results json");
  saveToDisk(fn, { config, ...result });
  return { fn, ...params };
}

makeUnixPipe(App)
  .then(console.log)
  .catch(console.error);

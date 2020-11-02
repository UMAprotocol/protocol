const Coingecko = require("../libs/coingecko");
const fs = require("fs");
const Path = require("path");
const Promise = require("bluebird");
const moment = require("moment");
const mkdirp = require("mkdirp");
const params = require("../test/datasets/set1");

const symbol = "usd";
const days = moment.duration(params.endingTimestamp - params.startingTimestamp).days();
const basePath = Path.join(__dirname, "../test/datasets");
const subDir = Path.join(basePath, params.name, "coingecko");

const coingecko = Coingecko();
async function runTest() {
  await mkdirp(subDir);
  await Promise.each([...params.syntheticTokens], async address => {
    const path = Path.join(subDir, `${address}.json`);
    const prices = await coingecko.chart(address, symbol, days);
    console.log("coingeckoPrices", address, prices.prices.length);
    fs.writeFileSync(path, JSON.stringify(prices, null, 2));
  });
}
runTest()
  .then(console.log)
  .catch(console.log);

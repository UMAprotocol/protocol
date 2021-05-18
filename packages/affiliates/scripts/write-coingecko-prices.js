const Coingecko = require("../libs/coingecko");
const fs = require("fs");
const Path = require("path");
const Promise = require("bluebird");
const mkdirp = require("mkdirp");
const params = require("../test/datasets/set1");

const symbol = "usd";
const { startingTimestamp, endingTimestamp } = params;
const basePath = Path.join(__dirname, "../test/datasets");
const subDir = Path.join(basePath, params.name, "coingecko");

const coingecko = Coingecko();
async function runTest() {
  await mkdirp(subDir);
  await Promise.each([...params.collateralTokens], async (address) => {
    const path = Path.join(subDir, `${address}.json`);
    const prices = await coingecko.getHistoricContractPrices(address, symbol, startingTimestamp, endingTimestamp);
    console.log("coingeckoPrices", address, prices);
    fs.writeFileSync(path, JSON.stringify(prices));
  });
}
runTest().then(console.log).catch(console.log);

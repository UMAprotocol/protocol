const Web3 = require("web3");
const web3 = new Web3(new Web3.providers.HttpProvider(process.env.CUSTOM_NODE_URL));
const HistoricSynthPrices = require("../libs/synthPrices");
const fs = require("fs");
const Path = require("path");
const Promise = require("bluebird");
const mkdirp = require("mkdirp");
const params = require("../test/datasets/set1");

const { startingTimestamp, endingTimestamp } = params;
const basePath = Path.join(__dirname, "../test/datasets");
const subDir = Path.join(basePath, params.name, "synth-prices");

const historicSynthPrices = HistoricSynthPrices({ web3 });
async function runTest() {
  await mkdirp(subDir);
  await Promise.each([...params.empContracts], async (empAddress) => {
    const path = Path.join(subDir, `${empAddress}.json`);
    const prices = await historicSynthPrices.getHistoricSynthPrice(empAddress, startingTimestamp, endingTimestamp);
    console.log("empContract", empAddress, prices);
    fs.writeFileSync(path, JSON.stringify(prices));
  });
}
runTest().then(console.log).catch(console.log);

const HistoricSynthPrices = require("../libs/synthPrices");
const { getWeb3 } = require("@uma/common");
const Promise = require("bluebird");
const params = require("../test/datasets/set1");
const moment = require("moment");

const web3 = getWeb3();
const startingTimestamp = moment("2020-10-01 1:00:00", "YYYY-MM-DD  HH:mm Z").valueOf();
const endingTimestamp = moment("2020-10-01 2:00:00", "YYYY-MM-DD  HH:mm Z").valueOf();

const historicSynthPrices = HistoricSynthPrices({ web3 });

async function runTest() {
  await Promise.each([...params.empContracts], async (empAddress) => {
    const prices = await historicSynthPrices.getHistoricSynthPrices(empAddress, startingTimestamp, endingTimestamp);
    console.log("empContract", empAddress, prices);
  });
}
runTest().then(console.log).catch(console.log);

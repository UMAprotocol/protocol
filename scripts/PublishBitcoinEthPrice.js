var MockOracle = artifacts.require("OracleMock");
const BigNumber = require("bignumber.js");
const fetch = require("node-fetch");

const delay = 900;
var publishingPrice = false;


const getJson = async url => {
  try {
    const response = await fetch(url);
    const json = await response.json();
    return json;
  } catch (error) {
    console.log(error);
    return;
  }
};

async function publishPrices(btcPx, ethPx, oracle, time) {
  publishingPrice = true;
  try {
    var ownerAccount = (await web3.eth.getAccounts())[0];
    console.log("Publishing New Price");
    var btcInWei = web3.utils.toWei(btcPx.toString(), "ether");
    var ethInWei = web3.utils.toWei(ethPx.toString(), "ether");


    var decimalExchangeRateString = BigNumber(web3.utils.toWei(btcInWei, "ether")).div(BigNumber(ethInWei)).integerValue(BigNumber.ROUND_FLOOR).toString();
    var exchangeRate = BigNumber(decimalExchangeRateString).integerValue(BigNumber.ROUND_FLOOR).toString();
    var transactionResponse = await oracle.addUnverifiedPriceForTime(time, exchangeRate, { from: ownerAccount, gas: 6720000 });

    console.log("Publish verified. Time: " + time + " Exchange rate: " + exchangeRate);
  } catch (error) {
    console.log(error);
  }
  publishingPrice = false;
}

async function runExport() {
  try {
    var oracle = await MockOracle.deployed();
    var priceTime = await oracle.latestUnverifiedPrice();

    var nextPublishTime;
    var contractTime = Number(priceTime[0].toString());
    if (contractTime == 0) {
      nextPublishTime = await oracle.startTime();
    } else {
      nextPublishTime = contractTime + delay;
    }

    var dateUtc = Math.round(Date.now() / 1000);
    if (!publishingPrice && dateUtc >= nextPublishTime) {

      var btcUsdJson = await getJson('https://api.coinbase.com/v2/prices/BTC-USD/spot');
      if (!btcUsdJson) {
        console.log("Couldn't get BTC price.");
        return;
      }

      var btcUsd = btcUsdJson.data.amount;

      var ethUsdJson = await getJson('https://api.coinbase.com/v2/prices/ETH-USD/spot');

      if (!ethUsdJson) {
        console.log("Couldn't get ETH price.");
        return;
      }

      var ethUsd = ethUsdJson.data.amount;

      await publishPrices(btcUsd, ethUsd, oracle, nextPublishTime.toString());

    }
  } catch (error) {
    console.log(error);
  }
}



module.exports = async function(callback) {
  await runExport();
  callback();
};
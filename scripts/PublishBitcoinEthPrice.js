var MockOracle = artifacts.require("OracleMock");
const BigNumber = require("bignumber.js");
const request = require('request');

const delay = 900;
var publishingPrice = false;

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

    // Get th
    var nextPublishTime;
    var contractTime = Number(priceTime[0].toString());
    if (contractTime == 0) {
      nextPublishTime = await oracle.startTime();
    } else {
      nextPublishTime = contractTime + delay;
    }

    var btcUsd = "";
    var ethUsd = "";

    var dateUtc = Math.round(Date.now() / 1000);
    if (!publishingPrice && dateUtc >= nextPublishTime) {

      request('https://api.coinbase.com/v2/prices/BTC-USD/spot', { json: true }, (err, res, body) => {
        if (err) { return console.log(err); }

        btcUsd = body.data.amount;
        if (ethUsd != "") {
          publishPrices(btcUsd, ethUsd, oracle, nextPublishTime.toString());
        }
      });

      request('https://api.coinbase.com/v2/prices/ETH-USD/spot', { json: true }, (err, res, body) => {
        if (err) { return console.log(err); }

        ethUsd = body.data.amount;
        if (btcUsd != "") {
          publishPrices(btcUsd, ethUsd, oracle, nextPublishTime.toString());
        }
      });
    } else {
      // console.log("No price published. Current date: " + dateUtc.toString() + " Next publish time: " + nextPublishTime.toString());
      // console.log("Should publish in " + ((nextPublishTime - dateUtc) / 60).toString() + " minutes.");
    }

    // console.log("Finished running export. Setting timeout for next export.")
    setTimeout(function(){ runExport() }, 5000);
  } catch (error) {
    console.log(error);
    setTimeout(function(){ runExport() }, 1000);
  }
}



module.exports = async function(callback) {
  runExport();
  // callback(err);
};
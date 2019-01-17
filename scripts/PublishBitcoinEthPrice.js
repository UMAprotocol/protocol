const MockOracle = artifacts.require("OracleMock");
const BigNumber = require("bignumber.js");
const fetch = require("node-fetch");

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

async function publishPrices(oracle, time, num, denom) {
  try {
    console.log("Publishing New Price");
    let numInWei = web3.utils.toWei(num.toString(), "ether");
    let exchangeRate;

    if (denom) {
      let denomInWei = web3.utils.toWei(denom.toString(), "ether");
      exchangeRate = BigNumber(web3.utils.toWei(numInWei, "ether"))
        .div(BigNumber(denomInWei))
        .integerValue(BigNumber.ROUND_FLOOR)
        .toString();
    } else {
      exchangeRate = numInWei;
    }

    await oracle.addUnverifiedPriceForTime(time, exchangeRate, { gas: 6720000 });

    console.log("Publish verified. Time: " + time + " Exchange rate: " + exchangeRate);
  } catch (error) {
    console.log(error);
  }
}

async function getContractAndNextPublishTime(address, delay) {
  let oracle = await MockOracle.at(address);
  let lastPublishTime = Number((await oracle.latestUnverifiedPrice())[0]);
  let nextPublishTime;
  if (lastPublishTime == 0) {
    nextPublishTime = await oracle.startTime();
  } else {
    nextPublishTime = lastPublishTime + delay;
  }

  return {
    oracle: oracle,
    nextPublishTime: nextPublishTime
  };
}

async function getCoinbasePrice(asset) {
  let url = "https://api.coinbase.com/v2/prices/" + asset + "/spot";
  let jsonOutput = await getJson(url);
  if (!jsonOutput) {
    console.log(url + " query failed.");
    return;
  }
  console.log(jsonOutput.data.amount);
  return jsonOutput.data.amount;
}

async function getAlphaVantageQuote(asset) {
  let url = "https://www.alphavantage.co/query?function=GLOBAL_QUOTE&apikey=41EUIBN9FKJW9FQM&symbol=" + asset;
  let jsonOutput = await getJson(url);
  if (!jsonOutput) {
    console.log(url + " query failed.");
    return;
  }

  return jsonOutput["Global Quote"]["05. price"];
}

async function publishFeed(feed) {
  try {
    const { feedDelay, oracleAddress, numerator } = feed;

    const { oracle, nextPublishTime } = await getContractAndNextPublishTime(oracleAddress, feedDelay);

    const currentTime = Math.round(Date.now() / 1000);
    if (currentTime >= nextPublishTime) {
      // Get the numerator price.
      const { assetName: numAssetName, priceFunction: numPriceFunction } = numerator;
      let numPrice = await numPriceFunction(numAssetName);
      if (!numPrice) {
        return;
      }

      // Leave denominator as undefined if there is no denominator (the publish function handles that case).
      let denomPrice;
      if ("denominator" in feed) {
        // Get the denominator price.
        const { assetName: denomAssetName, priceFunction: denomPriceFunction } = feed.denominator;
        denomPrice = await denomPriceFunction(denomAssetName);
        if (!denomPrice) {
          return;
        }
      }

      // Publish prices to the oracle.
      await publishPrices(oracle, nextPublishTime.toString(), numPrice, denomPrice);
    }
  } catch (error) {
    console.log(error);
  }
}

async function runExport() {
  try {
    let bitcoinEthFeed = {
      feedDelay: 900,
      oracleAddress: "0x9024e1dA0726670594e1d7E60D2e30D9e597c297",
      numerator: {
        priceFunction: getCoinbasePrice,
        assetName: "BTC-USD"
      },
      denominator: {
        priceFunction: getCoinbasePrice,
        assetName: "ETH-USD"
      }
    };

    let priceFeeds = [bitcoinEthFeed];

    for (let i = 0; i < priceFeeds.length; i++) {
      await publishFeed(priceFeeds[i]);
    }
  } catch (error) {
    console.log(error);
  }
}

module.exports = async function(callback) {
  await runExport();
  callback();
};

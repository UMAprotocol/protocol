const BigNumber = require("bignumber.js");
const ManualPriceFeed = artifacts.require("ManualPriceFeed");
const fetch = require("node-fetch");
const util = require("util");

const getJson = async url => {
  const response = await fetch(url);
  const json = await response.json();
  return json;
};

// Gets the Coinbase price for an asset or throws.
async function getCoinbasePrice(asset) {
  const url = "https://api.coinbase.com/v2/prices/" + asset + "/spot";
  console.log("Querying Coinbase with: " + url);
  const jsonOutput = await getJson(url);
  if (!jsonOutput) {
    throw util.format(url + " query failed.");
  }
  console.log("Coinbase response: " + JSON.stringify(jsonOutput));
  const price = jsonOutput.data.amount;
  if (!price) {
    throw "Query Failed";
  }
  return price;
}

// Gets the AlphaVantage price for an asset or throws.
async function getAlphaVantageQuote(asset) {
  const url = "https://www.alphavantage.co/query?function=GLOBAL_QUOTE&apikey=41EUIBN9FKJW9FQM&symbol=" + asset;
  console.log("Querying AlphaVantage with: " + url);
  const jsonOutput = await getJson(url);
  if (!jsonOutput) {
    throw util.format(url + " query failed.");
  }
  console.log("AlphaVantage response: " + JSON.stringify(jsonOutput));
  const price = jsonOutput["Global Quote"]["05. price"];
  if (!price) {
    throw "Query Failed";
  }
  return price;
}

// Pushes a price to a manual price feed.
async function publishPrice(manualPriceFeed, identifier, publishTime, exchangeRate) {
  const identifierBytes = web3.utils.fromAscii(identifier);
  console.log(
    util.format(
      "Publishing identifier[%s] identifierBytes[%s] publishTime[%s] exchangeRate[%s]",
      identifier,
      identifierBytes,
      publishTime,
      exchangeRate
    )
  );
  await manualPriceFeed.pushLatestPrice(identifier, publishTime, exchangeRate, { gas: 6720000 });
}

// Gets the exchange rate or throws.
async function getExchangeRate(numeratorConfig, denominatorConfig) {
  const numeratorPrice = await numeratorConfig.priceFetchFunction(numeratorConfig.assetName);
  if (!numeratorPrice) {
    throw "No numerator price";
  }
  const numInWei = web3.utils.toWei(numeratorPrice.toString(), "ether");

  // If no denominator is specified, then the exchange rate is the numerator. An example would be SPY denominated in
  // USD.
  if (!denominatorConfig) {
    return numInWei;
  }
  const denominatorPrice = await denominatorConfig.priceFetchFunction(denominatorConfig.assetName);
  if (!denominatorPrice) {
    throw "No denominator price";
  }
  return BigNumber(web3.utils.toWei(numInWei, "ether"))
    .div(BigNumber(web3.utils.toWei(denominatorPrice.toString(), "ether")))
    .integerValue(BigNumber.ROUND_FLOOR)
    .toString();
}

// Returns {shouldPublish, publishTime} for an identifier.
async function getPublishTime(identifierBytes, manualPriceFeed, publishInterval) {
  const isIdentifierSupported = await manualPriceFeed.isIdentifierSupported(identifierBytes);
  const currentTime = Math.round(Date.now() / 1000);
  // If the identifier is not supported (i.e., we have never published a price for it), then we should always publish at
  // the current time.
  if (!isIdentifierSupported) {
    return {
      shouldPublish: true,
      publishTime: currentTime
    };
  }

  const lastPublishTime = (await manualPriceFeed.latestPrice(identifierBytes))[0];
  const nextPublishTime = lastPublishTime + publishInterval;
  const shouldPublish = currentTime >= nextPublishTime;
  if (!shouldPublish) {
    console.log(
      util.format(
        "Not publishing because lastPublishTime [%s] + publishInterval [%s] < currentTime [%s]",
        lastPublishTime,
        publishInterval,
        currentTime
      )
    );
  }
  return {
    shouldPublish: shouldPublish,
    publishTime: nextPublishTime
  };
}

async function publishFeed(feed) {
  const manualPriceFeed = await ManualPriceFeed.at(feed.priceFeedAddress);
  const identifierBytes = web3.utils.fromAscii(feed.identifier);

  // The contract ManualPriceFeed has a check that we aren't publishing for times too far into the future, so in test
  // mode, we need to set currentTime to ~now.
  if (await manualPriceFeed.isTest()) {
    await manualPriceFeed.setCurrentTime(Math.round(Date.now() / 1000));
  }
  const { shouldPublish, publishTime } = await getPublishTime(identifierBytes, manualPriceFeed, feed.publishInterval);
  if (shouldPublish) {
    const exchangeRate = await getExchangeRate(feed.numerator, feed.denominator);
    await publishPrice(manualPriceFeed, identifierBytes, publishTime, exchangeRate);
  } else {
    console.log("Not publishing this run!");
  }
}

async function runExport() {
  // Wrap all the functionality in a try/catch, so that this function never throws.
  try {
    const manualPriceFeedAddress = "0x58201524a2565a95338997963a309f916981aD85";
    const bitcoinEthFeed = {
      identifier: "BTC/ETH",
      priceFeedAddress: manualPriceFeedAddress,
      publishInterval: 900, // 15 minutes.
      numerator: {
        priceFetchFunction: getCoinbasePrice,
        assetName: "BTC-USD"
      },
      denominator: {
        priceFetchFunction: getCoinbasePrice,
        assetName: "ETH-USD"
      }
    };
    const priceFeeds = [bitcoinEthFeed];

    for (const priceFeed of priceFeeds) {
      // Wrap each feed in a try/catch, so that a failure in one feed doesn't stop all the others from publishing.
      try {
        console.log(
          util.format(
            "Publishing price feed for [%s], with config [%s]",
            priceFeed.identifier,
            JSON.stringify(priceFeed)
          )
        );
        await publishFeed(priceFeed);
      } catch (error) {
        console.log(error);
      }
    }
  } catch (error) {
    console.log(error);
  }
}

module.exports = async function(callback) {
  await runExport();
  callback();
};

const BigNumber = require("bignumber.js");
const ManualPriceFeed = artifacts.require("ManualPriceFeed");
const fetch = require("node-fetch");
const util = require("util");

// Gets JSON from a URL or throws.
const getJson = async url => {
  const response = await fetch(url);
  const json = await response.json();
  if (!json) {
    throw util.format("Query [%s] failed to get JSON", url);
  }
  return json;
};

// Gets the Coinbase price for an asset or throws.
async function getCoinbasePrice(asset) {
  const url = "https://api.coinbase.com/v2/prices/" + asset + "/spot";
  console.log(util.format("Querying Coinbase with [%s]", url));
  const jsonOutput = await getJson(url);
  console.log(util.format("Coinbase response [%s]", JSON.stringify(jsonOutput)));
  const price = jsonOutput.data.amount;
  if (!price) {
    throw "Failed to get valid price out of JSON response";
  }
  console.log(util.format("Retrieved price [%s] from Coinbase for asset [%s]", price, asset));
  return price;
}

// Gets the AlphaVantage price for an asset or throws.
async function getAlphaVantageQuote(asset) {
  const url = "https://www.alphavantage.co/query?function=GLOBAL_QUOTE&apikey=41EUIBN9FKJW9FQM&symbol=" + asset;
  console.log(util.format("Querying AlphaVantage with [%s]", url));
  const jsonOutput = await getJson(url);
  console.log(util.format("AlphaVantage response [%s]", JSON.stringify(jsonOutput)));
  const price = jsonOutput["Global Quote"]["05. price"];
  if (!price) {
    throw "Failed to get valid price out of JSON response";
  }
  console.log(util.format("Retrieved price [%s] from Coinbase for asset [%s]", price, asset));
  return price;
}

// Pushes a price to a manual price feed.
async function publishPrice(manualPriceFeed, identifierBytes, publishTime, exchangeRate) {
  console.log(
    util.format(
      "Publishing identifierBytes [%s] publishTime [%s] exchangeRate (in Wei) [%s]",
      identifierBytes,
      publishTime,
      exchangeRate
    )
  );
  await manualPriceFeed.pushLatestPrice(identifierBytes, publishTime, exchangeRate);
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
    console.log(util.format("No denominator. numerator [%s], exchangeRate (in Wei) [%s]", numerator, numInWei));
    return numInWei;
  }
  const denominatorPrice = await denominatorConfig.priceFetchFunction(denominatorConfig.assetName);
  if (!denominatorPrice) {
    throw "No denominator price";
  }
  const exchangeRate = BigNumber(web3.utils.toWei(numInWei, "ether"))
    .div(BigNumber(web3.utils.toWei(denominatorPrice.toString(), "ether")))
    .integerValue(BigNumber.ROUND_FLOOR)
    .toString();
  console.log(
    util.format(
      "Dividing numerator [%s] / denominator [%s] = exchange rate [%s]",
      numeratorPrice,
      denominatorPrice,
      exchangeRate
    )
  );
  return exchangeRate;
}

// Returns {shouldPublish, publishTime} for an identifier.
async function getWhenToPublish(manualPriceFeed, identifierBytes, publishInterval) {
  const isIdentifierSupported = await manualPriceFeed.isIdentifierSupported(identifierBytes);
  const currentTime = web3.utils.toBN(Math.round(Date.now() / 1000));
  // If the identifier is not supported (i.e., we have never published a price for it), then we should always publish at
  // the current time.
  if (!isIdentifierSupported) {
    console.log(
      util.format("IdentifierBytes [%s] is currently unsupported, so publishing a new price", identifierBytes)
    );
    return {
      shouldPublish: true,
      publishTime: currentTime
    };
  }

  const lastPublishTime = (await manualPriceFeed.latestPrice(identifierBytes))[0];
  const nextPublishTime = lastPublishTime.addn(publishInterval);
  const shouldPublish = currentTime.gte(nextPublishTime);
  if (!shouldPublish) {
    console.log(
      util.format(
        "Not publishing because lastPublishTime [%s] + publishInterval [%s] > currentTime [%s]",
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

async function initializeTestFeed(manualPriceFeed) {
  // The contract ManualPriceFeed has a check that we aren't publishing for times too far into the future, so in test
  // mode, we need to set currentTime to ~now.
  if (await manualPriceFeed.isTest()) {
    await manualPriceFeed.setCurrentTime(Math.round(Date.now() / 1000));
  }
}

async function publishFeed(feed) {
  const manualPriceFeed = await ManualPriceFeed.at(feed.priceFeedAddress);
  const identifierBytes = web3.utils.fromAscii(feed.identifier);

  await initializeTestFeed(manualPriceFeed); // Or we could do this once in the beginning.
  const { shouldPublish, publishTime } = await getWhenToPublish(manualPriceFeed, identifierBytes, feed.publishInterval);
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
        console.log("Done publishing for one feed.\n\n");
      } catch (error) {
        console.log(error);
      }
    }
    console.log("Done publishing for all feeds");
  } catch (error) {
    console.log(error);
  }
}

module.exports = async function(callback) {
  await runExport();
  callback();
};

const BigNumber = require("bignumber.js");
const ManualPriceFeed = artifacts.require("ManualPriceFeed");
const fetch = require("node-fetch");
const util = require("util");
const commandlineUtil = require("./CommandlineUtil");

// NOTE: Key restricted to 5 calls per minute, 500 calls per day.
const alphaVantageKey = "41EUIBN9FKJW9FQM";

// Gets JSON from a URL or throws.
const getJson = async url => {
  const response = await fetch(url);
  const json = await response.json();
  if (!json) {
    throw `Query [${url}] failed to get JSON`;
  }
  return json;
};

// Gets the Coinbase price for an asset or throws.
async function getCoinbasePrice(asset) {
  const url = `https://api.coinbase.com/v2/prices/${asset}/spot`;
  console.log(util.format("Querying Coinbase with [%s]", url));
  const jsonOutput = await getJson(url);
  console.log(util.format("Coinbase response [%s]", JSON.stringify(jsonOutput)));
  const price = jsonOutput.data.amount;
  if (!price) {
    throw "Failed to get valid price out of JSON response";
  }
  console.log(`Retrieved price [${price}] from Coinbase for asset [${asset}]`);
  return price;
}

// Gets the AlphaVantage price for an asset or throws.
async function getAlphaVantageQuote(asset) {
  const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&apikey=${alphaVantageKey}&symbol=${asset}`;
  console.log(`Querying AlphaVantage with [${url}]`);
  const jsonOutput = await getJson(url);
  console.log(`AlphaVantage response [${JSON.stringify(jsonOutput)}]`);
  const price = jsonOutput["Global Quote"]["05. price"];
  if (!price) {
    throw "Failed to get valid price out of JSON response";
  }
  console.log(`Retrieved quote [${price}] from AlphaVantage for asset [${asset}]`);
  return price;
}

// Gets the AlphaVantage rate for a currency against USD.
async function getAlphaVantageCurrencyRate(asset) {
  const url = `https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=${asset}&to_currency=USD&apikey=${alphaVantageKey}`;
  console.log(`Querying AlphaVantage with [${url}]`);
  const jsonOutput = await getJson(url);
  console.log(`AlphaVantage response [${JSON.stringify(jsonOutput)}]`);
  const rate = jsonOutput["Realtime Currency Exchange Rate"]["5. Exchange Rate"];
  if (!rate) {
    throw "Failed to get valid price out of JSON response";
  }
  console.log(`Retrieved rate [${rate}] from Coinbase for asset [${asset}]`);
  return rate;
}

// Pushes a price to a manual price feed.
async function publishPrice(manualPriceFeed, identifierBytes, publishTime, exchangeRate) {
  console.log(
    `Publishing identifierBytes [${identifierBytes}] publishTime [${publishTime}] exchangeRate (in Wei) [${exchangeRate}]`
  );
  await manualPriceFeed.pushLatestPrice(identifierBytes, publishTime, exchangeRate);
}

async function getNonZeroPriceInWei(assetConfig) {
  const price = await assetConfig.priceFetchFunction(assetConfig.assetName);
  if (!price) {
    throw `No price for [${assetConfig}]`;
  }
  const priceInWei = web3.utils.toWei(price.toString(), "ether");
  if (web3.utils.toBN(priceInWei).isZero()) {
    throw `Got zero price for [${assetConfig}]`;
  }
  return priceInWei;
}

// Gets the exchange rate or throws.
async function getExchangeRate(numeratorConfig, denominatorConfig) {
  const numInWei = await getNonZeroPriceInWei(numeratorConfig);
  // If no denominator is specified, then the exchange rate is the numerator. An example would be SPY denominated in
  // USD.
  if (!denominatorConfig) {
    console.log(`No denominator. Exchange rate (in Wei) [${numInWei}]`);
    return numInWei;
  }
  const denomInWei = await getNonZeroPriceInWei(denominatorConfig);
  const exchangeRate = web3.utils.toWei(
    BigNumber(numInWei)
      .div(BigNumber(denomInWei))
      .integerValue(BigNumber.ROUND_FLOOR)
      .toString()
  );
  console.log(
    `Dividing numerator [${numInWei}] / denominator [${denomInWei}] = exchange rate (in Wei) [${exchangeRate}]`
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
    console.log(`IdentifierBytes [${identifierBytes}] is currently unsupported, so publishing a new price`);
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
      `Not publishing because lastPublishTime [${lastPublishTime}] + publishInterval [${publishInterval}] > currentTime [${currentTime}]`
    );
  } else {
    console.log(
      `Publishing because lastPublishTime [${lastPublishTime}] + publishInterval [${publishInterval}] <= currentTime [${currentTime}]`
    );
  }
  return {
    shouldPublish: shouldPublish,
    // This should really be current time, because that's the time the price is at?
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

function getPriceFeeds(priceFeedAddress) {
  return [
    {
      identifier: "BTC/ETH",
      priceFeedAddress: priceFeedAddress,
      publishInterval: 900, // 15 minutes.
      numerator: {
        priceFetchFunction: getCoinbasePrice,
        assetName: "BTC-USD"
      },
      denominator: {
        priceFetchFunction: getCoinbasePrice,
        assetName: "ETH-USD"
      }
    },
    {
      identifier: "SPY/USD",
      priceFeedAddress: priceFeedAddress,
      publishInterval: 900,
      numerator: {
        priceFetchFunction: getAlphaVantageQuote,
        assetName: "SPY"
      }
    },
    {
      identifier: "CNH/USD",
      priceFeedAddress: priceFeedAddress,
      publishInterval: 900,
      numerator: {
        priceFetchFunction: getAlphaVantageCurrencyRate,
        assetName: "CNH"
      }
    }
  ];
}

async function runExport() {
  // Wrap all the functionality in a try/catch, so that this function never throws.
  try {
    // Usage: `truffle exec scripts/PublishPrices.js <ManualPriceFeed address> --network <network>`
    if (process.argv.length < 5) {
      console.error("Not enough arguments. Include ManualPriceFeed's contract address.");
      return;
    }

    // Get the price feed contract's hash from the command line.
    const manualPriceFeedAddress = process.argv[4];
    if (!commandlineUtil.validateAddress(manualPriceFeedAddress)) {
      console.error("ManualPriceFeed's contract address missing. Exiting...");
      return;
    }

    // Get the list of price feeds to submit
    for (const priceFeed of getPriceFeeds(manualPriceFeedAddress)) {
      // Wrap each feed in a try/catch, so that a failure in one feed doesn't stop all the others from publishing.
      try {
        console.log(`Publishing price feed for [${priceFeed.identifier}], with config [${JSON.stringify(priceFeed)}]`);
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

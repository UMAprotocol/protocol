const BigNumber = require("bignumber.js");
const ManualPriceFeed = artifacts.require("ManualPriceFeed");
const assert = require("assert");
const fetch = require("node-fetch");
const util = require("util");
const commandlineUtil = require("./CommandlineUtil");
const identifiers = require("../config/identifiers");

require("dotenv").config();

// Get API keys from environment variables or the `.env` file.
const alphaVantageKey = process.env.ALPHAVANTAGE_API_KEY;
const barchartKey = process.env.BARCHART_API_KEY;

function stripApiKey(str, key) {
  return str.replace(key, "{redacted}");
}

function stripApiKeys(str, keys) {
  ret = str;
  for (key of keys) {
    ret = stripApiKey(ret, key);
  }
  return ret;
}

// Gets JSON from a URL or throws.
const getJson = async url => {
  const response = await fetch(url);
  const json = await response.json();
  if (!json) {
    throw `Query [${url}] failed to get JSON`;
  }
  return json;
};

// Gets the current time as BN.
function getCurrentTime() {
  return web3.utils.toBN(Math.round(Date.now() / 1000));
}

async function getBarchartPrice(asset) {
  const url = `https://ondemand.websol.barchart.com/getQuote.json?apikey=${barchartKey}&symbols=${asset}`;
  console.log(`Querying Barchart with [${stripApiKey(url, barchartKey)}]`);
  const jsonOutput = await getJson(url);
  console.log(`Barchart response [${JSON.stringify(jsonOutput)}]`);

  if (jsonOutput.status.code !== 200) {
    throw "Barchart request failed";
  }

  if (jsonOutput.results == null || jsonOutput.results.length != 1) {
    throw "Unexpected number of results in json response";
  }

  if (jsonOutput.results[0].symbol !== asset) {
    throw "Unexpected symbol in json response";
  }

  const price = jsonOutput.results[0].lastPrice;
  if (!price) {
    throw "Failed to get valid price out of JSON response";
  }

  const tradeTime = jsonOutput.results[0].tradeTimestamp;
  const timestamp = web3.utils.toBN(Math.round(new Date(tradeTime).getTime() / 1000));
  if (!timestamp) {
    throw `Failed to get valid timestamp out of JSON response tradeTimestamp field [${tradeTime}]`;
  }

  console.log(`Retrieved quote [${price}] at [${timestamp}] ([${tradeTime}]) from Barchart for asset [${asset}]`);

  return { price, timestamp };
}

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
  return { price, timestamp: getCurrentTime() };
}

// Gets the AlphaVantage price for an asset or throws.
async function getAlphaVantageQuote(asset) {
  const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&apikey=${alphaVantageKey}&symbol=${asset}`;
  console.log(`Querying AlphaVantage with [${stripApiKey(url, alphaVantageKey)}]`);
  const jsonOutput = await getJson(url);
  console.log(`AlphaVantage response [${JSON.stringify(jsonOutput)}]`);
  const price = jsonOutput["Global Quote"]["05. price"];
  if (!price) {
    throw "Failed to get valid price out of JSON response";
  }
  console.log(`Retrieved quote [${price}] from AlphaVantage for asset [${asset}]`);
  return { price, timestamp: getCurrentTime() };
}

// Gets the AlphaVantage rate for a currency against USD.
async function getAlphaVantageCurrencyRate(asset) {
  const url = `https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=${asset}&to_currency=USD&apikey=${alphaVantageKey}`;
  console.log(`Querying AlphaVantage with [${stripApiKey(url, alphaVantageKey)}]`);
  const jsonOutput = await getJson(url);
  console.log(`AlphaVantage response [${JSON.stringify(jsonOutput)}]`);
  const rate = jsonOutput["Realtime Currency Exchange Rate"]["5. Exchange Rate"];
  if (!rate) {
    throw "Failed to get valid price out of JSON response";
  }
  console.log(`Retrieved rate [${rate}] from Coinbase for asset [${asset}]`);
  return { price: rate, timestamp: getCurrentTime() };
}

async function fetchPrice(assetConfig) {
  switch (assetConfig.dataSource) {
    case "Barchart":
      return await getBarchartPrice(assetConfig.assetName);
    case "AlphaVantage":
      return await getAlphaVantageQuote(assetConfig.assetName);
    case "AlphaVantageCurrency":
      return await getAlphaVantageCurrencyRate(assetConfig.assetName);
    case "Coinbase":
      return await getCoinbasePrice(assetConfig.assetName);
    default:
      throw `Unknown dataSource [${value.uploaderConfig.dataSource}]`;
  }
}

// Pushes a price to a manual price feed.
async function publishPrice(manualPriceFeed, identifierBytes, publishTime, exchangeRate) {
  console.log(
    `Publishing identifierBytes [${identifierBytes}] publishTime [${publishTime}] exchangeRate (in Wei) [${exchangeRate}]`
  );
  await manualPriceFeed.pushLatestPrice(identifierBytes, publishTime, exchangeRate);
}

async function getNonZeroPriceInWei(assetConfig) {
  const { price, timestamp } = await fetchPrice(assetConfig);
  if (!price) {
    throw `No price for [${assetConfig}]`;
  }
  const priceInWei = web3.utils.toWei(price.toString(), "ether");
  if (web3.utils.toBN(priceInWei).isZero()) {
    throw `Got zero price for [${assetConfig}]`;
  }
  return { priceInWei, timestamp };
}

// Gets the exchange rate or throws.
async function getExchangeRate(numeratorConfig, denominatorConfig) {
  const { priceInWei: numInWei, timestamp } = await getNonZeroPriceInWei(numeratorConfig);
  // If no denominator is specified, then the exchange rate is the numerator. An example would be SPY denominated in
  // USD.
  if (!denominatorConfig) {
    console.log(`No denominator. Exchange rate (in Wei) [${numInWei}]`);
    return { exchangeRate: numInWei, timestamp };
  }
  // For now, disregard denominator timestamp.
  const { priceInWei: denomInWei } = await getNonZeroPriceInWei(denominatorConfig);
  const exchangeRate = web3.utils.toWei(
    BigNumber(numInWei)
      .div(BigNumber(denomInWei))
      .integerValue(BigNumber.ROUND_FLOOR)
      .toString()
  );
  console.log(
    `Dividing numerator [${numInWei}] / denominator [${denomInWei}] = exchange rate (in Wei) [${exchangeRate}]`
  );
  return { exchangeRate, timestamp };
}

// Returns {shouldPublish, publishTime} for an identifier.
async function getWhenToPublish(manualPriceFeed, identifierBytes, publishInterval, minDelay) {
  const isIdentifierSupported = await manualPriceFeed.isIdentifierSupported(identifierBytes);
  const currentTime = getCurrentTime();
  // If the identifier is not supported (i.e., we have never published a price for it), then we should always publish at
  // the current time.
  if (!isIdentifierSupported) {
    console.log(`IdentifierBytes [${identifierBytes}] is currently unsupported, so publishing a new price`);
    return {
      shouldPublish: true,
      minNextPublishTime: 0
    };
  }

  const lastPublishTime = (await manualPriceFeed.latestPrice(identifierBytes))[0];
  const minNextPublishTime = lastPublishTime.add(web3.utils.toBN(publishInterval));
  const shouldPublish = currentTime.sub(web3.utils.toBN(minDelay)).gte(minNextPublishTime);

  if (!shouldPublish) {
    console.log(
      `Not publishing because lastPublishTime [${lastPublishTime}] + publishInterval [${publishInterval}] ` +
        `> currentTime [${currentTime}] - delay [${minDelay}]`
    );
  } else {
    console.log(
      `Publishing because lastPublishTime [${lastPublishTime}] + publishInterval [${publishInterval}] ` +
        `<= currentTime [${currentTime}] - delay [${minDelay}]`
    );
  }
  return {
    shouldPublish: shouldPublish,
    minNextPublishTime
  };
}

async function initializeTestFeed(manualPriceFeed) {
  // The contract ManualPriceFeed has a check that we aren't publishing for times too far into the future, so in test
  // mode, we need to set currentTime to ~now.
  if (await manualPriceFeed.isTest()) {
    await manualPriceFeed.setCurrentTime(Math.round(Date.now() / 1000));
  }
}

function verifyFeedConfig(feed) {
  assert(feed.publishInterval, "Feed config must provide `publishInterval`");
  assert(feed.minDelay, "Feed config must provide `minDelay`");

  assert(feed.numerator.dataSource, "Feed config must provide `numerator.dataSource`");
  assert(feed.numerator.assetName, "Feed config must provide `numerator.assetName`");
  if (feed.denominator) {
    assert(feed.denominator.dataSource, "Feed config must provide `denominator.dataSource`");
    assert(feed.denominator.assetName, "Feed config must provide `denominator.assetName`");
  }
}

async function publishFeed(feed) {
  verifyFeedConfig(feed);
  const manualPriceFeed = await ManualPriceFeed.at(feed.priceFeedAddress);
  const identifierBytes = web3.utils.fromAscii(feed.identifier);

  await initializeTestFeed(manualPriceFeed);
  const { shouldPublish, minNextPublishTime } = await getWhenToPublish(
    manualPriceFeed,
    identifierBytes,
    feed.publishInterval,
    feed.minDelay
  );
  if (!shouldPublish) {
    console.log("Not publishing this run!");
    return;
  }
  const { exchangeRate, timestamp } = await getExchangeRate(feed.numerator, feed.denominator);
  if (timestamp.lte(minNextPublishTime)) {
    console.log(`Skipping publish because timestamp [${timestamp}] <= minNextPublishTime [${minNextPublishTime}]`);
  } else {
    await publishPrice(manualPriceFeed, identifierBytes, timestamp, exchangeRate);
  }
}

function getPriceFeeds() {
  const priceFeedAddress = ManualPriceFeed.address;
  return Object.entries(identifiers).map(([key, value]) => {
    return {
      identifier: key,
      priceFeedAddress: priceFeedAddress,
      ...value.uploaderConfig
    };
  });
}

async function runExport() {
  // Wrap all the functionality in a try/catch, so that this function never throws.
  try {
    // Get the list of price feeds to submit
    for (const priceFeed of getPriceFeeds()) {
      // Wrap each feed in a try/catch, so that a failure in one feed doesn't stop all the others from publishing.
      try {
        console.log(`Publishing price feed for [${priceFeed.identifier}], with config [${JSON.stringify(priceFeed)}]`);
        await publishFeed(priceFeed);
        console.log("Done publishing for one feed.\n\n");
      } catch (error) {
        console.log(stripApiKeys(error.toString(), [alphaVantageKey, barchartKey]));
      }
    }
    console.log("Done publishing for all feeds");
  } catch (error) {
    console.log(error);
  }
}

run = async function(callback) {
  await runExport();
  callback();
};
run.verifyFeedConfig = verifyFeedConfig;
module.exports = run;

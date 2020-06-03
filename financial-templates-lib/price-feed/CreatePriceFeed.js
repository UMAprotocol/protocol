const { MedianizerPriceFeed } = require("./MedianizerPriceFeed");
const { CryptoWatchPriceFeed } = require("./CryptoWatchPriceFeed");
const { UniswapPriceFeed } = require("./UniswapPriceFeed");

const Uniswap = require("../../core/build/contracts/Uniswap.json");
const ExpiringMultiParty = require("../../core/build/contracts/ExpiringMultiParty.json");

async function createPriceFeed(logger, web3, networker, getTime, config) {
  if (config.type === "cryptowatch") {
    const requiredFields = ["exchange", "pair", "lookback", "minTimeBetweenUpdates"];

    if (isMissingField(config, requiredFields, logger)) {
      return null;
    }

    logger.debug({
      at: "createPriceFeed",
      message: "Creating CryptoWatchPriceFeed",
      config
    });

    return new CryptoWatchPriceFeed(
      logger,
      web3,
      config.apiKey,
      config.exchange,
      config.pair,
      config.lookback,
      networker,
      getTime,
      config.minTimeBetweenUpdates
    );
  } else if (config.type === "uniswap") {
    const requiredFields = ["uniswapAddress", "twapLength", "lookback"];

    if (isMissingField(config, requiredFields, logger)) {
      return null;
    }

    logger.debug({
      at: "createPriceFeed",
      message: "Creating UniswapPriceFeed",
      config
    });

    return new UniswapPriceFeed(
      logger,
      Uniswap.abi,
      web3,
      config.uniswapAddress,
      config.twapLength,
      config.lookback,
      getTime,
      config.invertPrice // Not checked in config because this parameter just defaults to false.
    );
  } else if (config.type === "medianizer") {
    const requiredFields = ["medianizedFeeds"];

    if (isMissingField(config, requiredFields, logger)) {
      return null;
    }

    if (config.medianizedFeeds.length === 0) {
      logger.error({
        at: "createPriceFeed",
        message: "MedianizerPriceFeed configured with 0 feeds to medianize🚨"
      });
      return null;
    }

    // Loop over all the price feeds to medianize.
    const priceFeeds = [];
    for (const medianizedFeedConfig of config.medianizedFeeds) {
      // The medianized feeds should inherit config options from the parent config if it doesn't define those values
      // itself.
      // Note: ensure that type isn't inherited because this could create infinite recursion if the type isn't defined
      // on the nested config.
      const combinedConfig = { ...config, type: undefined, ...medianizedFeedConfig };

      const priceFeed = await createPriceFeed(logger, web3, networker, getTime, combinedConfig);

      if (priceFeed === null) {
        // If one of the nested feeds errored and returned null, just return null up the stack.
        // Note: no need to log an error since the nested feed construction should have thrown it.
        return null;
      }

      priceFeeds.push(priceFeed);
    }

    logger.debug({
      at: "createPriceFeed",
      message: "Creating MedianizerPriceFeed",
      config
    });

    return new MedianizerPriceFeed(priceFeeds);
  }

  logger.error({
    at: "createPriceFeed",
    message: "Invalid price feed type specified🚨",
    config
  });

  return null;
}

function isMissingField(config, requiredFields, logger) {
  const missingField = requiredFields.find(field => config[field] === undefined);
  if (missingField !== undefined) {
    logger.error({
      at: "createPriceFeed",
      message: "Config is missing field🚨",
      priceFeedType: config.type,
      requiredFields,
      missingField,
      config
    });
    return true;
  }

  return false;
}

async function createReferencePriceFeedForEmp(logger, web3, networker, getTime, empAddress, config) {
  // TODO: maybe move this default config to a better location.
  const defaultConfigs = {
    "ETH/BTC": {
      type: "medianizer",
      pair: "ethbtc",
      lookback: 7200,
      minTimeBetweenUpdates: 60,
      medianizedFeeds: [
        { type: "cryptowatch", exchange: "coinbase-pro" },
        { type: "cryptowatch", exchange: "binance" },
        { type: "cryptowatch", exchange: "bitstamp" }
      ]
    }
  };

  const emp = getEmpAtAddress(web3, empAddress);
  const identifier = web3.utils.hexToUtf8(await emp.methods.priceIdentifier.call());
  const defaultConfig = defaultConfigs[identifier];

  let combinedConfig;
  if (defaultConfig && config) {
    // Combine the two configs, giving the user-config's properties precedence.
    combinedConfig = { ...defaultConfig, ...config };

    logger.debug({
      at: "createReferencePriceFeedForEmp",
      message: "Found both a default config and a user-config",
      defaultConfig,
      userConfig: config,
      combinedConfig
    });
  } else {
    combinedConfig = defaultConfig || config;

    if (!combinedConfig) {
      throw "createReferencePriceFeedForEmp: No default config was found and no user config was provided.";
    }
  }

  return createPriceFeed(logger, web3, networker, getTime, config);
}

async function createUniswapPriceFeedForEmp(logger, web3, networker, getTime, empAddress, uniswapAddress, config) {
  const emp = getEmpAtAddress(web3, empAddress);

  const collateralAddress = await emp.methods.collateralCurrency.call();
  const tokenAddress = await emp.methods.tokenCurrency.call();

  // Compute the uniswap address:
  // 1. Sort the token addresses
  // 2. Compute pair address: https://uniswap.org/docs/v2/technical-considerations/pair-addresses/.
  const uniswapAddress = null;

  // TODO: maybe move this default config to a better location.
  const defaultConfig = {
    type: "uniswap",
    twapLength: 2,
    lookback: 7200,
    uniswapAddress
  };

  const userConfig = config || {};

  return createPriceFeed(logger, web3, networker, getTime, { ...defaultConfig, ...userConfig });
}

function getEmpAtAddress(web3, empAddress) {
  return new web3.eth.Contract(ExpiringMultiParty.abi, empAddress);
}

module.exports = {
  createPriceFeed
};

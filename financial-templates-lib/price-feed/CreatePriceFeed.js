const { MedianizerPriceFeed } = require("./MedianizerPriceFeed");
const { CryptoWatchPriceFeed } = require("./CryptoWatchPriceFeed");
const { UniswapPriceFeed } = require("./UniswapPriceFeed");

const Uniswap = require("../../core/build/contracts/Uniswap.json");

async function createPriceFeed(web3, logger, networker, getTime, config) {
  if (config.type === "cryptowatch") {
    const requiredFields = ["apiKey", "exchange", "pair", "lookback", "minTimeBetweenUpdates"];

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
      getTime
    );
  } else if (config.type === "medianizer") {
    const requiredFields = ["medianizedFeeds"];

    if (isMissingField(config, requiredFields, logger)) {
      return null;
    }

    if (config.medianizedFeeds.length === 0) {
      logger.error({
        at: "createPriceFeed",
        message: "MedianizerPriceFeed configured with 0 feeds to medianize"
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

      const priceFeed = await createPriceFeed(web3, logger, networker, getTime, combinedConfig);

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
    message: "Invalid price feed type specified",
    config
  });

  return null;
}

function isMissingField(config, requiredFields, logger) {
  const missingField = requiredFields.find(field => config[field] === undefined);
  if (missingField !== undefined) {
    logger.error({
      at: "createPriceFeed",
      message: "Config is missing field",
      priceFeedType: config.type,
      requiredFields,
      missingField,
      config
    });
    return true;
  }

  return false;
}

module.exports = {
  createPriceFeed
};

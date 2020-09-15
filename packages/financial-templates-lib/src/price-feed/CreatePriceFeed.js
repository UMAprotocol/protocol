const assert = require("assert");
const { ChainId, Token, Pair, TokenAmount } = require("@uniswap/sdk");
const { MedianizerPriceFeed } = require("./MedianizerPriceFeed");
const { CryptoWatchPriceFeed } = require("./CryptoWatchPriceFeed");
const { UniswapPriceFeed } = require("./UniswapPriceFeed");
const { BalancerPriceFeed } = require("./BalancerPriceFeed");

const Uniswap = require("@uma/core/build/contracts/Uniswap.json");
const ExpiringMultiParty = require("@uma/core/build/contracts/ExpiringMultiParty.json");
const Balancer = require("@uma/core/build/contracts/Balancer.json");

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
      config.minTimeBetweenUpdates,
      config.invertPrice, // Not checked in config because this parameter just defaults to false.
      config.decimals // This defaults to 18 unless supplied by user
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
  } else if (config.type === "balancer") {
    const requiredFields = ["balancerAddress", "balancerTokenIn", "balancerTokenOut", "lookback"];

    if (isMissingField(config, requiredFields, logger)) {
      return null;
    }

    logger.debug({
      at: "balancerPriceFeed",
      message: "Creating balancerPriceFeed",
      config
    });

    return new BalancerPriceFeed(
      logger,
      web3,
      getTime,
      Balancer.abi,
      config.balancerAddress,
      config.balancerTokenIn,
      config.balancerTokenOut,
      config.lookback
    );
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

async function getUniswapPairDetails(web3, syntheticTokenAddress, collateralCurrencyAddress) {
  const networkId = await web3.eth.net.getId();

  if (process.env.UNISWAP_ADDRESS) {
    // Used for mock uniswap pair contracts.
    return { address: process.env.UNISWAP_ADDRESS, inverted: false };
  } else if (networkId in Object.keys(ChainId)) {
    // If Uniswap V2 supports this network, compute the address using the SDK.
    const syntheticToken = new Token(networkId, syntheticTokenAddress, 18, "", "");
    const collateralCurrency = new Token(networkId, collateralCurrencyAddress, 18, "", "");
    const pair = new Pair(new TokenAmount(syntheticToken, "0"), new TokenAmount(collateralCurrency, "0"));

    // If the synthetic token is token1 (numerator), the price needs to be inverted.
    const inverted = syntheticToken.equals(pair.token1);

    // Uniswap pair addresses are computed deterministically, so no on-chain calls are needed.
    return { pairAddress: Pair.getAddress(syntheticToken, collateralCurrency), inverted };
  }

  return {};
}

async function createBalancerPriceFeedForEmp(logger, web3, networker, getTime, empAddress, config = {}) {
  assert(empAddress, "createBalancerPriceFeedForEmp: Must pass in an `empAddress`");
  const emp = getEmpAtAddress(web3, empAddress);
  const balancerTokenIn = await emp.methods.tokenCurrency().call();
  // disable lookback by default
  const lookback = 0;
  return createPriceFeed(logger, web3, networker, getTime, { balancerTokenIn, lookback, ...config });
}

async function createUniswapPriceFeedForEmp(logger, web3, networker, getTime, empAddress, config) {
  if (!empAddress) {
    throw new Error("createUniswapPriceFeedForEmp: Must pass in an `empAddress`");
  }

  const emp = getEmpAtAddress(web3, empAddress);

  const collateralCurrencyAddress = await emp.methods.collateralCurrency().call();
  const syntheticTokenAddress = await emp.methods.tokenCurrency().call();

  // Note: order doesn't matter.
  const { pairAddress, inverted } = await getUniswapPairDetails(web3, syntheticTokenAddress, collateralCurrencyAddress);

  if (!pairAddress && !config) {
    throw new Error(
      "No Uniswap Pair address found and no override config provided. Either set UNISWAP_ADDRESS, use a network where there is an official Uniswap V2 deployment or set a default `config` value"
    );
  }

  let defaultConfig;
  if (pairAddress) {
    // TODO: maybe move this default config to a better location.
    defaultConfig = {
      type: "uniswap",
      twapLength: 2, // Essentially turns the TWAP off since block times are >> 2 seconds.
      lookback: 7200,
      invertPrice: inverted,
      uniswapAddress: pairAddress
    };
  } else {
    defaultConfig = {};
  }

  const userConfig = config || {};

  logger.debug({
    at: "createUniswapPriceFeedForEmp",
    message: "Inferred default config from identifier or EMP address",
    empAddress,
    defaultConfig,
    userConfig
  });

  return await createPriceFeed(logger, web3, networker, getTime, { ...defaultConfig, ...userConfig });
}

function createTokenPriceFeedForEmp(logger, web3, networker, getTime, empAddress, config = {}) {
  if (!config || !config.type) {
    return createReferencePriceFeedForEmp(logger, web3, networker, getTime, empAddress, config);
  } else if (config.type == "balancer") {
    return createBalancerPriceFeedForEmp(logger, web3, networker, getTime, empAddress, config);
  } else {
    return createUniswapPriceFeedForEmp(logger, web3, networker, getTime, empAddress, config);
  }
}

// Default price feed configs for currently approved identifiers.
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
  },
  "COMP/USD": {
    // Kovan uses the "/"
    type: "medianizer",
    lookback: 7200,
    minTimeBetweenUpdates: 60,
    medianizedFeeds: [
      { type: "cryptowatch", exchange: "coinbase-pro", pair: "compusd" },
      { type: "cryptowatch", exchange: "poloniex", pair: "compusdt" },
      { type: "cryptowatch", exchange: "ftx", pair: "compusd" }
    ]
  },
  COMPUSD: {
    // Mainnet has no "/"
    type: "medianizer",
    lookback: 7200,
    minTimeBetweenUpdates: 60,
    medianizedFeeds: [
      { type: "cryptowatch", exchange: "coinbase-pro", pair: "compusd" },
      { type: "cryptowatch", exchange: "poloniex", pair: "compusdt" },
      { type: "cryptowatch", exchange: "ftx", pair: "compusd" }
    ]
  },
  USDETH: {
    type: "medianizer",
    lookback: 7200,
    invertPrice: true,
    minTimeBetweenUpdates: 60,
    medianizedFeeds: [
      { type: "cryptowatch", exchange: "coinbase-pro", pair: "ethusd" },
      { type: "cryptowatch", exchange: "binance", pair: "ethusdt" },
      { type: "cryptowatch", exchange: "kraken", pair: "ethusd" }
    ]
  },
  USDBTC: {
    type: "medianizer",
    lookback: 7200,
    invertPrice: true,
    minTimeBetweenUpdates: 60,
    medianizedFeeds: [
      { type: "cryptowatch", exchange: "coinbase-pro", pair: "btcusd" },
      { type: "cryptowatch", exchange: "binance", pair: "btcusdt" },
      { type: "cryptowatch", exchange: "bitstamp", pair: "btcusd" }
    ]
  }
};

/**
 * Create a reference price feed for the EMP. Note: this is the price feed that the token is tracking.
 * @param {Object} winston logger.
 * @param {Object} web3 instance.
 * @param {Object} networker object that the price feed may use to make REST calls.
 * @param {Function} function to get the current time.
 * @param {String} string representing the address of the EMP contract.
 * @param {Object=} config (optional) to override the defaults for this reference feed.
 * @param {String=} identifier (optional) allows caller to choose which default price feed config to use. Required only if the caller does not pass in an `empAddress`
 * @return {Object} an instance of PriceFeedInterface that can be used to get the reference price.
 */
async function createReferencePriceFeedForEmp(logger, web3, networker, getTime, empAddress, config, identifier) {
  // Automatically detect identifier from passed in EMP address or use `identifier`.
  let _identifier;
  let emp;

  if (empAddress) {
    emp = getEmpAtAddress(web3, empAddress);
    _identifier = web3.utils.hexToUtf8(await emp.methods.priceIdentifier().call());
  } else if (identifier) {
    _identifier = identifier;
  } else {
    throw new Error("createReferencePriceFeedForEmp: Must pass in an `empAddress` or an `identifier`");
  }

  const defaultConfig = defaultConfigs[_identifier];

  logger.debug({
    at: "createReferencePriceFeedForEmp",
    message: "Inferred default config from identifier or EMP address",
    empAddress,
    identifier: _identifier,
    defaultConfig
  });

  // Infer lookback from liquidation liveness.
  if (emp && defaultConfig) {
    const lookback = Number((await emp.methods.liquidationLiveness().call()).toString());
    Object.assign(defaultConfig, { lookback });
  }

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
      throw new Error("createReferencePriceFeedForEmp: No default config was found and no user config was provided.");
    }
  }
  return await createPriceFeed(logger, web3, networker, getTime, combinedConfig);
}

function getEmpAtAddress(web3, empAddress) {
  return new web3.eth.Contract(ExpiringMultiParty.abi, empAddress);
}

module.exports = {
  createPriceFeed,
  createUniswapPriceFeedForEmp,
  createBalancerPriceFeedForEmp,
  createReferencePriceFeedForEmp,
  createTokenPriceFeedForEmp,
  getUniswapPairDetails
};

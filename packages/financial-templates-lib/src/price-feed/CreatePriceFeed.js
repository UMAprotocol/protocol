const assert = require("assert");
const { ChainId, Token, Pair, TokenAmount } = require("@uniswap/sdk");
const { MedianizerPriceFeed } = require("./MedianizerPriceFeed");
const { CryptoWatchPriceFeed } = require("./CryptoWatchPriceFeed");
const { DefiPulseTotalPriceFeed } = require("./DefiPulseTotalPriceFeed");
const { UniswapPriceFeed } = require("./UniswapPriceFeed");
const { BalancerPriceFeed } = require("./BalancerPriceFeed");
const { DominationFinancePriceFeed } = require("./DominationFinancePriceFeed");
const { BasketSpreadPriceFeed } = require("./BasketSpreadPriceFeed");
const { CoinMarketCapPriceFeed } = require("./CoinMarketCapPriceFeed");
const { CoinGeckoPriceFeed } = require("./CoinGeckoPriceFeed");
const { TraderMadePriceFeed } = require("./TraderMadePriceFeed");
const { PriceFeedMockScaled } = require("./PriceFeedMockScaled");
const { InvalidPriceFeedMock } = require("./InvalidPriceFeedMock");
const { defaultConfigs } = require("./DefaultPriceFeedConfigs");
const { getTruffleContract } = require("@uma/core");
const { ExpressionPriceFeed, math, escapeSpecialCharacters } = require("./ExpressionPriceFeed");
const { VaultPriceFeed } = require("./VaultPriceFeed");
const { LPPriceFeed } = require("./LPPriceFeed");
const { BlockFinder } = require("./utils");

async function createPriceFeed(logger, web3, networker, getTime, config) {
  const Uniswap = getTruffleContract("Uniswap", web3, "latest");
  const ERC20 = getTruffleContract("ExpandedERC20", web3, "latest");
  const Balancer = getTruffleContract("Balancer", web3, "latest");
  const VaultInterface = getTruffleContract("VaultInterface", web3, "latest");

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
      config.priceFeedDecimals, // Defaults to 18 unless supplied. Informs how the feed should be scaled to match a DVM response.
      config.ohlcPeriod // Defaults to 60 unless supplied.
    );
  } else if (config.type === "domfi") {
    const requiredFields = ["pair", "lookback", "minTimeBetweenUpdates"];

    if (isMissingField(config, requiredFields, logger)) {
      return null;
    }

    logger.debug({
      at: "createPriceFeed",
      message: "Creating DominationFinancePriceFeed",
      config
    });

    return new DominationFinancePriceFeed(
      logger,
      web3,
      config.pair,
      config.lookback,
      networker,
      getTime,
      config.minTimeBetweenUpdates,
      config.invertPrice, // Not checked in config because this parameter just defaults to false.
      config.priceFeedDecimals, // This defaults to 18 unless supplied by user
      config.tickPeriod // Defaults to 60 unless supplied.
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
      ERC20.abi,
      web3,
      config.uniswapAddress,
      config.twapLength,
      config.lookback,
      getTime,
      config.invertPrice, // Not checked in config because this parameter just defaults to false.
      config.priceFeedDecimals // This defaults to 18 unless supplied by user
    );
  } else if (config.type === "defipulsetvl") {
    const requiredFields = ["lookback", "minTimeBetweenUpdates", "apiKey"];

    if (isMissingField(config, requiredFields, logger)) {
      return null;
    }

    logger.debug({
      at: "createPriceFeed",
      message: "Creating DefiPulseTotalPriceFeed",
      config
    });

    return new DefiPulseTotalPriceFeed(
      logger,
      web3,
      config.apiKey,
      config.lookback,
      networker,
      getTime,
      config.minTimeBetweenUpdates,
      config.priceFeedDecimals
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

    logger.debug({
      at: "createPriceFeed",
      message: "Creating MedianizerPriceFeed",
      config
    });

    // Loop over all the price feeds to medianize.
    return await _createMedianizerPriceFeed(config);
  } else if (config.type === "balancer") {
    const requiredFields = ["balancerAddress", "balancerTokenIn", "balancerTokenOut", "lookback", "twapLength"];

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
      config.lookback,
      config.twapLength,
      config.poolDecimals,
      config.priceFeedDecimals // This defaults to 18 unless supplied by user
    );
  } else if (config.type === "basketspread") {
    const requiredFields = ["baselinePriceFeeds", "experimentalPriceFeeds"];

    if (isMissingField(config, requiredFields, logger)) {
      return null;
    }

    logger.debug({
      at: "createPriceFeed",
      message: "Creating Baskets of MedianizedPriceFeeds",
      config
    });

    // Currently, this file assumes that the baskets are lists of medianizer price feeds, and that the
    // denominator is a medianizer pricefeed.
    // Future work would relax these constraint and allow for the baskets and denominator to be
    // any type of price feed.
    const experimentalPriceFeeds = await _createBasketOfMedianizerPriceFeeds(config.experimentalPriceFeeds);
    const baselinePriceFeeds = await _createBasketOfMedianizerPriceFeeds(config.baselinePriceFeeds);
    const denominatorPriceFeed =
      config.denominatorPriceFeed && (await _createMedianizerPriceFeed(config.denominatorPriceFeed));

    return new BasketSpreadPriceFeed(web3, logger, baselinePriceFeeds, experimentalPriceFeeds, denominatorPriceFeed);
  } else if (config.type === "coinmarketcap") {
    const requiredFields = ["apiKey", "symbol", "quoteCurrency", "lookback", "minTimeBetweenUpdates"];

    if (isMissingField(config, requiredFields, logger)) {
      return null;
    }

    logger.debug({
      at: "createPriceFeed",
      message: "Creating CoingMarketCapPriceFeed",
      config
    });

    return new CoinMarketCapPriceFeed(
      logger,
      web3,
      config.apiKey,
      config.symbol,
      config.quoteCurrency,
      config.lookback,
      networker,
      getTime,
      config.minTimeBetweenUpdates,
      config.invertPrice, // Not checked in config because this parameter just defaults to false.
      config.priceFeedDecimals // Defaults to 18 unless supplied. Informs how the feed should be scaled to match a DVM response.
    );
  } else if (config.type === "coingecko") {
    const requiredFields = ["contractAddress", "quoteCurrency", "lookback", "minTimeBetweenUpdates"];

    if (isMissingField(config, requiredFields, logger)) {
      return null;
    }

    logger.debug({
      at: "createPriceFeed",
      message: "Creating CoinGeckoPriceFeed",
      config
    });

    return new CoinGeckoPriceFeed(
      logger,
      web3,
      config.contractAddress,
      config.quoteCurrency,
      config.lookback,
      networker,
      getTime,
      config.minTimeBetweenUpdates,
      config.invertPrice, // Not checked in config because this parameter just defaults to false.
      config.priceFeedDecimals // Defaults to 18 unless supplied. Informs how the feed should be scaled to match a DVM response.
    );
  } else if (config.type === "tradermade") {
    const requiredFields = ["pair", "apiKey", "minTimeBetweenUpdates"];

    if (isMissingField(config, requiredFields, logger)) {
      return null;
    }

    logger.debug({
      at: "createPriceFeed",
      message: "Creating TraderMadePriceFeed",
      config
    });

    return new TraderMadePriceFeed(
      logger,
      web3,
      config.apiKey,
      config.pair,
      config.minuteLookback,
      config.hourlyLookback,
      networker,
      getTime,
      config.minTimeBetweenUpdates,
      config.priceFeedDecimals, // Defaults to 18 unless supplied. Informs how the feed should be scaled to match a DVM response.
      config.ohlcPeriod
    );
  } else if (config.type === "test") {
    const requiredFields = ["currentPrice", "historicalPrice"];
    if (isMissingField(config, requiredFields, logger)) {
      return null;
    }
    logger.debug({
      at: "createPriceFeed",
      message: "Creating PriceFeedMockScaled",
      config
    });

    return new PriceFeedMockScaled(
      config.currentPrice,
      config.historicalPrice,
      null,
      config.priceFeedDecimals, // Defaults to 18 unless supplied. Informs how the feed should be scaled to match a DVM response.
      config.lookback
    );
  } else if (config.type === "invalid") {
    logger.debug({
      at: "createPriceFeed",
      message: "Creating InvalidPriceFeed",
      config
    });

    return new InvalidPriceFeedMock();
  } else if (config.type === "expression") {
    const requiredFields = ["expression"];
    if (isMissingField(config, requiredFields, logger)) {
      return null;
    }

    logger.debug({
      at: "createPriceFeed",
      message: "Creating ExpressionPriceFeed",
      config
    });

    return await _createExpressionPriceFeed(config);
  } else if (config.type === "vault") {
    const requiredFields = ["address"];
    if (isMissingField(config, requiredFields, logger)) {
      return null;
    }

    logger.debug({
      at: "createPriceFeed",
      message: "Creating VaultPriceFeed",
      config
    });

    return new VaultPriceFeed({
      ...config,
      logger,
      web3,
      getTime,
      vaultAbi: VaultInterface.abi,
      erc20Abi: ERC20.abi,
      vaultAddress: config.address,
      blockFinder: getSharedBlockFinder(web3)
    });
  } else if (config.type === "lp") {
    const requiredFields = ["poolAddress", "tokenAddress"];
    if (isMissingField(config, requiredFields, logger)) {
      return null;
    }

    logger.debug({
      at: "createPriceFeed",
      message: "Creating LPPriceFeed",
      config
    });

    return new LPPriceFeed({
      ...config,
      logger,
      web3,
      getTime,
      erc20Abi: ERC20.abi,
      blockFinder: getSharedBlockFinder(web3)
    });
  }

  logger.error({
    at: "createPriceFeed",
    message: "Invalid price feed type specified🚨",
    config
  });

  return null;

  // Internal helper methods:

  // Returns an ExpressionPriceFeed.
  async function _createExpressionPriceFeed(expressionConfig) {
    // Build list of configs that could be used in the expression including default price feed configs and customFeeds
    // that the user has provided inside the ExpressionPriceFeed config. Note: default configs are overriden by
    // customFeeds with the same name. Tranform keys by escaping any special characters in the identifier names..
    const allConfigs = Object.fromEntries(
      Object.entries({ ...defaultConfigs, ...expressionConfig.customFeeds }).map(([key, value]) => {
        return [escapeSpecialCharacters(key), value];
      })
    );

    // This call chain:
    // 1. Parses the expression into an expression tree of nodes.
    // 2. Filters for "symbol" nodes, which would be price feed identifiers in this case.
    // 3. Extract the name property for each of these symbol nodes
    // 4. Puts it all in a set and converts back to an array to dedupe any repeated values.
    const symbols = Array.from(
      new Set(
        math
          .parse(expressionConfig.expression)
          .filter(node => node.isSymbolNode)
          .map(node => node.name)
      )
    );

    // This is a complicated looking map that maps each symbol into an entry in an object with its value the price
    // feed created from the mapped config in allConfigs.
    const priceFeedMap = Object.fromEntries(
      await Promise.all(
        symbols.map(async symbol => {
          const config = allConfigs[symbol];

          // If there is no config for this symbol, insert null and send an error.
          if (!config) {
            logger.error({
              at: "_createExpressionPriceFeed",
              message: `No price feed config found for symbol: ${symbol} 🚨`,
              expressionConfig
            });
            return [symbol, null];
          }

          // These configs will inherit the expression config values (except type), but prefer the individual config's
          // value when present.
          const combinedConfig = { ...expressionConfig, type: undefined, ...config };

          // If this returns null, just return upstream since the error has already been logged and the null will be
          // detected upstream.
          const priceFeed = await createPriceFeed(logger, web3, networker, getTime, combinedConfig);
          return [symbol, priceFeed];
        })
      )
    );

    // Return null if any of the price feeds in the map are null (meaning there was an error).
    if (Object.values(priceFeedMap).some(priceFeed => priceFeed === null)) return null;

    return new ExpressionPriceFeed(priceFeedMap, expressionConfig.expression, expressionConfig.priceFeedDecimals);
  }

  // Returns a MedianizerPriceFeed
  async function _createMedianizerPriceFeed(medianizerConfig) {
    const priceFeedsToMedianize = [];
    for (const _priceFeedConfig of medianizerConfig.medianizedFeeds) {
      // The medianized feeds should inherit config options from the parent config if it doesn't define those values
      // itself.
      // Note: ensure that type isn't inherited because this could create infinite recursion if the type isn't defined
      // on the nested config.
      const combinedConfig = { ...config, type: undefined, ..._priceFeedConfig };

      const priceFeed = await createPriceFeed(logger, web3, networker, getTime, combinedConfig);

      if (priceFeed === null) {
        // If one of the nested feeds errored and returned null, just return null up the stack.
        // Note: no need to log an error since the nested feed construction should have thrown it.
        return null;
      }

      priceFeedsToMedianize.push(priceFeed);
    }
    return new MedianizerPriceFeed(priceFeedsToMedianize, medianizerConfig.computeMean);
  }

  // Returns an array or "basket" of MedianizerPriceFeeds
  async function _createBasketOfMedianizerPriceFeeds(medianizerConfigs) {
    return await Promise.all(medianizerConfigs.map(config => _createMedianizerPriceFeed(config)));
  }
}

// Simple function to grab a singleton instance of the blockFinder to share the cache.
function getSharedBlockFinder(web3) {
  // Attach the blockFinder to this function.
  if (!getSharedBlockFinder.blockFinder) {
    getSharedBlockFinder.blockFinder = BlockFinder(web3.eth.getBlock);
  }
  return getSharedBlockFinder.blockFinder;
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

async function createBalancerPriceFeedForFinancialContractI(
  logger,
  web3,
  networker,
  getTime,
  financialContractAddress,
  config = {}
) {
  assert(
    financialContractAddress,
    "createBalancerPriceFeedForFinancialContractI: Must pass in an `financialContractAddress`"
  );
  const financialContract = getFinancialContractIdentifierAtAddress(web3, financialContractAddress);
  const balancerTokenIn = await financialContract.methods.tokenCurrency().call();
  // disable lookback and twap by default
  const lookback = 0;
  const twapLength = 0;
  return createPriceFeed(logger, web3, networker, getTime, { balancerTokenIn, lookback, twapLength, ...config });
}

async function createUniswapPriceFeedForFinancialContract(
  logger,
  web3,
  networker,
  getTime,
  financialContractAddress,
  config
) {
  if (!financialContractAddress) {
    throw new Error("createUniswapPriceFeedForFinancialContract: Must pass in an `financialContractAddress`");
  }

  const financialContract = getFinancialContractIdentifierAtAddress(web3, financialContractAddress);

  const collateralCurrencyAddress = await financialContract.methods.collateralCurrency().call();
  const syntheticTokenAddress = await financialContract.methods.tokenCurrency().call();

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
    at: "createUniswapPriceFeedForFinancialContract",
    message: "Inferred default config from identifier or Financial Contract address",
    financialContractAddress,
    defaultConfig,
    userConfig
  });

  return await createPriceFeed(logger, web3, networker, getTime, { ...defaultConfig, ...userConfig });
}

function createTokenPriceFeedForFinancialContract(
  logger,
  web3,
  networker,
  getTime,
  financialContractAddress,
  config = {}
) {
  if (!config || !config.type) {
    return createReferencePriceFeedForFinancialContract(
      logger,
      web3,
      networker,
      getTime,
      financialContractAddress,
      config
    );
  } else if (config.type == "balancer") {
    return createBalancerPriceFeedForFinancialContractI(
      logger,
      web3,
      networker,
      getTime,
      financialContractAddress,
      config
    );
  } else {
    return createUniswapPriceFeedForFinancialContract(
      logger,
      web3,
      networker,
      getTime,
      financialContractAddress,
      config
    );
  }
}

/**
 * Create a reference price feed for the Financial Contract. Note: this is the price feed that the token is tracking.
 * @param {Object} winston logger.
 * @param {Object} web3 instance.
 * @param {Object} networker object that the price feed may use to make REST calls.
 * @param {Function} function to get the current time.
 * @param {String} string representing the address of the Financial Contract contract.
 * @param {Object=} config (optional) to override the defaults for this reference feed.
 * @param {String=} identifier (optional) allows caller to choose which default price feed config to use. Required only if the caller does not pass in an `financialContractAddress`
 * @return {Object} an instance of PriceFeedInterface that can be used to get the reference price.
 */
async function createReferencePriceFeedForFinancialContract(
  logger,
  web3,
  networker,
  getTime,
  financialContractAddress,
  config,
  identifier
) {
  // Automatically detect identifier from passed in Financial Contract address or use `identifier`.
  let _identifier;
  let financialContract;

  if (financialContractAddress) {
    financialContract = getFinancialContractIdentifierAtAddress(web3, financialContractAddress);
    _identifier = web3.utils.hexToUtf8(await financialContract.methods.priceIdentifier().call());
  } else if (identifier) {
    _identifier = identifier;
  } else {
    throw new Error(
      "createReferencePriceFeedForFinancialContract: Must pass in an `financialContractAddress` or an `identifier`"
    );
  }

  const defaultConfig = defaultConfigs[_identifier];

  logger.debug({
    at: "createReferencePriceFeedForFinancialContract",
    message: "Inferred default config from identifier or Financial Contract address",
    financialContractAddress,
    identifier: _identifier,
    defaultConfig
  });

  // Infer lookback from liquidation liveness if user does not explicitly set a lookback.
  if (financialContract && defaultConfig && !defaultConfig.lookback) {
    const lookback = Number((await financialContract.methods.liquidationLiveness().call()).toString());
    Object.assign(defaultConfig, { lookback });
  }

  let combinedConfig;
  if (defaultConfig && config) {
    // Combine the two configs, giving the user-config's properties precedence.
    combinedConfig = { ...defaultConfig, ...config };

    logger.debug({
      at: "createReferencePriceFeedForFinancialContract",
      message: "Found both a default config and a user-config",
      defaultConfig,
      userConfig: config,
      combinedConfig
    });
  } else {
    combinedConfig = defaultConfig || config;

    if (!combinedConfig) {
      throw new Error(
        "createReferencePriceFeedForFinancialContract: No default config was found and no user config was provided."
      );
    }
    // Check if there is an override for the getTime method in the price feed config. Specifically, we can replace the
    // get time method with the current block time.
    if (combinedConfig.getTimeOverride) {
      if (combinedConfig.getTimeOverride.useBlockTime) {
        getTime = async () =>
          web3.eth.getBlock("latest").then(block => {
            return block.timestamp;
          });
      }
    }
  }
  return await createPriceFeed(logger, web3, networker, getTime, combinedConfig);
}

function getFinancialContractIdentifierAtAddress(web3, financialContractAddress) {
  const ExpiringMultiParty = getTruffleContract("ExpiringMultiParty", web3, "1.2.0");
  return new web3.eth.Contract(ExpiringMultiParty.abi, financialContractAddress);
}

module.exports = {
  createPriceFeed,
  createUniswapPriceFeedForFinancialContract,
  createBalancerPriceFeedForFinancialContractI,
  createReferencePriceFeedForFinancialContract,
  createTokenPriceFeedForFinancialContract,
  getUniswapPairDetails
};

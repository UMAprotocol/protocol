import assert = require("assert");
import { ChainId, Token, Pair, TokenAmount } from "@uniswap/sdk";
import { defaultConfigs } from "./DefaultPriceFeedConfigs";
import { getAbi } from "@uma/contracts-node";
import { BlockFinder } from "./utils";
import { getPrecisionForIdentifier, PublicNetworks } from "@uma/common";
import { multicallAddressMap } from "../helpers/multicall";
import Web3 from "web3";

// Price feed interfaces (sorted alphabetically)
import { BalancerPriceFeed } from "./BalancerPriceFeed";
import { BasketSpreadPriceFeed } from "./BasketSpreadPriceFeed";
import { CoinGeckoPriceFeed } from "./CoinGeckoPriceFeed";
import { CoinMarketCapPriceFeed } from "./CoinMarketCapPriceFeed";
import { CryptoWatchPriceFeed } from "./CryptoWatchPriceFeed";
import { DefiPulsePriceFeed } from "./DefiPulsePriceFeed";
import { DominationFinancePriceFeed } from "./DominationFinancePriceFeed";
import { ETHVIXPriceFeed } from "./EthVixPriceFeed";
import { ExpressionPriceFeed, math, escapeSpecialCharacters } from "./ExpressionPriceFeed";
import { FallBackPriceFeed } from "./FallBackPriceFeed";
import { ForexDailyPriceFeed } from "./ForexDailyPriceFeed";
import { FundingRateMultiplierPriceFeed } from "./FundingRateMultiplierPriceFeed";
import { InvalidPriceFeedMock } from "./InvalidPriceFeedMock";
import { LPPriceFeed } from "./LPPriceFeed";
import { MedianizerPriceFeed } from "./MedianizerPriceFeed";
import { PriceFeedMockScaled } from "./PriceFeedMockScaled";
import { QuandlPriceFeed } from "./QuandlPriceFeed";
import { TraderMadePriceFeed } from "./TraderMadePriceFeed";
import { UniswapV2PriceFeed, UniswapV3PriceFeed } from "./UniswapPriceFeed";
import { VaultPriceFeed, HarvestVaultPriceFeed } from "./VaultPriceFeed";
import { USPACPriceFeed } from "./USPACPriceFeed";

import type { Logger } from "winston";
import { NetworkerInterface } from "./Networker";
import { PriceFeedInterface } from "./PriceFeedInterface";
import { isDefined } from "../types";
import type { BlockTransactionBase } from "web3-eth";

interface Block {
  number: number;
  timestamp: number;
}

// Global cache for block (promises) used by uniswap price feeds.
const uniswapBlockCache: { [blockNumber: number]: Promise<Block> } = {};

export async function createPriceFeed(
  logger: Logger,
  web3: Web3,
  networker: NetworkerInterface,
  getTime: () => Promise<number>,
  config: any
): Promise<PriceFeedInterface | null> {
  let providedWeb3: Web3;
  if (config.chainId && Number.isInteger(Number(config.chainId))) {
    const nodeUrl = process.env[`NODE_URL_${config.chainId}`];
    if (!nodeUrl) throw Error(`Expected node url to be provided in env variable NODE_URL_${config.chainId}`);
    providedWeb3 = new Web3(nodeUrl);
  } else {
    providedWeb3 = web3;
  }

  if (config.type === "cryptowatch") {
    const requiredFields = ["exchange", "pair", "lookback", "minTimeBetweenUpdates"];

    if (isMissingField(config, requiredFields, logger)) {
      return null;
    }

    logger.debug({ at: "createPriceFeed", message: "Creating CryptoWatchPriceFeed", config });

    return new CryptoWatchPriceFeed(
      logger,
      providedWeb3,
      config.cryptowatchApiKey,
      config.exchange,
      config.pair,
      config.lookback,
      networker,
      getTime,
      config.minTimeBetweenUpdates,
      config.invertPrice, // Not checked in config because this parameter just defaults to false.
      config.priceFeedDecimals, // Defaults to 18 unless supplied. Informs how the feed should be scaled to match a DVM response.
      config.ohlcPeriod, // Defaults to 60 unless supplied.
      config.twapLength,
      config.historicalTimestampBuffer
    );
  } else if (config.type === "quandl") {
    const requiredFields = ["datasetCode", "databaseCode", "lookback", "quandlApiKey"];

    if (isMissingField(config, requiredFields, logger)) {
      return null;
    }

    logger.debug({ at: "createPriceFeed", message: "Creating QuandlPriceFeed", config });

    return new QuandlPriceFeed(
      logger,
      providedWeb3,
      config.quandlApiKey,
      config.datasetCode,
      config.databaseCode,
      config.lookback,
      networker,
      getTime,
      config.priceFeedDecimals, // Defaults to 18 unless supplied. Informs how the feed should be scaled to match a DVM response.
      config.minTimeBetweenUpdates // Defaults to 43200 (12 hours) unless supplied.
    );
  } else if (config.type === "domfi") {
    const requiredFields = ["pair", "lookback", "minTimeBetweenUpdates"];

    if (isMissingField(config, requiredFields, logger)) {
      return null;
    }

    logger.debug({ at: "createPriceFeed", message: "Creating DominationFinancePriceFeed", config });

    return new DominationFinancePriceFeed(
      logger,
      providedWeb3,
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

    logger.debug({ at: "createPriceFeed", message: "Creating UniswapPriceFeed", config });

    if (config.version !== undefined && config.version !== "v2" && config.version !== "v3") return null;

    const [uniswapAbi, UniswapPriceFeed] =
      config.version === "v3" ? [getAbi("UniswapV3"), UniswapV3PriceFeed] : [getAbi("UniswapV2"), UniswapV2PriceFeed];

    return new UniswapPriceFeed(
      logger,
      uniswapAbi,
      getAbi("ERC20"),
      providedWeb3,
      config.uniswapAddress,
      config.twapLength,
      config.lookback,
      getTime,
      config.invertPrice, // Not checked in config because this parameter just defaults to false.
      config.priceFeedDecimals, // This defaults to 18 unless supplied by user
      uniswapBlockCache
    );
  } else if (config.type === "forexdaily") {
    const requiredFields = ["base", "symbol", "lookback"];

    if (isMissingField(config, requiredFields, logger)) {
      return null;
    }

    logger.debug({ at: "createPriceFeed", message: "Creating ForexDailyPriceFeed", config });

    return new ForexDailyPriceFeed(
      logger,
      providedWeb3,
      config.base,
      config.symbol,
      config.lookback,
      networker,
      getTime,
      config.priceFeedDecimals, // Defaults to 18 unless supplied. Informs how the feed should be scaled to match a DVM response.
      config.minTimeBetweenUpdates // Defaults to 43200 (12 hours) unless supplied.
    );
  } else if (config.type === "defipulse") {
    const requiredFields = ["lookback", "minTimeBetweenUpdates", "defipulseApiKey", "project"];

    if (isMissingField(config, requiredFields, logger)) {
      return null;
    }

    logger.debug({ at: "createPriceFeed", message: "Creating DefiPulsePriceFeed", config });

    return new DefiPulsePriceFeed(
      logger,
      providedWeb3,
      config.defipulseApiKey,
      config.lookback,
      networker,
      getTime,
      config.minTimeBetweenUpdates,
      config.priceFeedDecimals,
      config.project
    );
  } else if (config.type === "medianizer") {
    const requiredFields = ["medianizedFeeds"];

    if (isMissingField(config, requiredFields, logger)) {
      return null;
    }

    if (config.medianizedFeeds.length === 0) {
      logger.error({ at: "createPriceFeed", message: "MedianizerPriceFeed configured with 0 feeds to medianize🚨" });
      return null;
    }

    logger.debug({ at: "createPriceFeed", message: "Creating MedianizerPriceFeed", config });

    // Loop over all the price feeds to medianize.
    return await _createMedianizerPriceFeed(config);
  } else if (config.type === "fallback") {
    const requiredFields = ["orderedFeeds"];

    if (isMissingField(config, requiredFields, logger)) {
      return null;
    }

    if (config.orderedFeeds.length === 0) {
      logger.error({ at: "createPriceFeed", message: "FallBackPriceFeed configured with 0 feeds🚨" });
      return null;
    }

    logger.debug({ at: "createPriceFeed", message: "Creating FallBackPriceFeed", config });

    return await _createFallBackPriceFeed(config);
  } else if (config.type === "balancer") {
    const requiredFields = ["balancerAddress", "balancerTokenIn", "balancerTokenOut", "lookback", "twapLength"];

    if (isMissingField(config, requiredFields, logger)) {
      return null;
    }

    logger.debug({ at: "balancerPriceFeed", message: "Creating balancerPriceFeed", config });

    return new BalancerPriceFeed(
      logger,
      providedWeb3,
      getTime,
      getAbi("Balancer"),
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

    logger.debug({ at: "createPriceFeed", message: "Creating Baskets of MedianizedPriceFeeds", config });

    // Currently, this file assumes that the baskets are lists of medianizer price feeds, and that the
    // denominator is a medianizer pricefeed.
    // Future work would relax these constraint and allow for the baskets and denominator to be
    // any type of price feed.
    const experimentalPriceFeeds = await _createBasketOfMedianizerPriceFeeds(config.experimentalPriceFeeds);
    const baselinePriceFeeds = await _createBasketOfMedianizerPriceFeeds(config.baselinePriceFeeds);
    const denominatorPriceFeed =
      config.denominatorPriceFeed && (await _createMedianizerPriceFeed(config.denominatorPriceFeed));

    if (!baselinePriceFeeds.every(isDefined) || !experimentalPriceFeeds.every(isDefined)) return null;

    return new BasketSpreadPriceFeed(
      providedWeb3,
      logger,
      baselinePriceFeeds,
      experimentalPriceFeeds,
      denominatorPriceFeed
    );
  } else if (config.type === "coinmarketcap") {
    const requiredFields = ["cmcApiKey", "symbol", "quoteCurrency", "lookback", "minTimeBetweenUpdates"];

    if (isMissingField(config, requiredFields, logger)) {
      return null;
    }

    logger.debug({ at: "createPriceFeed", message: "Creating CoingMarketCapPriceFeed", config });

    return new CoinMarketCapPriceFeed(
      logger,
      providedWeb3,
      config.cmcApiKey,
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

    logger.debug({ at: "createPriceFeed", message: "Creating CoinGeckoPriceFeed", config });

    return new CoinGeckoPriceFeed(
      logger,
      providedWeb3,
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
    const requiredFields = ["pair", "tradermadeApiKey", "minTimeBetweenUpdates"];

    if (isMissingField(config, requiredFields, logger)) {
      return null;
    }

    logger.debug({ at: "createPriceFeed", message: "Creating TraderMadePriceFeed", config });

    return new TraderMadePriceFeed(
      logger,
      providedWeb3,
      config.tradermadeApiKey,
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
    logger.debug({ at: "createPriceFeed", message: "Creating PriceFeedMockScaled", config });

    return new PriceFeedMockScaled(
      config.currentPrice,
      config.historicalPrice,
      config.lastUpdateTime,
      config.priceFeedDecimals, // Defaults to 18 unless supplied. Informs how the feed should be scaled to match a DVM response.
      config.lookback
    );
  } else if (config.type === "ethvix") {
    logger.debug({ at: "createPriceFeed", message: "Creating EthVixPriceFeed", config });

    return new ETHVIXPriceFeed(
      logger,
      providedWeb3,
      config.inverse,
      networker,
      getTime,
      config.minTimeBetweenUpdates,
      config.priceFeedDecimals
    );
  } else if (config.type === "invalid") {
    logger.debug({ at: "createPriceFeed", message: "Creating InvalidPriceFeed", config });

    return new InvalidPriceFeedMock();
  } else if (config.type === "expression") {
    const requiredFields = ["expression"];
    if (isMissingField(config, requiredFields, logger)) {
      return null;
    }

    logger.debug({ at: "createPriceFeed", message: "Creating ExpressionPriceFeed", config });

    return await _createExpressionPriceFeed(config);
  } else if (config.type === "vault") {
    const requiredFields = ["address"];
    if (isMissingField(config, requiredFields, logger)) {
      return null;
    }

    logger.debug({ at: "createPriceFeed", message: "Creating VaultPriceFeed", config });

    return new VaultPriceFeed({
      ...config,
      logger,
      web3: providedWeb3,
      getTime,
      vaultAbi: getAbi("VaultInterface"),
      erc20Abi: getAbi("ERC20"),
      vaultAddress: config.address,
      blockFinder: getSharedBlockFinder(web3),
    });
  } else if (config.type === "harvestvault") {
    const requiredFields = ["address"];
    if (isMissingField(config, requiredFields, logger)) {
      return null;
    }

    logger.debug({ at: "createPriceFeed", message: "Creating HarvestVaultPriceFeed", config });

    return new HarvestVaultPriceFeed({
      ...config,
      logger,
      web3: providedWeb3,
      getTime,
      vaultAbi: getAbi("HarvestVaultInterface"),
      erc20Abi: getAbi("ERC20"),
      vaultAddress: config.address,
      blockFinder: getSharedBlockFinder(web3),
    });
  } else if (config.type === "lp") {
    const requiredFields = ["poolAddress", "tokenAddress"];
    if (isMissingField(config, requiredFields, logger)) {
      return null;
    }

    logger.debug({ at: "createPriceFeed", message: "Creating LPPriceFeed", config });

    return new LPPriceFeed({
      ...(config as { poolAddress: string; tokenAddress: string }),
      logger,
      web3: providedWeb3,
      getTime,
      erc20Abi: getAbi("ERC20"),
      blockFinder: getSharedBlockFinder(web3),
    });
  } else if (config.type === "frm") {
    const requiredFields = ["perpetualAddress"];
    if (isMissingField(config, requiredFields, logger)) {
      return null;
    }

    logger.debug({ at: "createPriceFeed", message: "Creating FundingRateMultiplierPriceFeed", config });

    let multicallAddress = config.multicallAddress;
    if (!multicallAddress) {
      const networkId = await providedWeb3.eth.net.getId();
      const networkName = PublicNetworks[Number(networkId)]?.name;
      multicallAddress = multicallAddressMap[networkName]?.multicall;
    }

    if (!multicallAddress) {
      logger.error({
        at: "createPriceFeed",
        message: "No multicall address provided by config or publicly provided for this network 🚨",
      });
      return null;
    }

    return new FundingRateMultiplierPriceFeed({
      ...(config as { perpetualAddress: string }),
      logger,
      web3: providedWeb3,
      getTime,
      perpetualAbi: getAbi("Perpetual"),
      multicallAddress: multicallAddress,
      blockFinder: getSharedBlockFinder(web3),
    });
  } else if (config.type === "uSPAC") {
    const requiredFields = ["lookback", "symbols", "rapidApiKey", "correctionFactor"];

    if (isMissingField(config, requiredFields, logger)) {
      return null;
    }

    logger.debug({ at: "createPriceFeed", message: "Creating USPACPriceFeed", config });

    return new USPACPriceFeed(
      logger,
      web3,
      config.symbols,
      config.correctionFactor,
      config.rapidApiKey,
      config.interval,
      config.lookback,
      networker,
      getTime,
      config.priceFeedDecimals,
      config.minTimeBetweenUpdates
    );
  }

  logger.error({ at: "createPriceFeed", message: "Invalid price feed type specified🚨", config });

  return null;

  // Internal helper methods:

  // Returns an ExpressionPriceFeed.
  async function _createExpressionPriceFeed(expressionConfig: {
    customFeeds: { [symbol: string]: any };
    expression: string;
    priceFeedDecimals?: number;
  }): Promise<ExpressionPriceFeed | null> {
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
          .filter((node) => node.isSymbolNode)
          .map((node) => node.name)
      )
    ).filter(isDefined);

    // This is a complicated looking map that maps each symbol into an entry in an object with its value the price
    // feed created from the mapped config in allConfigs.
    const priceFeedMap = Object.fromEntries(
      (
        await Promise.all(
          symbols.map(
            async (symbol: string): Promise<null | [string, PriceFeedInterface | null]> => {
              const config = allConfigs[symbol];

              // If there is no config for this symbol, return just null, which will be filtered out.
              // Allow this through becuase
              if (!config) {
                logger.debug({
                  at: "_createExpressionPriceFeed",
                  message: `No price feed config found for symbol: ${symbol} 🚨`,
                  expressionConfig,
                });
                return null;
              }

              // These configs will inherit the expression config values (except type), but prefer the individual config's
              // value when present.
              const combinedConfig = { ...expressionConfig, type: undefined, ...config };

              // If this returns null, just return upstream since the error has already been logged and the null will be
              // detected upstream.
              const priceFeed = await createPriceFeed(logger, web3, networker, getTime, combinedConfig);
              return [symbol, priceFeed];
            }
          )
        )
      ).filter(isDefined)
    );

    // Return null if any of the price feeds in the map are null (meaning there was an error).
    if (!Object.values(priceFeedMap).every(isDefined)) return null;

    // Can assert type because it was verified in the previous line.
    return new ExpressionPriceFeed(
      priceFeedMap as { [name: string]: PriceFeedInterface },
      expressionConfig.expression,
      expressionConfig.priceFeedDecimals
    );
  }

  async function _createMedianizerPriceFeed(medianizerConfig: {
    medianizedFeeds: any[];
    computeMean: boolean;
  }): Promise<MedianizerPriceFeed | null> {
    const priceFeedsToMedianize = await _createConstituentPriceFeeds(medianizerConfig.medianizedFeeds);
    if (!priceFeedsToMedianize) return null;
    return new MedianizerPriceFeed(priceFeedsToMedianize, medianizerConfig.computeMean);
  }

  async function _createFallBackPriceFeed(fallbackConfig: { orderedFeeds: any[] }): Promise<FallBackPriceFeed | null> {
    const orderedPriceFeeds = await _createConstituentPriceFeeds(fallbackConfig.orderedFeeds);
    if (!orderedPriceFeeds) return null;
    return new FallBackPriceFeed(orderedPriceFeeds);
  }

  async function _createConstituentPriceFeeds(priceFeedConfigs: any[]) {
    const priceFeeds = [];
    for (const _priceFeedConfig of priceFeedConfigs) {
      // The constituent feeds should inherit config options from the parent config if it doesn't define those values
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

      priceFeeds.push(priceFeed);
    }
    return priceFeeds;
  }

  // Returns an array or "basket" of MedianizerPriceFeeds
  async function _createBasketOfMedianizerPriceFeeds(
    medianizerConfigs: {
      medianizedFeeds: any[];
      computeMean: boolean;
    }[]
  ) {
    return await Promise.all(medianizerConfigs.map((config) => _createMedianizerPriceFeed(config)));
  }
}

// Simple function to grab a singleton instance of the blockFinder to share the cache.
const getSharedBlockFinder: {
  (web3: Web3): BlockFinder<BlockTransactionBase>;
  blockFinder?: BlockFinder<BlockTransactionBase>;
} = (web3: Web3): BlockFinder<BlockTransactionBase> => {
  // Attach the blockFinder to this function.
  if (!getSharedBlockFinder.blockFinder) {
    getSharedBlockFinder.blockFinder = new BlockFinder<BlockTransactionBase>(web3.eth.getBlock);
  }
  return getSharedBlockFinder.blockFinder;
};

function isMissingField(config: { [key: string]: any }, requiredFields: string[], logger: Logger) {
  const missingField = requiredFields.find((field) => config[field] === undefined);
  if (missingField !== undefined) {
    logger.error({
      at: "createPriceFeed",
      message: "Config is missing field🚨",
      priceFeedType: config.type,
      requiredFields,
      missingField,
      config,
    });
    return true;
  }

  return false;
}

export async function getUniswapPairDetails(
  web3: Web3,
  syntheticTokenAddress: string,
  collateralCurrencyAddress: string
): Promise<{ pairAddress?: string; inverted?: boolean }> {
  const networkId = await web3.eth.net.getId();

  if (process.env.UNISWAP_ADDRESS) {
    // Used for mock uniswap pair contracts.
    return { pairAddress: process.env.UNISWAP_ADDRESS, inverted: false };
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

export async function createBalancerPriceFeedForFinancialContractI(
  logger: Logger,
  web3: Web3,
  networker: NetworkerInterface,
  getTime: () => Promise<number>,
  financialContractAddress: string,
  config: { [key: string]: any } = {}
): Promise<PriceFeedInterface | null> {
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

export async function createUniswapPriceFeedForFinancialContract(
  logger: Logger,
  web3: Web3,
  networker: NetworkerInterface,
  getTime: () => Promise<number>,
  financialContractAddress: string,
  config: { [key: string]: any }
): Promise<PriceFeedInterface | null> {
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
      uniswapAddress: pairAddress,
    };
  } else {
    defaultConfig = {};
  }

  const userConfig = config || {};

  // Check if there is an override for the getTime method in the price feed config. Specifically, we can replace the
  // get time method with the current block time.
  if (userConfig.getTimeOverride?.useBlockTime) {
    getTime = async () => Number((await web3.eth.getBlock("latest")).timestamp);
  }

  logger.debug({
    at: "createUniswapPriceFeedForFinancialContract",
    message: "Inferred default config from identifier or Financial Contract address",
    financialContractAddress,
    defaultConfig,
    userConfig,
  });

  return await createPriceFeed(logger, web3, networker, getTime, { ...defaultConfig, ...userConfig });
}

export function createTokenPriceFeedForFinancialContract(
  logger: Logger,
  web3: Web3,
  networker: NetworkerInterface,
  getTime: () => Promise<number>,
  financialContractAddress: string,
  config: { [key: string]: any } = {}
): Promise<PriceFeedInterface | null> {
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
export async function createReferencePriceFeedForFinancialContract(
  logger: Logger,
  web3: Web3,
  networker: NetworkerInterface,
  getTime: () => Promise<number>,
  financialContractAddress: string | undefined,
  config: { [key: string]: any },
  identifier?: string
): Promise<PriceFeedInterface | null> {
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

  // For test purposes, if the identifier begins with "TEST..." or "INVALID..." then we will set the pricefeed
  // to test-only pricefeeds like the PriceFeedMock and the InvalidPriceFeed.
  let defaultConfig;
  if (_identifier.startsWith("TEST")) {
    defaultConfig = { type: "test", priceFeedDecimals: getPrecisionForIdentifier(_identifier) };
  } else if (_identifier.startsWith("INVALID")) {
    defaultConfig = { type: "invalid", priceFeedDecimals: getPrecisionForIdentifier(_identifier) };
  } else {
    defaultConfig = defaultConfigs[_identifier];
  }

  logger.debug({
    at: "createReferencePriceFeedForFinancialContract",
    message: "Inferred default config from identifier or Financial Contract address",
    financialContractAddress,
    identifier: _identifier,
    defaultConfig,
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
      combinedConfig,
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
    if (combinedConfig.getTimeOverride?.useBlockTime) {
      getTime = async () => Number((await web3.eth.getBlock("latest")).timestamp);
    }
  }
  return await createPriceFeed(logger, web3, networker, getTime, combinedConfig);
}

function getFinancialContractIdentifierAtAddress(web3: Web3, financialContractAddress: string) {
  try {
    return new web3.eth.Contract(getAbi("ExpiringMultiParty"), financialContractAddress);
  } catch (error) {
    throw new Error(
      `Something went wrong in fetching the financial contract identifier ${(error as Error)?.stack || error}`
    );
  }
}

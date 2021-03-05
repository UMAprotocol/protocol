const { toWei, utf8ToHex, padRight } = web3.utils;
const { getTruffleContract } = require("@uma/core");

const CONTRACT_VERSION = "latest";
const CONTRACT_VERSION_EMP = "1.2.0";

// Tested Contract
const ExpiringMultiParty = getTruffleContract("ExpiringMultiParty", web3, CONTRACT_VERSION_EMP);

// Helper Contracts
const Finder = getTruffleContract("Finder", web3, CONTRACT_VERSION);
const IdentifierWhitelist = getTruffleContract("IdentifierWhitelist", web3, CONTRACT_VERSION);
const Token = getTruffleContract("ExpandedERC20", web3, CONTRACT_VERSION);
const SyntheticToken = getTruffleContract("SyntheticToken", web3, CONTRACT_VERSION);
const Timer = getTruffleContract("Timer", web3, CONTRACT_VERSION);
const Store = getTruffleContract("Store", web3, CONTRACT_VERSION);

const {
  createPriceFeed,
  createReferencePriceFeedForFinancialContract,
  createUniswapPriceFeedForFinancialContract,
  createTokenPriceFeedForFinancialContract
} = require("../../src/price-feed/CreatePriceFeed");
const { CryptoWatchPriceFeed } = require("../../src/price-feed/CryptoWatchPriceFeed");
const { UniswapPriceFeed } = require("../../src/price-feed/UniswapPriceFeed");
const { BalancerPriceFeed } = require("../../src/price-feed/BalancerPriceFeed");
const { BasketSpreadPriceFeed } = require("../../src/price-feed/BasketSpreadPriceFeed");
const { MedianizerPriceFeed } = require("../../src/price-feed/MedianizerPriceFeed");
const { CoinMarketCapPriceFeed } = require("../../src/price-feed/CoinMarketCapPriceFeed");
const { CoinGeckoPriceFeed } = require("../../src/price-feed/CoinGeckoPriceFeed");
const { NetworkerMock } = require("../../src/price-feed/NetworkerMock");
const { SpyTransport } = require("../../src/logger/SpyTransport");
const winston = require("winston");
const sinon = require("sinon");

const { ZERO_ADDRESS, interfaceName } = require("@uma/common");

contract("CreatePriceFeed.js", function(accounts) {
  const { toChecksumAddress, randomHex } = web3.utils;

  let mockTime = 1588376548;
  let networker;
  let logger;
  let store;
  let timer;
  let finder;
  let identifierWhitelist;
  let spy;

  const apiKey = "test-api-key";
  const exchange = "test-exchange";
  const pair = "test-pair";
  const lookback = 120;
  const getTime = () => mockTime;
  const minTimeBetweenUpdates = 60;
  const twapLength = 180;
  const uniswapAddress = toChecksumAddress(randomHex(20));
  const balancerAddress = toChecksumAddress(randomHex(20));
  const symbol = "test-symbol";
  const quoteCurrency = "test-quoteCurrency";
  const contractAddress = "test-address";

  before(async function() {
    identifierWhitelist = await IdentifierWhitelist.new();
    await identifierWhitelist.addSupportedIdentifier(padRight(utf8ToHex("ETH/BTC"), 64));
    finder = await Finder.new();
    timer = await Timer.new();
    store = await Store.new({ rawValue: "0" }, { rawValue: "0" }, timer.address);
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.IdentifierWhitelist), identifierWhitelist.address);
  });

  beforeEach(async function() {
    networker = new NetworkerMock();
    spy = sinon.spy();

    logger = winston.createLogger({
      level: "info",
      transports: [new SpyTransport({ level: "error" }, { spy: spy })]
    });
  });

  it("No type", async function() {
    const config = {
      apiKey,
      exchange,
      pair,
      lookback,
      minTimeBetweenUpdates
    };

    assert.equal(await createPriceFeed(logger, web3, networker, getTime, config), null);
  });

  it("Valid BasketSpread config", async function() {
    const baselinePriceFeeds = [
      {
        type: "medianizer",
        medianizedFeeds: [
          {
            type: "cryptowatch"
          }
        ]
      },
      {
        type: "medianizer",
        medianizedFeeds: [
          {
            type: "uniswap"
          }
        ]
      }
    ];
    const experimentalPriceFeeds = [
      {
        type: "medianizer",
        medianizedFeeds: [
          {
            type: "cryptowatch"
          }
        ]
      },
      {
        type: "medianizer",
        medianizedFeeds: [
          {
            type: "balancer"
          }
        ]
      }
    ];
    const denominatorPriceFeed = {
      type: "medianizer",
      medianizedFeeds: [
        {
          type: "cryptowatch"
        }
      ]
    };
    const config = {
      type: "basketspread",
      baselinePriceFeeds,
      experimentalPriceFeeds,
      denominatorPriceFeed,
      // Required fields for constituent cryptowatch price feeds:
      minTimeBetweenUpdates,
      lookback,
      exchange,
      pair,
      apiKey,
      // Additional required fields for uniswap price feeds:
      uniswapAddress,
      twapLength,
      // Additional required fields for balance price feeds:
      balancerAddress,
      balancerTokenIn: accounts[1],
      balancerTokenOut: accounts[2]
    };

    const validBasketSpreadFeed = await createPriceFeed(logger, web3, networker, getTime, config);
    assert.isTrue(validBasketSpreadFeed instanceof BasketSpreadPriceFeed);

    // Check that baseline and experimental pricefeeds are lists of medianizer price feeds with the correct
    // constituent pricefeeds.
    assert.isTrue(validBasketSpreadFeed.baselinePriceFeeds[0] instanceof MedianizerPriceFeed);
    assert.isTrue(validBasketSpreadFeed.baselinePriceFeeds[0].priceFeeds[0] instanceof CryptoWatchPriceFeed);
    assert.isTrue(validBasketSpreadFeed.baselinePriceFeeds[1] instanceof MedianizerPriceFeed);
    assert.isTrue(validBasketSpreadFeed.baselinePriceFeeds[1].priceFeeds[0] instanceof UniswapPriceFeed);
    assert.isTrue(validBasketSpreadFeed.experimentalPriceFeeds[0] instanceof MedianizerPriceFeed);
    assert.isTrue(validBasketSpreadFeed.experimentalPriceFeeds[0].priceFeeds[0] instanceof CryptoWatchPriceFeed);
    assert.isTrue(validBasketSpreadFeed.experimentalPriceFeeds[1] instanceof MedianizerPriceFeed);
    assert.isTrue(validBasketSpreadFeed.experimentalPriceFeeds[1].priceFeeds[0] instanceof BalancerPriceFeed);
    assert.isTrue(validBasketSpreadFeed.denominatorPriceFeed instanceof MedianizerPriceFeed);
    assert.isTrue(validBasketSpreadFeed.denominatorPriceFeed.priceFeeds[0] instanceof CryptoWatchPriceFeed);
  });

  it("Valid BasketSpread config, no denominator price feed", async function() {
    const baselinePriceFeeds = [
      {
        type: "medianizer",
        medianizedFeeds: [
          {
            type: "cryptowatch"
          }
        ]
      },
      {
        type: "medianizer",
        medianizedFeeds: [
          {
            type: "uniswap"
          }
        ]
      }
    ];
    const experimentalPriceFeeds = [
      {
        type: "medianizer",
        medianizedFeeds: [
          {
            type: "cryptowatch"
          }
        ]
      },
      {
        type: "medianizer",
        medianizedFeeds: [
          {
            type: "balancer"
          }
        ]
      }
    ];
    const config = {
      type: "basketspread",
      baselinePriceFeeds,
      experimentalPriceFeeds,
      // Required fields for constituent cryptowatch price feeds:
      minTimeBetweenUpdates,
      lookback,
      exchange,
      pair,
      apiKey,
      // Additional required fields for uniswap price feeds:
      uniswapAddress,
      twapLength,
      // Additional required fields for balance price feeds:
      balancerAddress,
      balancerTokenIn: accounts[1],
      balancerTokenOut: accounts[2]
    };

    const validBasketSpreadFeed = await createPriceFeed(logger, web3, networker, getTime, config);
    assert.isTrue(validBasketSpreadFeed instanceof BasketSpreadPriceFeed);

    // Check that baseline and experimental pricefeeds are lists of medianizer price feeds with the correct
    // constituent pricefeeds.
    assert.isTrue(validBasketSpreadFeed.baselinePriceFeeds[0] instanceof MedianizerPriceFeed);
    assert.isTrue(validBasketSpreadFeed.baselinePriceFeeds[0].priceFeeds[0] instanceof CryptoWatchPriceFeed);
    assert.isTrue(validBasketSpreadFeed.baselinePriceFeeds[1] instanceof MedianizerPriceFeed);
    assert.isTrue(validBasketSpreadFeed.baselinePriceFeeds[1].priceFeeds[0] instanceof UniswapPriceFeed);
    assert.isTrue(validBasketSpreadFeed.experimentalPriceFeeds[0] instanceof MedianizerPriceFeed);
    assert.isTrue(validBasketSpreadFeed.experimentalPriceFeeds[0].priceFeeds[0] instanceof CryptoWatchPriceFeed);
    assert.isTrue(validBasketSpreadFeed.experimentalPriceFeeds[1] instanceof MedianizerPriceFeed);
    assert.isTrue(validBasketSpreadFeed.experimentalPriceFeeds[1].priceFeeds[0] instanceof BalancerPriceFeed);
    assert.equal(validBasketSpreadFeed.denominatorPriceFeed, undefined);
  });

  it("Invalid BasketSpread config", async function() {
    const baselinePriceFeeds = [
      {
        type: "medianizer",
        medianizedFeeds: [
          {
            type: "cryptowatch"
          }
        ]
      },
      {
        type: "medianizer",
        medianizedFeeds: [
          {
            type: "uniswap"
          }
        ]
      }
    ];
    const experimentalPriceFeeds = [
      {
        type: "medianizer",
        medianizedFeeds: [
          {
            type: "cryptowatch"
          }
        ]
      },
      {
        type: "medianizer",
        medianizedFeeds: [
          {
            type: "balancer"
          }
        ]
      }
    ];
    const denominatorPriceFeed = {
      type: "medianizer",
      medianizedFeeds: [
        {
          type: "cryptowatch"
        }
      ]
    };
    const validConfig = {
      type: "basketspread",
      baselinePriceFeeds,
      experimentalPriceFeeds,
      denominatorPriceFeed,
      // Required fields for constituent cryptowatch price feeds:
      minTimeBetweenUpdates,
      lookback,
      exchange,
      pair,
      apiKey,
      // Additional required fields for uniswap price feeds:
      uniswapAddress,
      twapLength,
      // Additional required fields for balance price feeds:
      balancerAddress,
      balancerTokenIn: accounts[1],
      balancerTokenOut: accounts[2]
    };

    assert.equal(
      await createPriceFeed(logger, web3, networker, getTime, { ...validConfig, baselinePriceFeeds: undefined }),
      null
    );
    assert.equal(
      await createPriceFeed(logger, web3, networker, getTime, { ...validConfig, experimentalPriceFeeds: undefined }),
      null
    );
  });

  it("Valid CryptoWatch config", async function() {
    const config = {
      type: "cryptowatch",
      cryptowatchApiKey: apiKey,
      exchange,
      pair,
      lookback,
      minTimeBetweenUpdates
    };

    const validCryptoWatchFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.isTrue(validCryptoWatchFeed instanceof CryptoWatchPriceFeed);
    assert.equal(validCryptoWatchFeed.apiKey, apiKey);
    assert.equal(validCryptoWatchFeed.exchange, exchange);
    assert.equal(validCryptoWatchFeed.pair, pair);
    assert.equal(validCryptoWatchFeed.lookback, lookback);
    assert.equal(validCryptoWatchFeed.getTime(), getTime());
    assert.equal(validCryptoWatchFeed.invertPrice, undefined);
  });

  it("Valid CryptoWatch config without apiKey", async function() {
    const config = {
      type: "cryptowatch",
      exchange,
      pair,
      lookback,
      minTimeBetweenUpdates
    };

    const validCryptoWatchFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.isTrue(validCryptoWatchFeed instanceof CryptoWatchPriceFeed);
    assert.equal(validCryptoWatchFeed.apiKey, undefined);
  });

  it("Invalid CryptoWatch config", async function() {
    const validConfig = {
      type: "cryptowatch",
      cryptowatchApiKey: apiKey,
      exchange,
      pair,
      lookback,
      minTimeBetweenUpdates
    };

    assert.equal(
      await createPriceFeed(logger, web3, networker, getTime, { ...validConfig, exchange: undefined }),
      null
    );
    assert.equal(await createPriceFeed(logger, web3, networker, getTime, { ...validConfig, pair: undefined }), null);
    assert.equal(
      await createPriceFeed(logger, web3, networker, getTime, { ...validConfig, lookback: undefined }),
      null
    );
    assert.equal(
      await createPriceFeed(logger, web3, networker, getTime, { ...validConfig, minTimeBetweenUpdates: undefined }),
      null
    );
  });

  it("Valid Uniswap config", async function() {
    const config = {
      type: "uniswap",
      uniswapAddress,
      twapLength,
      lookback
    };

    const validUniswapFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.isTrue(validUniswapFeed instanceof UniswapPriceFeed);
    assert.equal(validUniswapFeed.uniswap.options.address, uniswapAddress);
    assert.equal(validUniswapFeed.twapLength, twapLength);
    assert.equal(validUniswapFeed.historicalLookback, lookback);
    assert.equal(validUniswapFeed.getTime(), getTime());
    assert.equal(validUniswapFeed.invertPrice, undefined);

    // Invert parameter should be passed through.
    const validInvertedUniswapFeed = await createPriceFeed(logger, web3, networker, getTime, {
      ...config,
      invertPrice: true
    });
    assert.isTrue(validInvertedUniswapFeed.invertPrice);
  });

  it("Invalid Uniswap config", async function() {
    const validConfig = {
      type: "uniswap",
      uniswapAddress,
      twapLength,
      lookback
    };

    assert.equal(
      await createPriceFeed(logger, web3, networker, getTime, { ...validConfig, uniswapAddress: undefined }),
      null
    );
    assert.equal(
      await createPriceFeed(logger, web3, networker, getTime, { ...validConfig, twapLength: undefined }),
      null
    );
    assert.equal(
      await createPriceFeed(logger, web3, networker, getTime, { ...validConfig, lookback: undefined }),
      null
    );
  });

  it("Default Uniswap Config", async function() {
    // Given the collateral token is 0x1, the , it should always come first, meaning the config should always be inverted.
    const collateralTokenAddress = "0x0000000000000000000000000000000000000001";
    const syntheticTokenAddress = "0x0000000000000000000000000000000000000002";

    const constructorParams = {
      expirationTimestamp: ((await web3.eth.getBlock("latest")).timestamp + 1000).toString(),
      withdrawalLiveness: "1000",
      collateralAddress: collateralTokenAddress,
      tokenAddress: syntheticTokenAddress,
      finderAddress: finder.address,
      priceFeedIdentifier: padRight(utf8ToHex("ETH/BTC"), 64), // Note: an identifier which is part of the default config is required for this test.
      liquidationLiveness: "1000",
      collateralRequirement: { rawValue: toWei("1.5") },
      disputeBondPct: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPct: { rawValue: toWei("0.1") },
      disputerDisputeRewardPct: { rawValue: toWei("0.1") },
      minSponsorTokens: { rawValue: toWei("1") },
      timerAddress: timer.address,
      excessTokenBeneficiary: store.address,
      financialProductLibraryAddress: ZERO_ADDRESS
    };

    const financialContract = await ExpiringMultiParty.new(constructorParams);

    const getIdBackup = web3.eth.net.getId;

    // Modify web3 to say the chain id is mainnet temporarily.
    web3.eth.net.getId = async () => 1;

    const twapLength = 100;
    const priceFeed = await createUniswapPriceFeedForFinancialContract(
      logger,
      web3,
      networker,
      getTime,
      financialContract.address,
      { twapLength }
    );

    // Cannot test for the uniswap address since that depends on the synthetic token address, which is generated in a non-hermetic way.
    // Price should always be inverted since the collateralTokenAddress is 0x1.
    assert.isTrue(priceFeed.invertPrice);

    // Config override should be passed through.
    assert.equal(priceFeed.twapLength, twapLength);

    // Reset getId method.
    web3.eth.net.getId = getIdBackup;
  });

  it("Uniswap address not found", async function() {
    const collateralToken = await Token.new("Wrapped Ether", "WETH", 18, { from: accounts[0] });
    const syntheticToken = await SyntheticToken.new("Test Synthetic Token", "SYNTH", 18, { from: accounts[0] });

    const constructorParams = {
      expirationTimestamp: ((await web3.eth.getBlock("latest")).timestamp + 1000).toString(),
      withdrawalLiveness: "1000",
      collateralAddress: collateralToken.address,
      tokenAddress: syntheticToken.address,
      finderAddress: finder.address,
      priceFeedIdentifier: padRight(utf8ToHex("ETH/BTC"), 64), // Note: an identifier which is part of the default config is required for this test.
      liquidationLiveness: "1000",
      collateralRequirement: { rawValue: toWei("1.5") },
      disputeBondPct: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPct: { rawValue: toWei("0.1") },
      disputerDisputeRewardPct: { rawValue: toWei("0.1") },
      minSponsorTokens: { rawValue: toWei("1") },
      timerAddress: timer.address,
      excessTokenBeneficiary: store.address,
      financialProductLibraryAddress: ZERO_ADDRESS
    };

    const financialContract = await ExpiringMultiParty.new(constructorParams);

    let didThrow = false;
    try {
      // Creation should fail because this test network has no deployed uniswap contract and UNISWAP_ADDRESS isn't
      // provided in the environment.
      await createUniswapPriceFeedForFinancialContract(logger, web3, networker, getTime, financialContract.address);
    } catch (error) {
      didThrow = true;
    }

    assert.isTrue(didThrow);
  });

  it("Valid Balancer config", async function() {
    const config = {
      type: "balancer",
      balancerAddress,
      balancerTokenIn: accounts[1],
      balancerTokenOut: accounts[2],
      lookback: 7200,
      twapLength: 7200
    };

    const balancerFeed = await createPriceFeed(logger, web3, networker, getTime, config);
    assert.isTrue(balancerFeed instanceof BalancerPriceFeed);
  });

  it("Invalid Balancer config", async function() {
    const config = {
      type: "balancer",
      balancerAddress
    };

    const balancerFeed = await createPriceFeed(logger, web3, networker, getTime, config);
    assert.equal(balancerFeed, null);
  });
  it("Create token price feed for Balancer", async function() {
    const collateralTokenAddress = "0x0000000000000000000000000000000000000001";
    const syntheticTokenAddress = "0x0000000000000000000000000000000000000002";

    const config = {
      type: "balancer",
      balancerAddress,
      balancerTokenIn: accounts[1],
      balancerTokenOut: accounts[2]
    };

    const constructorParams = {
      expirationTimestamp: ((await web3.eth.getBlock("latest")).timestamp + 1000).toString(),
      withdrawalLiveness: "1000",
      collateralAddress: collateralTokenAddress,
      tokenAddress: syntheticTokenAddress,
      finderAddress: finder.address,
      priceFeedIdentifier: padRight(utf8ToHex("ETH/BTC"), 64), // Note: an identifier which is part of the default config is required for this test.
      liquidationLiveness: "1000",
      collateralRequirement: { rawValue: toWei("1.5") },
      disputeBondPct: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPct: { rawValue: toWei("0.1") },
      disputerDisputeRewardPct: { rawValue: toWei("0.1") },
      minSponsorTokens: { rawValue: toWei("1") },
      timerAddress: timer.address,
      excessTokenBeneficiary: store.address,
      financialProductLibraryAddress: ZERO_ADDRESS
    };

    const financialContract = await ExpiringMultiParty.new(constructorParams);

    const balancerFeed = await createTokenPriceFeedForFinancialContract(
      logger,
      web3,
      networker,
      getTime,
      financialContract.address,
      config
    );
    assert.isTrue(balancerFeed instanceof BalancerPriceFeed);
  });

  it("Create token price feed for Uniswap", async function() {
    const collateralTokenAddress = "0x0000000000000000000000000000000000000001";
    const syntheticTokenAddress = "0x0000000000000000000000000000000000000002";

    const config = {
      type: "uniswap",
      uniswapAddress,
      twapLength,
      lookback
    };

    const constructorParams = {
      expirationTimestamp: ((await web3.eth.getBlock("latest")).timestamp + 1000).toString(),
      withdrawalLiveness: "1000",
      collateralAddress: collateralTokenAddress,
      tokenAddress: syntheticTokenAddress,
      finderAddress: finder.address,
      priceFeedIdentifier: padRight(utf8ToHex("ETH/BTC"), 64), // Note: an identifier which is part of the default config is required for this test.
      liquidationLiveness: "1000",
      collateralRequirement: { rawValue: toWei("1.5") },
      disputeBondPct: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPct: { rawValue: toWei("0.1") },
      disputerDisputeRewardPct: { rawValue: toWei("0.1") },
      minSponsorTokens: { rawValue: toWei("1") },
      timerAddress: timer.address,
      excessTokenBeneficiary: store.address,
      financialProductLibraryAddress: ZERO_ADDRESS
    };

    const financialContract = await ExpiringMultiParty.new(constructorParams);

    const uniswapFeed = await createTokenPriceFeedForFinancialContract(
      logger,
      web3,
      networker,
      getTime,
      financialContract.address,
      config
    );
    assert.isTrue(uniswapFeed instanceof UniswapPriceFeed);
  });

  it("Create token price feed defaults to Medianizer", async function() {
    const collateralTokenAddress = "0x0000000000000000000000000000000000000001";
    const syntheticTokenAddress = "0x0000000000000000000000000000000000000002";

    const constructorParams = {
      expirationTimestamp: ((await web3.eth.getBlock("latest")).timestamp + 1000).toString(),
      withdrawalLiveness: "1000",
      collateralAddress: collateralTokenAddress,
      tokenAddress: syntheticTokenAddress,
      finderAddress: finder.address,
      priceFeedIdentifier: padRight(utf8ToHex("ETH/BTC"), 64), // Note: an identifier which is part of the default config is required for this test.defined as part of the default bot configs
      liquidationLiveness: "1000",
      collateralRequirement: { rawValue: toWei("1.5") },
      disputeBondPct: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPct: { rawValue: toWei("0.1") },
      disputerDisputeRewardPct: { rawValue: toWei("0.1") },
      minSponsorTokens: { rawValue: toWei("1") },
      timerAddress: timer.address,
      excessTokenBeneficiary: store.address,
      financialProductLibraryAddress: ZERO_ADDRESS
    };

    const financialContract = await ExpiringMultiParty.new(constructorParams);

    // If `config` is undefined or ommitted (and set to its default value), this should return a Medianizer Price Feed
    let medianizerFeed = await createTokenPriceFeedForFinancialContract(
      logger,
      web3,
      networker,
      getTime,
      financialContract.address
    );
    assert.isTrue(medianizerFeed instanceof MedianizerPriceFeed);
    medianizerFeed = await createTokenPriceFeedForFinancialContract(
      logger,
      web3,
      networker,
      getTime,
      financialContract.address,
      undefined
    );
    assert.isTrue(medianizerFeed instanceof MedianizerPriceFeed);
  });

  it("Valid Medianizer inherited config", async function() {
    const config = {
      type: "medianizer",
      apiKey,
      exchange,
      pair,
      lookback,
      minTimeBetweenUpdates,
      uniswapAddress,
      twapLength,
      medianizedFeeds: [
        {
          type: "cryptowatch"
        },
        {
          type: "uniswap"
        }
      ]
    };

    const validMedianizerFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.isTrue(validMedianizerFeed instanceof MedianizerPriceFeed);
    assert.isTrue(validMedianizerFeed.priceFeeds[0] instanceof CryptoWatchPriceFeed);
    assert.isTrue(validMedianizerFeed.priceFeeds[1] instanceof UniswapPriceFeed);

    assert.equal(validMedianizerFeed.priceFeeds[0].pair, pair);
    assert.equal(validMedianizerFeed.priceFeeds[1].uniswap.options.address, uniswapAddress);
  });

  it("Valid Medianizer override config", async function() {
    const lookbackOverride = 5;
    const config = {
      type: "medianizer",
      apiKey,
      exchange,
      pair,
      lookback,
      minTimeBetweenUpdates,
      medianizedFeeds: [
        {
          type: "cryptowatch",
          lookback: lookbackOverride
        }
      ]
    };

    const validMedianizerFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.equal(validMedianizerFeed.priceFeeds[0].lookback, lookbackOverride);
  });

  it("Medianizer feed cannot have 0 nested feeds to medianize", async function() {
    const config = {
      type: "medianizer",
      apiKey,
      exchange,
      pair,
      lookback,
      minTimeBetweenUpdates
    };

    await createPriceFeed(logger, web3, networker, getTime, config);

    // medianizedFeeds is missing.
    assert.equal(await createPriceFeed(logger, web3, networker, getTime, config), null);

    // medianizedFeeds is 0 length.
    assert.equal(await createPriceFeed(logger, web3, networker, getTime, { ...config, medianizedFeeds: [] }), null);
  });

  it("Medianizer feed cannot have a nested feed with an invalid config", async function() {
    const config = {
      type: "medianizer",
      apiKey,
      exchange,
      pair,
      lookback,
      minTimeBetweenUpdates,
      medianizedFeeds: [
        {
          type: "cryptowatch"
        },
        {} // Invalid because the second medianized feed has no type.
      ]
    };

    const medianizerFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.equal(medianizerFeed, null);
  });

  it("ExpressionPriceFeed: invalid config, no expression", async function() {
    const config = {
      type: "expression"
    };

    const expressionPriceFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.isNull(expressionPriceFeed);
    assert.equal(spy.callCount, 1); // 1 error.
  });

  it("ExpressionPriceFeed: valid config, no resolved feeds", async function() {
    const config = {
      type: "expression",
      expression: "mysymbol * 2"
    };

    const expressionPriceFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.isNotNull(expressionPriceFeed);
    // Price feed map should have no elements.
    assert.equal(Object.keys(expressionPriceFeed.priceFeedMap).length, 0);
  });

  it("ExpressionPriceFeed: customFeeds", async function() {
    const config = {
      type: "expression",
      expression: "mysymbol * 2",
      customFeeds: {
        mysymbol: {
          type: "cryptowatch",
          cryptowatchApiKey: apiKey,
          exchange,
          pair,
          lookback,
          minTimeBetweenUpdates
        }
      }
    };

    const expressionPriceFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.isNotNull(expressionPriceFeed);
    assert.exists(expressionPriceFeed.priceFeedMap["mysymbol"]);
  });

  it("ExpressionPriceFeed: inherited config", async function() {
    const config = {
      type: "expression",
      expression: "mysymbol * 2",
      apiKey,
      exchange,
      pair,
      lookback,
      minTimeBetweenUpdates,
      customFeeds: {
        mysymbol: {
          type: "cryptowatch"
        }
      }
    };

    const expressionPriceFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.isNotNull(expressionPriceFeed);
    assert.exists(expressionPriceFeed.priceFeedMap["mysymbol"]);
    assert.equal(expressionPriceFeed.priceFeedMap["mysymbol"].lookback, lookback);
  });

  it("ExpressionPriceFeed: invalid config, no expression", async function() {
    const config = {
      type: "expression"
    };

    const expressionPriceFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.isNull(expressionPriceFeed);
  });

  it("ExpressionPriceFeed: can find default price feeds", async function() {
    const config = {
      type: "expression",
      lookback,
      expression: "USDETH + ETH\\/BTC"
    };

    const expressionPriceFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.isNotNull(expressionPriceFeed);
  });

  it("ExpressionPriceFeed: invalid config in customFeeds is ignored if unused", async function() {
    const config = {
      type: "expression",
      expression: "2 + 5",
      customFeeds: {
        ETHBTC: {} // Invalid because it has no type.
      }
    };

    const expressionPriceFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.isNotNull(expressionPriceFeed);
  });

  it("ExpressionPriceFeed: constant expression", async function() {
    const config = {
      type: "expression",
      expression: "1 + 2"
    };

    const expressionPriceFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.isNotNull(expressionPriceFeed);
  });

  it("VaultPriceFeed: valid config", async function() {
    const config = {
      type: "vault",
      address: web3.utils.randomHex(20)
    };

    const vaultPriceFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.isNotNull(vaultPriceFeed);
  });

  it("VaultPriceFeed: invalid config", async function() {
    const config = {
      type: "vault"
    };

    const vaultPriceFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.isNull(vaultPriceFeed);
    assert.equal(spy.callCount, 1); // 1 error.
  });

  it("VaultPriceFeed: shared BlockFinder", async function() {
    const config = {
      type: "vault",
      address: web3.utils.randomHex(20)
    };

    const vaultPriceFeed1 = await createPriceFeed(logger, web3, networker, getTime, config);
    const vaultPriceFeed2 = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.strictEqual(vaultPriceFeed2.blockFinder, vaultPriceFeed1.blockFinder);
  });

  it("VaultPriceFeed: optional parameters", async function() {
    const address = web3.utils.randomHex(20);
    const config = {
      type: "vault",
      address,
      priceFeedDecimals: 6,
      minTimeBetweenUpdates: 100
    };

    const vaultPriceFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.equal(vaultPriceFeed.minTimeBetweenUpdates, 100);
    assert.equal(vaultPriceFeed.priceFeedDecimals, 6);
    assert.equal(vaultPriceFeed.vault.options.address, web3.utils.toChecksumAddress(address));
  });

  it("LPPriceFeed: valid config", async function() {
    const config = {
      type: "lp",
      poolAddress: web3.utils.randomHex(20),
      tokenAddress: web3.utils.randomHex(20)
    };

    const lpPriceFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.isNotNull(lpPriceFeed);
  });

  it("LPPriceFeed: invalid config, no token address", async function() {
    let config = {
      type: "lp",
      poolAddress: web3.utils.randomHex(20)
    };

    const lpPriceFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.isNull(lpPriceFeed);
    assert.equal(spy.callCount, 1); // 1 error.
  });

  it("LPPriceFeed: invalid config, no pool address", async function() {
    let config = {
      type: "lp",
      tokenAddress: web3.utils.randomHex(20)
    };

    const lpPriceFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.isNull(lpPriceFeed);
    assert.equal(spy.callCount, 1); // 1 error.
  });

  it("LPPriceFeed: shared BlockFinder", async function() {
    const config = {
      type: "lp",
      poolAddress: web3.utils.randomHex(20),
      tokenAddress: web3.utils.randomHex(20)
    };

    const lpPriceFeed1 = await createPriceFeed(logger, web3, networker, getTime, config);
    const lpPriceFeed2 = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.strictEqual(lpPriceFeed2.blockFinder, lpPriceFeed1.blockFinder);
  });

  it("LPPriceFeed: optional parameters", async function() {
    const tokenAddress = web3.utils.randomHex(20);
    const poolAddress = web3.utils.randomHex(20);
    const config = {
      type: "lp",
      tokenAddress,
      poolAddress,
      priceFeedDecimals: 6,
      minTimeBetweenUpdates: 100
    };

    const lpPriceFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.equal(lpPriceFeed.minTimeBetweenUpdates, 100);
    assert.equal(lpPriceFeed.priceFeedDecimals, 6);
    assert.equal(lpPriceFeed.pool.options.address, web3.utils.toChecksumAddress(poolAddress));
    assert.equal(lpPriceFeed.token.options.address, web3.utils.toChecksumAddress(tokenAddress));
  });

  it("Default reference price feed", async function() {
    const collateralToken = await Token.new("Wrapped Ether", "WETH", 18, { from: accounts[0] });
    const syntheticToken = await SyntheticToken.new("Test Synthetic Token", "SYNTH", 18, { from: accounts[0] });

    const constructorParams = {
      expirationTimestamp: ((await web3.eth.getBlock("latest")).timestamp + 1000).toString(),
      withdrawalLiveness: "1000",
      collateralAddress: collateralToken.address,
      tokenAddress: syntheticToken.address,
      finderAddress: finder.address,
      priceFeedIdentifier: padRight(utf8ToHex("ETH/BTC"), 64), // Note: an identifier which is part of the default config is required for this test.
      liquidationLiveness: "1000",
      collateralRequirement: { rawValue: toWei("1.5") },
      disputeBondPct: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPct: { rawValue: toWei("0.1") },
      disputerDisputeRewardPct: { rawValue: toWei("0.1") },
      minSponsorTokens: { rawValue: toWei("1") },
      timerAddress: timer.address,
      excessTokenBeneficiary: store.address,
      financialProductLibraryAddress: ZERO_ADDRESS
    };

    let financialContract = await ExpiringMultiParty.new(constructorParams);

    // Should create a valid price feed with no config.
    const priceFeed = await createReferencePriceFeedForFinancialContract(
      logger,
      web3,
      networker,
      getTime,
      financialContract.address,
      {
        minTimeBetweenUpdates: 5
      }
    );

    assert.isTrue(priceFeed !== null);
    assert.equal(priceFeed.priceFeeds[0].minTimeBetweenUpdates, 5);

    // Note that the `ETH/BTC` feed should have an 18 decimal feed. This should be correctly detected.
    assert.equal(priceFeed.getPriceFeedDecimals(), 18);

    // Check that the default `lookback` property is overridden.
    assert.equal(priceFeed.priceFeeds[0].lookback, 1000);
  });

  it("Non-standard decimals reference price feed", async function() {
    const collateralToken = await Token.new("Wrapped Ether", "WETH", 8, { from: accounts[0] });
    const syntheticToken = await SyntheticToken.new("Test Synthetic Token", "SYNTH", 18, { from: accounts[0] });

    // For this test we are using a lower decimal identifier, USDBTC. First we need to add it to the whitelist.
    await identifierWhitelist.addSupportedIdentifier(padRight(utf8ToHex("USDBTC"), 64));

    const constructorParams = {
      expirationTimestamp: ((await web3.eth.getBlock("latest")).timestamp + 1000).toString(),
      withdrawalLiveness: "1000",
      collateralAddress: collateralToken.address,
      tokenAddress: syntheticToken.address,
      finderAddress: finder.address,
      priceFeedIdentifier: padRight(utf8ToHex("USDBTC"), 64), // Note: an identifier which is part of the default config is required for this test.
      liquidationLiveness: "1000",
      collateralRequirement: { rawValue: toWei("1.5") },
      disputeBondPct: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPct: { rawValue: toWei("0.1") },
      disputerDisputeRewardPct: { rawValue: toWei("0.1") },
      minSponsorTokens: { rawValue: toWei("1") },
      timerAddress: timer.address,
      excessTokenBeneficiary: store.address,
      financialProductLibraryAddress: ZERO_ADDRESS
    };

    let financialContract = await ExpiringMultiParty.new(constructorParams);

    // Should create a valid price feed with no config.
    const priceFeed = await createReferencePriceFeedForFinancialContract(
      logger,
      web3,
      networker,
      getTime,
      financialContract.address,
      {
        minTimeBetweenUpdates: 5
      }
    );

    assert.isTrue(priceFeed !== null);
    assert.equal(priceFeed.priceFeeds[0].minTimeBetweenUpdates, 5);

    // Note that the `USDBTC` feed should have an 18 decimal feed.
    assert.equal(priceFeed.getPriceFeedDecimals(), 8);

    // Check that the default `lookback` property is overridden.
    assert.equal(priceFeed.priceFeeds[0].lookback, 1000);
  });

  it("Default reference price feed for invalid identifier", async function() {
    const collateralToken = await Token.new("Wrapped Ether", "WETH", 18, { from: accounts[0] });
    const syntheticToken = await SyntheticToken.new("Test Synthetic Token", "SYNTH", 18, { from: accounts[0] });

    const constructorParams = {
      expirationTimestamp: ((await web3.eth.getBlock("latest")).timestamp + 1000).toString(),
      withdrawalLiveness: "1000",
      collateralAddress: collateralToken.address,
      tokenAddress: syntheticToken.address,
      finderAddress: finder.address,
      priceFeedIdentifier: padRight(utf8ToHex("Invalid Identifier"), 64),
      liquidationLiveness: "1000",
      collateralRequirement: { rawValue: toWei("1.5") },
      disputeBondPct: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPct: { rawValue: toWei("0.1") },
      disputerDisputeRewardPct: { rawValue: toWei("0.1") },
      minSponsorTokens: { rawValue: toWei("1") },
      timerAddress: timer.address,
      excessTokenBeneficiary: store.address,
      financialProductLibraryAddress: ZERO_ADDRESS
    };

    await identifierWhitelist.addSupportedIdentifier(constructorParams.priceFeedIdentifier, {
      from: accounts[0]
    });

    let financialContract = await ExpiringMultiParty.new(constructorParams);

    let didThrow = false;
    try {
      // Should create an invlid price feed since an invalid identifier was provided.
      await createReferencePriceFeedForFinancialContract(logger, web3, networker, getTime, financialContract.address);
    } catch (error) {
      didThrow = true;
    }

    assert.isTrue(didThrow);
  });

  it("Valid CoinMarketCap config", async function() {
    const config = {
      type: "coinmarketcap",
      cmcApiKey: apiKey,
      symbol,
      quoteCurrency,
      lookback,
      minTimeBetweenUpdates
    };

    const validCoinMarketCapFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.isTrue(validCoinMarketCapFeed instanceof CoinMarketCapPriceFeed);
    assert.equal(validCoinMarketCapFeed.apiKey, apiKey);
    assert.equal(validCoinMarketCapFeed.symbol, symbol);
    assert.equal(validCoinMarketCapFeed.quoteCurrency, quoteCurrency);
    assert.equal(validCoinMarketCapFeed.lookback, lookback);
    assert.equal(validCoinMarketCapFeed.getTime(), getTime());
    assert.equal(validCoinMarketCapFeed.invertPrice, undefined);
  });

  it("Invalid CoinMarketCap config", async function() {
    const validConfig = {
      type: "coinmarketcap",
      cmcApiKey: apiKey,
      symbol,
      quoteCurrency,
      lookback,
      minTimeBetweenUpdates
    };

    assert.equal(
      await createPriceFeed(logger, web3, networker, getTime, { ...validConfig, cmcApiKey: undefined }),
      null
    );
    assert.equal(await createPriceFeed(logger, web3, networker, getTime, { ...validConfig, symbol: undefined }), null);
    assert.equal(
      await createPriceFeed(logger, web3, networker, getTime, { ...validConfig, quoteCurrency: undefined }),
      null
    );
    assert.equal(
      await createPriceFeed(logger, web3, networker, getTime, { ...validConfig, lookback: undefined }),
      null
    );
    assert.equal(
      await createPriceFeed(logger, web3, networker, getTime, { ...validConfig, minTimeBetweenUpdates: undefined }),
      null
    );
  });

  it("Valid CoinGecko config", async function() {
    const config = {
      type: "coingecko",
      contractAddress,
      quoteCurrency,
      lookback,
      minTimeBetweenUpdates
    };

    const validCoinGeckoFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.isTrue(validCoinGeckoFeed instanceof CoinGeckoPriceFeed);
    assert.equal(validCoinGeckoFeed.contractAddress, contractAddress);
    assert.equal(validCoinGeckoFeed.quoteCurrency, quoteCurrency);
    assert.equal(validCoinGeckoFeed.lookback, lookback);
    assert.equal(validCoinGeckoFeed.getTime(), getTime());
    assert.equal(validCoinGeckoFeed.invertPrice, undefined);
  });

  it("Invalid CoinGecko config", async function() {
    const validConfig = {
      type: "coingecko",
      contractAddress,
      quoteCurrency,
      lookback,
      minTimeBetweenUpdates
    };

    assert.equal(
      await createPriceFeed(logger, web3, networker, getTime, { ...validConfig, contractAddress: undefined }),
      null
    );
    assert.equal(
      await createPriceFeed(logger, web3, networker, getTime, { ...validConfig, quoteCurrency: undefined }),
      null
    );
    assert.equal(
      await createPriceFeed(logger, web3, networker, getTime, { ...validConfig, lookback: undefined }),
      null
    );
    assert.equal(
      await createPriceFeed(logger, web3, networker, getTime, { ...validConfig, minTimeBetweenUpdates: undefined }),
      null
    );
  });
});

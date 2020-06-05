const { toWei } = web3.utils;

// Tested Contract
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");

// Helper Contracts
const Finder = artifacts.require("Finder");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const TokenFactory = artifacts.require("TokenFactory");
const Token = artifacts.require("ExpandedERC20");
const Timer = artifacts.require("Timer");

const { createPriceFeed, createReferencePriceFeedForEmp } = require("../../price-feed/CreatePriceFeed");
const { CryptoWatchPriceFeed } = require("../../price-feed/CryptoWatchPriceFeed");
const { UniswapPriceFeed } = require("../../price-feed/UniswapPriceFeed");
const { MedianizerPriceFeed } = require("../../price-feed/MedianizerPriceFeed");
const { NetworkerMock } = require("./NetworkerMock");
const winston = require("winston");

contract("CreatePriceFeed.js", function(accounts) {
  const { toChecksumAddress, randomHex } = web3.utils;

  let mockTime = 1588376548;
  let networker;

  const apiKey = "test-api-key";
  const exchange = "test-exchange";
  const pair = "test-pair";
  const lookback = 120;
  const getTime = () => mockTime;
  const minTimeBetweenUpdates = 60;
  const twapLength = 180;
  const uniswapAddress = toChecksumAddress(randomHex(20));
  const invertPrice = true;

  beforeEach(async function() {
    networker = new NetworkerMock();
    logger = winston.createLogger({
      level: "info",
      transports: []
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

  it("Valid CryptoWatch config", async function() {
    const config = {
      type: "cryptowatch",
      apiKey,
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
      apiKey,
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

    const medianizerFeed = await createPriceFeed(logger, web3, networker, getTime, config);

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

  it("Default reference price feed", async function() {
    const collateralToken = await Token.new("UMA", "UMA", 18, { from: accounts[0] });

    const constructorParams = {
      expirationTimestamp: (Math.round(Date.now() / 1000) + 1000).toString(),
      withdrawalLiveness: "1000",
      collateralAddress: collateralToken.address,
      finderAddress: Finder.address,
      tokenFactoryAddress: TokenFactory.address,
      priceFeedIdentifier: web3.utils.utf8ToHex("ETH/BTC"),
      syntheticName: "Test UMA Token",
      syntheticSymbol: "UMATEST",
      liquidationLiveness: "1000",
      collateralRequirement: { rawValue: toWei("1.5") },
      disputeBondPct: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPct: { rawValue: toWei("0.1") },
      disputerDisputeRewardPct: { rawValue: toWei("0.1") },
      minSponsorTokens: { rawValue: toWei("1") },
      timerAddress: Timer.address
    };

    let emp = await ExpiringMultiParty.new(constructorParams);

    // Should create a valid price feed with no config.
    const priceFeed = await createReferencePriceFeedForEmp(logger, web3, networker, getTime, emp.address, {
      lookback: 5
    });

    assert.isTrue(priceFeed != null);
    assert.equal(priceFeed.priceFeeds[0].lookback, 5);
  });

  it("Default reference price feed for invalid identifier", async function() {
    const collateralToken = await Token.new("UMA", "UMA", 18, { from: accounts[0] });

    const constructorParams = {
      expirationTimestamp: (Math.round(Date.now() / 1000) + 1000).toString(),
      withdrawalLiveness: "1000",
      collateralAddress: collateralToken.address,
      finderAddress: Finder.address,
      tokenFactoryAddress: TokenFactory.address,
      priceFeedIdentifier: web3.utils.utf8ToHex("Invalid Identifier"),
      syntheticName: "Test UMA Token",
      syntheticSymbol: "UMATEST",
      liquidationLiveness: "1000",
      collateralRequirement: { rawValue: toWei("1.5") },
      disputeBondPct: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPct: { rawValue: toWei("0.1") },
      disputerDisputeRewardPct: { rawValue: toWei("0.1") },
      minSponsorTokens: { rawValue: toWei("1") },
      timerAddress: Timer.address
    };

    identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.addSupportedIdentifier(constructorParams.priceFeedIdentifier, {
      from: accounts[0]
    });

    let emp = await ExpiringMultiParty.new(constructorParams);

    let didThrow = false;
    try {
      // Should create an invlid price feed since an invalid identifier was provided.
      await createReferencePriceFeedForEmp(logger, web3, networker, getTime, emp.address);
    } catch (error) {
      didThrow = true;
    }

    assert.isTrue(didThrow);
  });
});

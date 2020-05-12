const { createPriceFeed } = require("../../price-feed/CreatePriceFeed");
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

    assert.equal(await createPriceFeed(web3, logger, networker, getTime, config), null);
  });

  it("Valid CryptoWatch", async function() {
    const config = {
      type: "cryptowatch",
      apiKey,
      exchange,
      pair,
      lookback,
      minTimeBetweenUpdates
    };

    const validCryptoWatchFeed = await createPriceFeed(web3, logger, networker, getTime, config);

    assert.isTrue(validCryptoWatchFeed instanceof CryptoWatchPriceFeed);
    assert.equal(validCryptoWatchFeed.apiKey, apiKey);
    assert.equal(validCryptoWatchFeed.exchange, exchange);
    assert.equal(validCryptoWatchFeed.pair, pair);
    assert.equal(validCryptoWatchFeed.lookback, lookback);
    assert.equal(validCryptoWatchFeed.getTime(), getTime());
  });

  it("Invalid CryptoWatch", async function() {
    const validConfig = {
      type: "cryptowatch",
      apiKey,
      exchange,
      pair,
      lookback,
      minTimeBetweenUpdates
    };

    assert.equal(await createPriceFeed(web3, logger, networker, getTime, { ...validConfig, apiKey: undefined }), null);
    assert.equal(
      await createPriceFeed(web3, logger, networker, getTime, { ...validConfig, exchange: undefined }),
      null
    );
    assert.equal(await createPriceFeed(web3, logger, networker, getTime, { ...validConfig, pair: undefined }), null);
    assert.equal(
      await createPriceFeed(web3, logger, networker, getTime, { ...validConfig, lookback: undefined }),
      null
    );
    assert.equal(
      await createPriceFeed(web3, logger, networker, getTime, { ...validConfig, minTimeBetweenUpdates: undefined }),
      null
    );
  });

  it("Valid Uniswap", async function() {
    const config = {
      type: "uniswap",
      uniswapAddress,
      twapLength,
      lookback
    };

    const validUniswapFeed = await createPriceFeed(web3, logger, networker, getTime, config);

    assert.isTrue(validUniswapFeed instanceof UniswapPriceFeed);
    assert.equal(validUniswapFeed.uniswap.options.address, uniswapAddress);
    assert.equal(validUniswapFeed.twapLength, twapLength);
    assert.equal(validUniswapFeed.historicalLookback, lookback);
    assert.equal(validUniswapFeed.getTime(), getTime());
  });

  it("Invalid Uniswap", async function() {
    const validConfig = {
      type: "uniswap",
      uniswapAddress,
      twapLength,
      lookback
    };

    assert.equal(
      await createPriceFeed(web3, logger, networker, getTime, { ...validConfig, uniswapAddress: undefined }),
      null
    );
    assert.equal(
      await createPriceFeed(web3, logger, networker, getTime, { ...validConfig, twapLength: undefined }),
      null
    );
    assert.equal(
      await createPriceFeed(web3, logger, networker, getTime, { ...validConfig, lookback: undefined }),
      null
    );
  });

  it("Valid Medianizer Inheritance", async function() {
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

    const validMedianizerFeed = await createPriceFeed(web3, logger, networker, getTime, config);

    assert.isTrue(validMedianizerFeed instanceof MedianizerPriceFeed);
    assert.isTrue(validMedianizerFeed.priceFeeds[0] instanceof CryptoWatchPriceFeed);
    assert.isTrue(validMedianizerFeed.priceFeeds[1] instanceof UniswapPriceFeed);

    assert.equal(validMedianizerFeed.priceFeeds[0].pair, pair);
    assert.equal(validMedianizerFeed.priceFeeds[1].uniswap.options.address, uniswapAddress);
  });

  it("Valid Medianizer Override", async function() {
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

    const validMedianizerFeed = await createPriceFeed(web3, logger, networker, getTime, config);

    assert.equal(validMedianizerFeed.priceFeeds[0].lookback, lookbackOverride);
  });

  it("Medianizer feed cannot have no feeds to medianize", async function() {
    const config = {
      type: "medianizer",
      apiKey,
      exchange,
      pair,
      lookback,
      minTimeBetweenUpdates
    };

    const medianizerFeed = await createPriceFeed(web3, logger, networker, getTime, config);

    // medianizedFeeds is missing.
    assert.equal(await createPriceFeed(web3, logger, networker, getTime, config), null);

    // medianizedFeeds is 0 length.
    assert.equal(await createPriceFeed(web3, logger, networker, getTime, { ...config, medianizedFeeds: [] }), null);
  });

  it("Medianizer feed cannot have invalid nested feed", async function() {
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

    const medianizerFeed = await createPriceFeed(web3, logger, networker, getTime, config);

    assert.equal(medianizerFeed, null);
  });
});

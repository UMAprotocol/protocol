const { toWei } = web3.utils;

// Tested Contract
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");

// Helper Contracts
const Finder = artifacts.require("Finder");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const TokenFactory = artifacts.require("TokenFactory");
const Token = artifacts.require("ExpandedERC20");
const Timer = artifacts.require("Timer");
const Store = artifacts.require("Store");

const {
  createPriceFeed,
  createReferencePriceFeedForEmp,
  createUniswapPriceFeedForEmp,
  createTokenPriceFeedForEmp
} = require("../../src/price-feed/CreatePriceFeed");
const { CryptoWatchPriceFeed } = require("../../src/price-feed/CryptoWatchPriceFeed");
const { UniswapPriceFeed } = require("../../src/price-feed/UniswapPriceFeed");
const { BalancerPriceFeed } = require("../../src/price-feed/BalancerPriceFeed");
const { MedianizerPriceFeed } = require("../../src/price-feed/MedianizerPriceFeed");
const { NetworkerMock } = require("../../src/price-feed/NetworkerMock");
const winston = require("winston");

contract("CreatePriceFeed.js", function(accounts) {
  const { toChecksumAddress, randomHex } = web3.utils;

  let mockTime = 1588376548;
  let networker;
  let store;

  const apiKey = "test-api-key";
  const exchange = "test-exchange";
  const pair = "test-pair";
  const lookback = 120;
  const getTime = () => mockTime;
  const minTimeBetweenUpdates = 60;
  const twapLength = 180;
  const uniswapAddress = toChecksumAddress(randomHex(20));
  const balancerAddress = toChecksumAddress(randomHex(20));

  beforeEach(async function() {
    networker = new NetworkerMock();
    logger = winston.createLogger({
      silent: true
    });
    store = await Store.deployed();
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

  it("Default Uniswap Config", async function() {
    // Given the collateral token is 0x1, the , it should always come first, meaning the config should always be inverted.
    const collateralTokenAddress = "0x0000000000000000000000000000000000000001";

    const constructorParams = {
      expirationTimestamp: ((await web3.eth.getBlock("latest")).timestamp + 1000).toString(),
      withdrawalLiveness: "1000",
      collateralAddress: collateralTokenAddress,
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
      timerAddress: Timer.address,
      excessTokenBeneficiary: store.address
    };

    const emp = await ExpiringMultiParty.new(constructorParams);

    const getIdBackup = web3.eth.net.getId;

    // Modify web3 to say the chain id is mainnet temporarily.
    web3.eth.net.getId = async () => 1;

    const twapLength = 100;
    const priceFeed = await createUniswapPriceFeedForEmp(logger, web3, networker, getTime, emp.address, { twapLength });

    // Cannot test for the uniswap address since that depends on the synthetic token address, which is generated in a non-hermetic way.
    // Price should always be inverted since the collateralTokenAddress is 0x1.
    assert.isTrue(priceFeed.invertPrice);

    // Config override should be passed through.
    assert.equal(priceFeed.twapLength, twapLength);

    // Reset getId method.
    web3.eth.net.getId = getIdBackup;
  });

  it("Uniswap address not found", async function() {
    const collateralToken = await Token.new("UMA", "UMA", 18, { from: accounts[0] });

    const constructorParams = {
      expirationTimestamp: ((await web3.eth.getBlock("latest")).timestamp + 1000).toString(),
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
      timerAddress: Timer.address,
      excessTokenBeneficiary: store.address
    };

    const emp = await ExpiringMultiParty.new(constructorParams);

    let didThrow = false;
    try {
      // Creation should fail because this test network has no deployed uniswap contract and UNISWAP_ADDRESS isn't
      // provided in the environment.
      const priceFeed = await createUniswapPriceFeedForEmp(logger, web3, networker, getTime, emp.address);
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
      lookback: 7200
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
      timerAddress: Timer.address,
      excessTokenBeneficiary: store.address
    };

    const emp = await ExpiringMultiParty.new(constructorParams);

    const balancerFeed = await createTokenPriceFeedForEmp(logger, web3, networker, getTime, emp.address, config);
    assert.isTrue(balancerFeed instanceof BalancerPriceFeed);
  });

  it("Create token price feed for Uniswap", async function() {
    const collateralTokenAddress = "0x0000000000000000000000000000000000000001";
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
      timerAddress: Timer.address,
      excessTokenBeneficiary: store.address
    };

    const emp = await ExpiringMultiParty.new(constructorParams);

    const uniswapFeed = await createTokenPriceFeedForEmp(logger, web3, networker, getTime, emp.address, config);
    assert.isTrue(uniswapFeed instanceof UniswapPriceFeed);
  });

  it("Create token price feed defaults to Medianizer", async function() {
    const collateralTokenAddress = "0x0000000000000000000000000000000000000001";
    const constructorParams = {
      expirationTimestamp: ((await web3.eth.getBlock("latest")).timestamp + 1000).toString(),
      withdrawalLiveness: "1000",
      collateralAddress: collateralTokenAddress,
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
      timerAddress: Timer.address,
      excessTokenBeneficiary: store.address
    };

    const emp = await ExpiringMultiParty.new(constructorParams);

    // If `config` is undefined or ommitted (and set to its default value), this should return a Medianizer Price Feed
    let medianizerFeed = await createTokenPriceFeedForEmp(logger, web3, networker, getTime, emp.address);
    assert.isTrue(medianizerFeed instanceof MedianizerPriceFeed);
    medianizerFeed = await createTokenPriceFeedForEmp(logger, web3, networker, getTime, emp.address, undefined);
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
      expirationTimestamp: ((await web3.eth.getBlock("latest")).timestamp + 1000).toString(),
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
      timerAddress: Timer.address,
      excessTokenBeneficiary: store.address
    };

    let emp = await ExpiringMultiParty.new(constructorParams);

    // Should create a valid price feed with no config.
    const priceFeed = await createReferencePriceFeedForEmp(logger, web3, networker, getTime, emp.address, {
      minTimeBetweenUpdates: 5
    });

    assert.isTrue(priceFeed != null);
    assert.equal(priceFeed.priceFeeds[0].minTimeBetweenUpdates, 5);

    // Check that the default `lookback` property is overridden.
    assert.equal(priceFeed.priceFeeds[0].lookback, 1000);
  });

  it("Default reference price feed for invalid identifier", async function() {
    const collateralToken = await Token.new("UMA", "UMA", 18, { from: accounts[0] });

    const constructorParams = {
      expirationTimestamp: ((await web3.eth.getBlock("latest")).timestamp + 1000).toString(),
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
      timerAddress: Timer.address,
      excessTokenBeneficiary: store.address
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

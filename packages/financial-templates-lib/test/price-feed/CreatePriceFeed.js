const { web3, getContract } = require("hardhat");
const { assert } = require("chai");
const { toWei, utf8ToHex, padRight } = web3.utils;

// Tested Contract
const ExpiringMultiParty = getContract("ExpiringMultiParty");

// Helper Contracts
const Finder = getContract("Finder");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const Token = getContract("ExpandedERC20");
const SyntheticToken = getContract("SyntheticToken");
const Timer = getContract("Timer");
const Store = getContract("Store");
const AddressWhitelist = getContract("AddressWhitelist");

const {
  createPriceFeed,
  createReferencePriceFeedForFinancialContract,
  createUniswapPriceFeedForFinancialContract,
  createTokenPriceFeedForFinancialContract,
} = require("../../dist/price-feed/CreatePriceFeed");
const { CryptoWatchPriceFeed } = require("../../dist/price-feed/CryptoWatchPriceFeed");
const { UniswapV2PriceFeed, UniswapV3PriceFeed } = require("../../dist/price-feed/UniswapPriceFeed");
const { BalancerPriceFeed } = require("../../dist/price-feed/BalancerPriceFeed");
const { BasketSpreadPriceFeed } = require("../../dist/price-feed/BasketSpreadPriceFeed");
const { MedianizerPriceFeed } = require("../../dist/price-feed/MedianizerPriceFeed");
const { FallBackPriceFeed } = require("../../dist/price-feed/FallBackPriceFeed");
const { CoinMarketCapPriceFeed } = require("../../dist/price-feed/CoinMarketCapPriceFeed");
const { CoinGeckoPriceFeed } = require("../../dist/price-feed/CoinGeckoPriceFeed");
const { NetworkerMock } = require("../../dist/price-feed/NetworkerMock");
const { DefiPulsePriceFeed } = require("../../dist/price-feed/DefiPulsePriceFeed");
const { ETHVIXPriceFeed } = require("../../dist/price-feed/EthVixPriceFeed");
const { ForexDailyPriceFeed } = require("../../dist/price-feed/ForexDailyPriceFeed");
const { QuandlPriceFeed } = require("../../dist/price-feed/QuandlPriceFeed");
const { SpyTransport } = require("@uma/logger");

const winston = require("winston");
const sinon = require("sinon");

const { ZERO_ADDRESS, interfaceName } = require("@uma/common");

describe("CreatePriceFeed.js", function () {
  const { toChecksumAddress, randomHex } = web3.utils;
  let accounts;

  let mockTime = 1588376548;
  let networker;
  let logger;
  let store;
  let timer;
  let finder;
  let identifierWhitelist;
  let addressWhitelist;
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
  const forexBase = "EUR";
  const forexSymbol = "USD";
  const nodeUrlEnvVar = "NODE_URL_1";
  const chainId = 1;

  before(async function () {
    accounts = await web3.eth.getAccounts();
    finder = await Finder.new().send({ from: accounts[0] });
    addressWhitelist = await AddressWhitelist.new().send({ from: accounts[0] });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.AddressWhitelist), addressWhitelist.options.address)
      .send({ from: accounts[0] });
    identifierWhitelist = await IdentifierWhitelist.new().send({ from: accounts[0] });
    await identifierWhitelist.methods
      .addSupportedIdentifier(padRight(utf8ToHex("ETH/BTC"), 64))
      .send({ from: accounts[0] });
    timer = await Timer.new().send({ from: accounts[0] });
    store = await Store.new({ rawValue: "0" }, { rawValue: "0" }, timer.options.address).send({ from: accounts[0] });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.IdentifierWhitelist), identifierWhitelist.options.address)
      .send({ from: accounts[0] });
    process.env[nodeUrlEnvVar] = "https://cloudflare-eth.com";
  });

  beforeEach(async function () {
    networker = new NetworkerMock();
    spy = sinon.spy();

    logger = winston.createLogger({ level: "info", transports: [new SpyTransport({ level: "error" }, { spy: spy })] });
  });

  after(async function () {
    delete process.env[nodeUrlEnvVar];
  });

  it("No type", async function () {
    const config = { apiKey, exchange, pair, lookback, minTimeBetweenUpdates };

    assert.equal(await createPriceFeed(logger, web3, networker, getTime, config), null);
  });

  it("Valid BasketSpread config", async function () {
    const baselinePriceFeeds = [
      { type: "medianizer", medianizedFeeds: [{ type: "cryptowatch" }] },
      { type: "medianizer", medianizedFeeds: [{ type: "uniswap" }] },
    ];
    const experimentalPriceFeeds = [
      { type: "medianizer", medianizedFeeds: [{ type: "cryptowatch" }] },
      { type: "medianizer", medianizedFeeds: [{ type: "balancer" }] },
    ];
    const denominatorPriceFeed = { type: "medianizer", medianizedFeeds: [{ type: "cryptowatch" }] };
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
      balancerTokenOut: accounts[2],
    };

    const validBasketSpreadFeed = await createPriceFeed(logger, web3, networker, getTime, config);
    assert.isTrue(validBasketSpreadFeed instanceof BasketSpreadPriceFeed);

    // Check that baseline and experimental pricefeeds are lists of medianizer price feeds with the correct
    // constituent pricefeeds.
    assert.isTrue(validBasketSpreadFeed.baselinePriceFeeds[0] instanceof MedianizerPriceFeed);
    assert.isTrue(validBasketSpreadFeed.baselinePriceFeeds[0].priceFeeds[0] instanceof CryptoWatchPriceFeed);
    assert.isTrue(validBasketSpreadFeed.baselinePriceFeeds[1] instanceof MedianizerPriceFeed);
    assert.isTrue(validBasketSpreadFeed.baselinePriceFeeds[1].priceFeeds[0] instanceof UniswapV2PriceFeed);
    assert.isTrue(validBasketSpreadFeed.experimentalPriceFeeds[0] instanceof MedianizerPriceFeed);
    assert.isTrue(validBasketSpreadFeed.experimentalPriceFeeds[0].priceFeeds[0] instanceof CryptoWatchPriceFeed);
    assert.isTrue(validBasketSpreadFeed.experimentalPriceFeeds[1] instanceof MedianizerPriceFeed);
    assert.isTrue(validBasketSpreadFeed.experimentalPriceFeeds[1].priceFeeds[0] instanceof BalancerPriceFeed);
    assert.isTrue(validBasketSpreadFeed.denominatorPriceFeed instanceof MedianizerPriceFeed);
    assert.isTrue(validBasketSpreadFeed.denominatorPriceFeed.priceFeeds[0] instanceof CryptoWatchPriceFeed);
  });

  it("Valid BasketSpread config, no denominator price feed", async function () {
    const baselinePriceFeeds = [
      { type: "medianizer", medianizedFeeds: [{ type: "cryptowatch" }] },
      { type: "medianizer", medianizedFeeds: [{ type: "uniswap" }] },
    ];
    const experimentalPriceFeeds = [
      { type: "medianizer", medianizedFeeds: [{ type: "cryptowatch" }] },
      { type: "medianizer", medianizedFeeds: [{ type: "balancer" }] },
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
      balancerTokenOut: accounts[2],
    };

    const validBasketSpreadFeed = await createPriceFeed(logger, web3, networker, getTime, config);
    assert.isTrue(validBasketSpreadFeed instanceof BasketSpreadPriceFeed);

    // Check that baseline and experimental pricefeeds are lists of medianizer price feeds with the correct
    // constituent pricefeeds.
    assert.isTrue(validBasketSpreadFeed.baselinePriceFeeds[0] instanceof MedianizerPriceFeed);
    assert.isTrue(validBasketSpreadFeed.baselinePriceFeeds[0].priceFeeds[0] instanceof CryptoWatchPriceFeed);
    assert.isTrue(validBasketSpreadFeed.baselinePriceFeeds[1] instanceof MedianizerPriceFeed);
    assert.isTrue(validBasketSpreadFeed.baselinePriceFeeds[1].priceFeeds[0] instanceof UniswapV2PriceFeed);
    assert.isTrue(validBasketSpreadFeed.experimentalPriceFeeds[0] instanceof MedianizerPriceFeed);
    assert.isTrue(validBasketSpreadFeed.experimentalPriceFeeds[0].priceFeeds[0] instanceof CryptoWatchPriceFeed);
    assert.isTrue(validBasketSpreadFeed.experimentalPriceFeeds[1] instanceof MedianizerPriceFeed);
    assert.isTrue(validBasketSpreadFeed.experimentalPriceFeeds[1].priceFeeds[0] instanceof BalancerPriceFeed);
    assert.equal(validBasketSpreadFeed.denominatorPriceFeed, undefined);
  });

  it("Invalid BasketSpread config", async function () {
    const baselinePriceFeeds = [
      { type: "medianizer", medianizedFeeds: [{ type: "cryptowatch" }] },
      { type: "medianizer", medianizedFeeds: [{ type: "uniswap" }] },
    ];
    const experimentalPriceFeeds = [
      { type: "medianizer", medianizedFeeds: [{ type: "cryptowatch" }] },
      { type: "medianizer", medianizedFeeds: [{ type: "balancer" }] },
    ];
    const denominatorPriceFeed = { type: "medianizer", medianizedFeeds: [{ type: "cryptowatch" }] };
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
      balancerTokenOut: accounts[2],
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

  it("Valid CryptoWatch config", async function () {
    const config = { type: "cryptowatch", cryptowatchApiKey: apiKey, exchange, pair, lookback, minTimeBetweenUpdates };

    const validCryptoWatchFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.isTrue(validCryptoWatchFeed instanceof CryptoWatchPriceFeed);
    assert.equal(validCryptoWatchFeed.apiKey, apiKey);
    assert.equal(validCryptoWatchFeed.exchange, exchange);
    assert.equal(validCryptoWatchFeed.pair, pair);
    assert.equal(validCryptoWatchFeed.lookback, lookback);
    assert.equal(validCryptoWatchFeed.getTime(), getTime());
    assert.equal(validCryptoWatchFeed.invertPrice, undefined);
  });

  it("Valid CryptoWatch config without apiKey", async function () {
    const config = { type: "cryptowatch", exchange, pair, lookback, minTimeBetweenUpdates };

    const validCryptoWatchFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.isTrue(validCryptoWatchFeed instanceof CryptoWatchPriceFeed);
    assert.equal(validCryptoWatchFeed.apiKey, undefined);
  });

  it("Invalid CryptoWatch config", async function () {
    const validConfig = {
      type: "cryptowatch",
      cryptowatchApiKey: apiKey,
      exchange,
      pair,
      lookback,
      minTimeBetweenUpdates,
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

  it("Valid Uniswap config", async function () {
    const config = { type: "uniswap", uniswapAddress, twapLength, lookback };

    const validUniswapFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.isTrue(validUniswapFeed instanceof UniswapV2PriceFeed);
    assert.equal(validUniswapFeed.uniswap.options.address, uniswapAddress);
    assert.equal(validUniswapFeed.twapLength, twapLength);
    assert.equal(validUniswapFeed.historicalLookback, lookback);
    assert.equal(validUniswapFeed.getTime(), getTime());
    assert.equal(validUniswapFeed.invertPrice, undefined);
    assert.equal(validUniswapFeed.web3, web3);

    // Invert parameter should be passed through.
    const validInvertedUniswapFeed = await createPriceFeed(logger, web3, networker, getTime, {
      ...config,
      invertPrice: true,
    });
    assert.isTrue(validInvertedUniswapFeed.invertPrice);
  });

  it("Valid Uniswap config with alternate node", async function () {
    const config = { type: "uniswap", uniswapAddress, twapLength, lookback, chainId };

    const validUniswapFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.notEqual(validUniswapFeed.web3, web3);
  });

  it("Invalid Uniswap config", async function () {
    const validConfig = { type: "uniswap", uniswapAddress, twapLength, lookback };

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

  it("Default Uniswap Config", async function () {
    // Given the collateral token is 0x1, the , it should always come first, meaning the config should always be inverted.
    const collateralTokenAddress = "0x0000000000000000000000000000000000000001";
    const syntheticTokenAddress = "0x0000000000000000000000000000000000000002";

    const constructorParams = {
      expirationTimestamp: ((await web3.eth.getBlock("latest")).timestamp + 1000).toString(),
      withdrawalLiveness: "1000",
      collateralAddress: collateralTokenAddress,
      tokenAddress: syntheticTokenAddress,
      finderAddress: finder.options.address,
      priceFeedIdentifier: padRight(utf8ToHex("ETH/BTC"), 64), // Note: an identifier which is part of the default config is required for this test.
      liquidationLiveness: "1000",
      collateralRequirement: { rawValue: toWei("1.5") },
      disputeBondPercentage: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPercentage: { rawValue: toWei("0.1") },
      disputerDisputeRewardPercentage: { rawValue: toWei("0.1") },
      minSponsorTokens: { rawValue: toWei("1") },
      timerAddress: timer.options.address,
      excessTokenBeneficiary: store.options.address,
      financialProductLibraryAddress: ZERO_ADDRESS,
    };

    const financialContract = await ExpiringMultiParty.new(constructorParams).send({ from: accounts[0] });

    const getIdBackup = web3.eth.net.getId;

    // Modify web3 to say the chain id is mainnet temporarily.
    web3.eth.net.getId = async () => 1;

    const twapLength = 100;
    const priceFeed = await createUniswapPriceFeedForFinancialContract(
      logger,
      web3,
      networker,
      getTime,
      financialContract.options.address,
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

  it("Uniswap address not found", async function () {
    const collateralToken = await Token.new("Wrapped Ether", "WETH", 18).send({ from: accounts[0] });
    const syntheticToken = await SyntheticToken.new("Test Synthetic Token", "SYNTH", 18).send({ from: accounts[0] });

    const constructorParams = {
      expirationTimestamp: ((await web3.eth.getBlock("latest")).timestamp + 1000).toString(),
      withdrawalLiveness: "1000",
      collateralAddress: collateralToken.options.address,
      tokenAddress: syntheticToken.options.address,
      finderAddress: finder.options.address,
      priceFeedIdentifier: padRight(utf8ToHex("ETH/BTC"), 64), // Note: an identifier which is part of the default config is required for this test.
      liquidationLiveness: "1000",
      collateralRequirement: { rawValue: toWei("1.5") },
      disputeBondPercentage: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPercentage: { rawValue: toWei("0.1") },
      disputerDisputeRewardPercentage: { rawValue: toWei("0.1") },
      minSponsorTokens: { rawValue: toWei("1") },
      timerAddress: timer.options.address,
      excessTokenBeneficiary: store.options.address,
      financialProductLibraryAddress: ZERO_ADDRESS,
    };

    const financialContract = await ExpiringMultiParty.new(constructorParams);

    let didThrow = false;
    try {
      // Creation should fail because this test network has no deployed uniswap contract and UNISWAP_ADDRESS isn't
      // provided in the environment.
      await createUniswapPriceFeedForFinancialContract(
        logger,
        web3,
        networker,
        getTime,
        financialContract.options.address
      );
    } catch (error) {
      didThrow = true;
    }

    assert.isTrue(didThrow);
  });

  it("Valid Balancer config", async function () {
    const config = {
      type: "balancer",
      balancerAddress,
      balancerTokenIn: accounts[1],
      balancerTokenOut: accounts[2],
      lookback: 7200,
      twapLength: 7200,
    };

    const balancerFeed = await createPriceFeed(logger, web3, networker, getTime, config);
    assert.isTrue(balancerFeed instanceof BalancerPriceFeed);
    assert.equal(balancerFeed.web3, web3);
  });

  it("Valid Balancer config with alternate node", async function () {
    const config = {
      type: "balancer",
      balancerAddress,
      balancerTokenIn: accounts[1],
      balancerTokenOut: accounts[2],
      lookback: 7200,
      twapLength: 7200,
      chainId,
    };

    const balancerFeed = await createPriceFeed(logger, web3, networker, getTime, config);
    assert.notEqual(balancerFeed.web3, web3);
  });

  it("Valid Uniswap v3 config", async function () {
    const config = { type: "uniswap", uniswapAddress, twapLength, lookback, version: "v3" };

    const validUniswapFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.isTrue(validUniswapFeed instanceof UniswapV3PriceFeed);
    assert.equal(validUniswapFeed.web3, web3);
  });

  it("Valid Uniswap v3 config with alternate node", async function () {
    const config = { type: "uniswap", uniswapAddress, twapLength, lookback, version: "v3", chainId };

    const validUniswapFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.isTrue(validUniswapFeed instanceof UniswapV3PriceFeed);
    assert.notEqual(validUniswapFeed.web3, web3);
  });

  it("Invalid Uniswap version string", async function () {
    const config = { type: "uniswap", uniswapAddress, twapLength, lookback, version: "v1" };

    const invalidUniswapFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.isNull(invalidUniswapFeed);
  });

  it("Invalid Balancer config", async function () {
    const config = { type: "balancer", balancerAddress };

    const balancerFeed = await createPriceFeed(logger, web3, networker, getTime, config);
    assert.equal(balancerFeed, null);
  });
  it("Create token price feed for Balancer", async function () {
    const collateralTokenAddress = "0x0000000000000000000000000000000000000001";
    const syntheticTokenAddress = "0x0000000000000000000000000000000000000002";

    const config = { type: "balancer", balancerAddress, balancerTokenIn: accounts[1], balancerTokenOut: accounts[2] };

    const constructorParams = {
      expirationTimestamp: ((await web3.eth.getBlock("latest")).timestamp + 1000).toString(),
      withdrawalLiveness: "1000",
      collateralAddress: collateralTokenAddress,
      tokenAddress: syntheticTokenAddress,
      finderAddress: finder.options.address,
      priceFeedIdentifier: padRight(utf8ToHex("ETH/BTC"), 64), // Note: an identifier which is part of the default config is required for this test.
      liquidationLiveness: "1000",
      collateralRequirement: { rawValue: toWei("1.5") },
      disputeBondPercentage: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPercentage: { rawValue: toWei("0.1") },
      disputerDisputeRewardPercentage: { rawValue: toWei("0.1") },
      minSponsorTokens: { rawValue: toWei("1") },
      timerAddress: timer.options.address,
      excessTokenBeneficiary: store.options.address,
      financialProductLibraryAddress: ZERO_ADDRESS,
    };

    const financialContract = await ExpiringMultiParty.new(constructorParams).send({ from: accounts[0] });

    const balancerFeed = await createTokenPriceFeedForFinancialContract(
      logger,
      web3,
      networker,
      getTime,
      financialContract.options.address,
      config
    );
    assert.isTrue(balancerFeed instanceof BalancerPriceFeed);
  });

  it("Create token price feed for Uniswap", async function () {
    const collateralTokenAddress = "0x0000000000000000000000000000000000000001";
    const syntheticTokenAddress = "0x0000000000000000000000000000000000000002";

    const config = { type: "uniswap", uniswapAddress, twapLength, lookback };

    const constructorParams = {
      expirationTimestamp: ((await web3.eth.getBlock("latest")).timestamp + 1000).toString(),
      withdrawalLiveness: "1000",
      collateralAddress: collateralTokenAddress,
      tokenAddress: syntheticTokenAddress,
      finderAddress: finder.options.address,
      priceFeedIdentifier: padRight(utf8ToHex("ETH/BTC"), 64), // Note: an identifier which is part of the default config is required for this test.
      liquidationLiveness: "1000",
      collateralRequirement: { rawValue: toWei("1.5") },
      disputeBondPercentage: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPercentage: { rawValue: toWei("0.1") },
      disputerDisputeRewardPercentage: { rawValue: toWei("0.1") },
      minSponsorTokens: { rawValue: toWei("1") },
      timerAddress: timer.options.address,
      excessTokenBeneficiary: store.options.address,
      financialProductLibraryAddress: ZERO_ADDRESS,
    };

    const financialContract = await ExpiringMultiParty.new(constructorParams).send({ from: accounts[0] });

    const uniswapFeed = await createTokenPriceFeedForFinancialContract(
      logger,
      web3,
      networker,
      getTime,
      financialContract.options.address,
      config
    );
    assert.isTrue(uniswapFeed instanceof UniswapV2PriceFeed);
  });

  it("Create token price feed defaults to Medianizer", async function () {
    const collateralTokenAddress = "0x0000000000000000000000000000000000000001";
    const syntheticTokenAddress = "0x0000000000000000000000000000000000000002";

    const constructorParams = {
      expirationTimestamp: ((await web3.eth.getBlock("latest")).timestamp + 1000).toString(),
      withdrawalLiveness: "1000",
      collateralAddress: collateralTokenAddress,
      tokenAddress: syntheticTokenAddress,
      finderAddress: finder.options.address,
      priceFeedIdentifier: padRight(utf8ToHex("ETH/BTC"), 64), // Note: an identifier which is part of the default config is required for this test.defined as part of the default bot configs
      liquidationLiveness: "1000",
      collateralRequirement: { rawValue: toWei("1.5") },
      disputeBondPercentage: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPercentage: { rawValue: toWei("0.1") },
      disputerDisputeRewardPercentage: { rawValue: toWei("0.1") },
      minSponsorTokens: { rawValue: toWei("1") },
      timerAddress: timer.options.address,
      excessTokenBeneficiary: store.options.address,
      financialProductLibraryAddress: ZERO_ADDRESS,
    };

    const financialContract = await ExpiringMultiParty.new(constructorParams).send({ from: accounts[0] });

    // If `config` is undefined or ommitted (and set to its default value), this should return a Medianizer Price Feed
    let medianizerFeed = await createTokenPriceFeedForFinancialContract(
      logger,
      web3,
      networker,
      getTime,
      financialContract.options.address
    );
    assert.isTrue(medianizerFeed instanceof MedianizerPriceFeed);
    medianizerFeed = await createTokenPriceFeedForFinancialContract(
      logger,
      web3,
      networker,
      getTime,
      financialContract.options.address,
      undefined
    );
    assert.isTrue(medianizerFeed instanceof MedianizerPriceFeed);
  });

  it("Valid Medianizer inherited config", async function () {
    const config = {
      type: "medianizer",
      apiKey,
      exchange,
      pair,
      lookback,
      minTimeBetweenUpdates,
      uniswapAddress,
      twapLength,
      medianizedFeeds: [{ type: "cryptowatch" }, { type: "uniswap" }],
      chainId,
    };

    const validMedianizerFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.isTrue(validMedianizerFeed instanceof MedianizerPriceFeed);
    assert.isTrue(validMedianizerFeed.priceFeeds[0] instanceof CryptoWatchPriceFeed);
    assert.isTrue(validMedianizerFeed.priceFeeds[1] instanceof UniswapV2PriceFeed);

    assert.equal(validMedianizerFeed.priceFeeds[0].pair, pair);
    assert.equal(validMedianizerFeed.priceFeeds[1].uniswap.options.address, uniswapAddress);

    assert.notEqual(validMedianizerFeed.priceFeeds[0].web3, web3);
    assert.notEqual(validMedianizerFeed.priceFeeds[1].web3, web3);
  });

  it("Valid Medianizer override config", async function () {
    const lookbackOverride = 5;
    const config = {
      type: "medianizer",
      apiKey,
      exchange,
      pair,
      lookback,
      minTimeBetweenUpdates,
      medianizedFeeds: [{ type: "cryptowatch", lookback: lookbackOverride }],
    };

    const validMedianizerFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.equal(validMedianizerFeed.priceFeeds[0].lookback, lookbackOverride);
  });

  it("Medianizer feed cannot have 0 nested feeds to medianize", async function () {
    const config = { type: "medianizer", apiKey, exchange, pair, lookback, minTimeBetweenUpdates };

    await createPriceFeed(logger, web3, networker, getTime, config);

    // medianizedFeeds is missing.
    assert.equal(await createPriceFeed(logger, web3, networker, getTime, config), null);

    // medianizedFeeds is 0 length.
    assert.equal(await createPriceFeed(logger, web3, networker, getTime, { ...config, medianizedFeeds: [] }), null);
  });

  it("Medianizer feed cannot have a nested feed with an invalid config", async function () {
    const config = {
      type: "medianizer",
      apiKey,
      exchange,
      pair,
      lookback,
      minTimeBetweenUpdates,
      medianizedFeeds: [
        { type: "cryptowatch" },
        {}, // Invalid because the second medianized feed has no type.
      ],
    };

    const medianizerFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.equal(medianizerFeed, null);
  });

  it("Valid Fallback inherited config", async function () {
    const config = {
      type: "fallback",
      apiKey,
      exchange,
      pair,
      lookback,
      minTimeBetweenUpdates,
      uniswapAddress,
      twapLength,
      orderedFeeds: [{ type: "cryptowatch" }, { type: "uniswap" }],
    };

    const validFallbackFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.isTrue(validFallbackFeed instanceof FallBackPriceFeed);
    assert.isTrue(validFallbackFeed.priceFeeds[0] instanceof CryptoWatchPriceFeed);
    assert.isTrue(validFallbackFeed.priceFeeds[1] instanceof UniswapV2PriceFeed);

    assert.equal(validFallbackFeed.priceFeeds[0].pair, pair);
    assert.equal(validFallbackFeed.priceFeeds[1].uniswap.options.address, uniswapAddress);
  });

  it("Valid Fallback override config", async function () {
    const lookbackOverride = 5;
    const config = {
      type: "fallback",
      apiKey,
      exchange,
      pair,
      lookback,
      minTimeBetweenUpdates,
      orderedFeeds: [{ type: "cryptowatch", lookback: lookbackOverride }],
    };

    const validFallbackFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.equal(validFallbackFeed.priceFeeds[0].lookback, lookbackOverride);
  });

  it("Fallback feed cannot have 0 nested feeds", async function () {
    const config = { type: "fallback", apiKey, exchange, pair, lookback, minTimeBetweenUpdates };

    await createPriceFeed(logger, web3, networker, getTime, config);

    // medianizedFeeds is missing.
    assert.equal(await createPriceFeed(logger, web3, networker, getTime, config), null);

    // medianizedFeeds is 0 length.
    assert.equal(await createPriceFeed(logger, web3, networker, getTime, { ...config, orderedFeeds: [] }), null);
  });

  it("Fallback feed cannot have a nested feed with an invalid config", async function () {
    const config = {
      type: "fallback",
      apiKey,
      exchange,
      pair,
      lookback,
      minTimeBetweenUpdates,
      orderedFeeds: [
        { type: "cryptowatch" },
        {}, // Invalid because the second medianized feed has no type.
      ],
    };

    const validFallbackFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.equal(validFallbackFeed, null);
  });

  it("ExpressionPriceFeed: invalid config, no expression", async function () {
    const config = { type: "expression" };

    const expressionPriceFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.isNull(expressionPriceFeed);
    assert.equal(spy.callCount, 1); // 1 error.
  });

  it("ExpressionPriceFeed: valid config, no resolved feeds", async function () {
    const config = { type: "expression", expression: "mysymbol * 2" };

    const expressionPriceFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.isNotNull(expressionPriceFeed);
    // Price feed map should have no elements.
    assert.equal(Object.keys(expressionPriceFeed.priceFeedMap).length, 0);
  });

  it("ExpressionPriceFeed: customFeeds", async function () {
    const config = {
      type: "expression",
      expression: "mysymbol * 2",
      customFeeds: {
        mysymbol: { type: "cryptowatch", cryptowatchApiKey: apiKey, exchange, pair, lookback, minTimeBetweenUpdates },
      },
    };

    const expressionPriceFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.isNotNull(expressionPriceFeed);
    assert.exists(expressionPriceFeed.priceFeedMap["mysymbol"]);
  });

  it("ExpressionPriceFeed: inherited config", async function () {
    const config = {
      type: "expression",
      expression: "mysymbol * 2",
      apiKey,
      exchange,
      pair,
      lookback,
      minTimeBetweenUpdates,
      customFeeds: { mysymbol: { type: "cryptowatch" } },
      chainId,
    };

    const expressionPriceFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.isNotNull(expressionPriceFeed);
    assert.exists(expressionPriceFeed.priceFeedMap["mysymbol"]);
    assert.equal(expressionPriceFeed.priceFeedMap["mysymbol"].lookback, lookback);
    assert.notEqual(expressionPriceFeed.priceFeedMap["mysymbol"].web3, web3);
  });

  it("ExpressionPriceFeed: invalid config, no expression", async function () {
    const config = { type: "expression" };

    const expressionPriceFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.isNull(expressionPriceFeed);
  });

  it("ExpressionPriceFeed: can find default price feeds", async function () {
    const config = { type: "expression", lookback, expression: "USDETH + ETH\\/BTC" };

    const expressionPriceFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.isNotNull(expressionPriceFeed);
  });

  it("ExpressionPriceFeed: invalid config in customFeeds is ignored if unused", async function () {
    const config = {
      type: "expression",
      expression: "2 + 5",
      customFeeds: {
        ETHBTC: {}, // Invalid because it has no type.
      },
    };

    const expressionPriceFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.isNotNull(expressionPriceFeed);
  });

  it("ExpressionPriceFeed: constant expression", async function () {
    const config = { type: "expression", expression: "1 + 2" };

    const expressionPriceFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.isNotNull(expressionPriceFeed);
  });

  it("VaultPriceFeed: valid config", async function () {
    const config = { type: "vault", address: web3.utils.randomHex(20) };

    const vaultPriceFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.isNotNull(vaultPriceFeed);
  });

  it("VaultPriceFeed: valid config with alternate node", async function () {
    const config = { type: "vault", address: web3.utils.randomHex(20), chainId };

    const vaultPriceFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.notEqual(vaultPriceFeed.web3, web3);
  });

  it("VaultPriceFeed: invalid config", async function () {
    const config = { type: "vault" };

    const vaultPriceFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.isNull(vaultPriceFeed);
    assert.equal(spy.callCount, 1); // 1 error.
  });

  it("VaultPriceFeed: shared BlockFinder", async function () {
    const config = { type: "vault", address: web3.utils.randomHex(20) };

    const vaultPriceFeed1 = await createPriceFeed(logger, web3, networker, getTime, config);
    const vaultPriceFeed2 = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.strictEqual(vaultPriceFeed2.blockFinder, vaultPriceFeed1.blockFinder);
  });

  it("VaultPriceFeed: optional parameters", async function () {
    const address = web3.utils.randomHex(20);
    const config = { type: "vault", address, priceFeedDecimals: 6, minTimeBetweenUpdates: 100 };

    const vaultPriceFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.equal(vaultPriceFeed.minTimeBetweenUpdates, 100);
    assert.equal(vaultPriceFeed.priceFeedDecimals, 6);
    assert.equal(vaultPriceFeed.vault.options.address, web3.utils.toChecksumAddress(address));
  });

  it("LPPriceFeed: valid config", async function () {
    const config = { type: "lp", poolAddress: web3.utils.randomHex(20), tokenAddress: web3.utils.randomHex(20) };

    const lpPriceFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.isNotNull(lpPriceFeed);
  });

  it("LPPriceFeed: valid config with alternate node", async function () {
    const config = {
      type: "lp",
      poolAddress: web3.utils.randomHex(20),
      tokenAddress: web3.utils.randomHex(20),
      chainId,
    };

    const lpPriceFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.notEqual(lpPriceFeed.web3, web3);
  });

  it("LPPriceFeed: invalid config, no token address", async function () {
    let config = { type: "lp", poolAddress: web3.utils.randomHex(20) };

    const lpPriceFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.isNull(lpPriceFeed);
    assert.equal(spy.callCount, 1); // 1 error.
  });

  it("LPPriceFeed: invalid config, no pool address", async function () {
    let config = { type: "lp", tokenAddress: web3.utils.randomHex(20) };

    const lpPriceFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.isNull(lpPriceFeed);
    assert.equal(spy.callCount, 1); // 1 error.
  });

  it("LPPriceFeed: shared BlockFinder", async function () {
    const config = { type: "lp", poolAddress: web3.utils.randomHex(20), tokenAddress: web3.utils.randomHex(20) };

    const lpPriceFeed1 = await createPriceFeed(logger, web3, networker, getTime, config);
    const lpPriceFeed2 = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.strictEqual(lpPriceFeed2.blockFinder, lpPriceFeed1.blockFinder);
  });

  it("LPPriceFeed: optional parameters", async function () {
    const tokenAddress = web3.utils.randomHex(20);
    const poolAddress = web3.utils.randomHex(20);
    const config = { type: "lp", tokenAddress, poolAddress, priceFeedDecimals: 6, minTimeBetweenUpdates: 100 };

    const lpPriceFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.equal(lpPriceFeed.minTimeBetweenUpdates, 100);
    assert.equal(lpPriceFeed.priceFeedDecimals, 6);
    assert.equal(lpPriceFeed.pool.options.address, web3.utils.toChecksumAddress(poolAddress));
    assert.equal(lpPriceFeed.token.options.address, web3.utils.toChecksumAddress(tokenAddress));
  });

  it("FundingRateMultiplierPriceFeed: creation succeeds", async function () {
    const perpetualAddress = web3.utils.randomHex(20);
    const multicallAddress = web3.utils.randomHex(20);
    const config = { type: "frm", perpetualAddress, multicallAddress };

    const frmPriceFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.equal(frmPriceFeed.minTimeBetweenUpdates, 60);
    assert.equal(frmPriceFeed.priceFeedDecimals, 18);
    assert.equal(frmPriceFeed.perpetual.options.address, web3.utils.toChecksumAddress(perpetualAddress));
    assert.equal(
      web3.utils.toChecksumAddress(frmPriceFeed.multicallAddress),
      web3.utils.toChecksumAddress(multicallAddress)
    );
  });

  it("FundingRateMultiplierPriceFeed: creation succeeds with alternate node", async function () {
    const perpetualAddress = web3.utils.randomHex(20);
    const multicallAddress = web3.utils.randomHex(20);
    const config = { type: "frm", perpetualAddress, multicallAddress, chainId };

    const frmPriceFeed = await createPriceFeed(logger, web3, networker, getTime, config);
    assert.notEqual(frmPriceFeed.web3, web3);
  });

  it("FundingRateMultiplierPriceFeed: creation fails due to missing perpetual address", async function () {
    const config = { type: "frm", multicallAddress: web3.utils.randomHex(20) };

    const frmPriceFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.isNull(frmPriceFeed);
  });

  it("FundingRateMultiplierPriceFeed: creation fails due to missing multicall address", async function () {
    const config = { type: "frm", perpetualAddress: web3.utils.randomHex(20) };

    const frmPriceFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.isNull(frmPriceFeed);
  });

  it("Default reference price feed", async function () {
    const collateralToken = await Token.new("Wrapped Ether", "WETH", 18).send({ from: accounts[0] });
    const syntheticToken = await SyntheticToken.new("Test Synthetic Token", "SYNTH", 18).send({ from: accounts[0] });

    const constructorParams = {
      expirationTimestamp: ((await web3.eth.getBlock("latest")).timestamp + 1000).toString(),
      withdrawalLiveness: "1000",
      collateralAddress: collateralToken.options.address,
      tokenAddress: syntheticToken.options.address,
      finderAddress: finder.options.address,
      priceFeedIdentifier: padRight(utf8ToHex("ETH/BTC"), 64), // Note: an identifier which is part of the default config is required for this test.
      liquidationLiveness: "1000",
      collateralRequirement: { rawValue: toWei("1.5") },
      disputeBondPercentage: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPercentage: { rawValue: toWei("0.1") },
      disputerDisputeRewardPercentage: { rawValue: toWei("0.1") },
      minSponsorTokens: { rawValue: toWei("1") },
      timerAddress: timer.options.address,
      excessTokenBeneficiary: store.options.address,
      financialProductLibraryAddress: ZERO_ADDRESS,
    };

    let financialContract = await ExpiringMultiParty.new(constructorParams).send({ from: accounts[0] });

    // Should create a valid price feed with no config.
    const priceFeed = await createReferencePriceFeedForFinancialContract(
      logger,
      web3,
      networker,
      getTime,
      financialContract.options.address,
      { minTimeBetweenUpdates: 5 }
    );

    assert.isTrue(priceFeed !== null);
    assert.equal(priceFeed.priceFeeds[0].minTimeBetweenUpdates, 5);

    // Note that the `ETH/BTC` feed should have an 18 decimal feed. This should be correctly detected.
    assert.equal(priceFeed.getPriceFeedDecimals(), 18);

    // Check that the default `lookback` property is overridden.
    assert.equal(priceFeed.priceFeeds[0].lookback, 1000);
  });

  it("Non-standard decimals reference price feed", async function () {
    const collateralToken = await Token.new("Wrapped Ether", "WETH", 8).send({ from: accounts[0] });
    const syntheticToken = await SyntheticToken.new("Test Synthetic Token", "SYNTH", 18).send({ from: accounts[0] });

    // For this test we are using a lower decimal identifier, USDBTC. First we need to add it to the whitelist.
    await identifierWhitelist.methods
      .addSupportedIdentifier(padRight(utf8ToHex("USDBTC"), 64))
      .send({ from: accounts[0] });

    const constructorParams = {
      expirationTimestamp: ((await web3.eth.getBlock("latest")).timestamp + 1000).toString(),
      withdrawalLiveness: "1000",
      collateralAddress: collateralToken.options.address,
      tokenAddress: syntheticToken.options.address,
      finderAddress: finder.options.address,
      priceFeedIdentifier: padRight(utf8ToHex("USDBTC"), 64), // Note: an identifier which is part of the default config is required for this test.
      liquidationLiveness: "1000",
      collateralRequirement: { rawValue: toWei("1.5") },
      disputeBondPercentage: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPercentage: { rawValue: toWei("0.1") },
      disputerDisputeRewardPercentage: { rawValue: toWei("0.1") },
      minSponsorTokens: { rawValue: toWei("1") },
      timerAddress: timer.options.address,
      excessTokenBeneficiary: store.options.address,
      financialProductLibraryAddress: ZERO_ADDRESS,
    };

    let financialContract = await ExpiringMultiParty.new(constructorParams).send({ from: accounts[0] });

    // Should create a valid price feed with no config.
    const priceFeed = await createReferencePriceFeedForFinancialContract(
      logger,
      web3,
      networker,
      getTime,
      financialContract.options.address,
      { minTimeBetweenUpdates: 5 }
    );

    assert.isTrue(priceFeed !== null);
    assert.equal(priceFeed.priceFeeds[0].minTimeBetweenUpdates, 5);

    // Note that the `USDBTC` feed should have an 18 decimal feed.
    assert.equal(priceFeed.getPriceFeedDecimals(), 8);

    // Check that the default `lookback` property is overridden.
    assert.equal(priceFeed.priceFeeds[0].lookback, 1000);
  });

  it("Default reference price feed for invalid identifier", async function () {
    const collateralToken = await Token.new("Wrapped Ether", "WETH", 18).send({ from: accounts[0] });
    const syntheticToken = await SyntheticToken.new("Test Synthetic Token", "SYNTH", 18).send({ from: accounts[0] });

    const constructorParams = {
      expirationTimestamp: ((await web3.eth.getBlock("latest")).timestamp + 1000).toString(),
      withdrawalLiveness: "1000",
      collateralAddress: collateralToken.options.address,
      tokenAddress: syntheticToken.options.address,
      finderAddress: finder.options.address,
      priceFeedIdentifier: padRight(utf8ToHex("Invalid Identifier"), 64),
      liquidationLiveness: "1000",
      collateralRequirement: { rawValue: toWei("1.5") },
      disputeBondPercentage: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPercentage: { rawValue: toWei("0.1") },
      disputerDisputeRewardPercentage: { rawValue: toWei("0.1") },
      minSponsorTokens: { rawValue: toWei("1") },
      timerAddress: timer.options.address,
      excessTokenBeneficiary: store.options.address,
      financialProductLibraryAddress: ZERO_ADDRESS,
    };

    await identifierWhitelist.methods
      .addSupportedIdentifier(constructorParams.priceFeedIdentifier)
      .send({ from: accounts[0] });

    let financialContract = await ExpiringMultiParty.new(constructorParams).send({ from: accounts[0] });

    let didThrow = false;
    try {
      // Should create an invlid price feed since an invalid identifier was provided.
      await createReferencePriceFeedForFinancialContract(
        logger,
        web3,
        networker,
        getTime,
        financialContract.options.address
      );
    } catch (error) {
      didThrow = true;
    }

    assert.isTrue(didThrow);
  });

  it("Valid CoinMarketCap config", async function () {
    const config = { type: "coinmarketcap", cmcApiKey: apiKey, symbol, quoteCurrency, lookback, minTimeBetweenUpdates };

    const validCoinMarketCapFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.isTrue(validCoinMarketCapFeed instanceof CoinMarketCapPriceFeed);
    assert.equal(validCoinMarketCapFeed.apiKey, apiKey);
    assert.equal(validCoinMarketCapFeed.symbol, symbol);
    assert.equal(validCoinMarketCapFeed.quoteCurrency, quoteCurrency);
    assert.equal(validCoinMarketCapFeed.lookback, lookback);
    assert.equal(validCoinMarketCapFeed.getTime(), getTime());
    assert.equal(validCoinMarketCapFeed.invertPrice, undefined);
  });

  it("Invalid CoinMarketCap config", async function () {
    const validConfig = {
      type: "coinmarketcap",
      cmcApiKey: apiKey,
      symbol,
      quoteCurrency,
      lookback,
      minTimeBetweenUpdates,
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

  it("Valid CoinGecko config", async function () {
    const config = { type: "coingecko", contractAddress, quoteCurrency, lookback, minTimeBetweenUpdates };

    const validCoinGeckoFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.isTrue(validCoinGeckoFeed instanceof CoinGeckoPriceFeed);
    assert.equal(validCoinGeckoFeed.contractAddress, contractAddress);
    assert.equal(validCoinGeckoFeed.quoteCurrency, quoteCurrency);
    assert.equal(validCoinGeckoFeed.lookback, lookback);
    assert.equal(validCoinGeckoFeed.getTime(), getTime());
    assert.equal(validCoinGeckoFeed.invertPrice, undefined);
  });

  it("Invalid CoinGecko config", async function () {
    const validConfig = { type: "coingecko", contractAddress, quoteCurrency, lookback, minTimeBetweenUpdates };

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
  it("Valid ForexDaily config", async function () {
    const config = { type: "forexdaily", base: forexBase, symbol: forexSymbol, lookback };

    const validForexDailyFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.isTrue(validForexDailyFeed instanceof ForexDailyPriceFeed);
    assert.equal(validForexDailyFeed.base, forexBase);
    assert.equal(validForexDailyFeed.symbol, forexSymbol);
    assert.equal(validForexDailyFeed.lookback, lookback);
    assert.equal(validForexDailyFeed.getTime(), getTime());
  });

  it("Invalid ForexDaily config", async function () {
    const validConfig = { type: "forexdaily", base: forexBase, symbol: forexSymbol, lookback };

    // Missing base
    assert.equal(await createPriceFeed(logger, web3, networker, getTime, { ...validConfig, base: undefined }), null);
    // Missing symbol
    assert.equal(await createPriceFeed(logger, web3, networker, getTime, { ...validConfig, symbol: undefined }), null);
    // Mising lookback
    assert.equal(
      await createPriceFeed(logger, web3, networker, getTime, { ...validConfig, lookback: undefined }),
      null
    );
  });
  it("Valid Quandl config", async function () {
    const config = {
      type: "quandl",
      datasetCode: forexBase, // Doesn't matter what we set here as long as its not null
      databaseCode: forexSymbol, // Doesn't matter what we set here as long as its not null
      lookback,
      quandlApiKey: apiKey,
    };

    const validQuandlFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.isTrue(validQuandlFeed instanceof QuandlPriceFeed);
    assert.equal(validQuandlFeed.datasetCode, forexBase);
    assert.equal(validQuandlFeed.databaseCode, forexSymbol);
    assert.equal(validQuandlFeed.lookback, lookback);
    assert.equal(validQuandlFeed.getTime(), getTime());
  });

  it("Invalid Quandl config", async function () {
    const validConfig = {
      type: "quandl",
      datasetCode: forexBase, // Doesn't matter what we set here as long as its not null
      databaseCode: forexSymbol, // Doesn't matter what we set here as long as its not null
      lookback,
      quandlApiKey: apiKey,
    };

    // Missing datasetCode
    assert.equal(
      await createPriceFeed(logger, web3, networker, getTime, { ...validConfig, datasetCode: undefined }),
      null
    );
    // Missing databaseCode
    assert.equal(
      await createPriceFeed(logger, web3, networker, getTime, { ...validConfig, databaseCode: undefined }),
      null
    );
    // Mising lookback
    assert.equal(
      await createPriceFeed(logger, web3, networker, getTime, { ...validConfig, lookback: undefined }),
      null
    );
    // Mising quandlApiKey
    assert.equal(
      await createPriceFeed(logger, web3, networker, getTime, { ...validConfig, quandlApiKey: undefined }),
      null
    );
  });
  it("Valid DefiPulse config", async function () {
    const config = {
      type: "defipulse",
      lookback: 604800,
      defipulseApiKey: apiKey,
      minTimeBetweenUpdates: 600,
      project: "SushiSwap",
    };

    const validDefiPulsePriceFeed = await createPriceFeed(logger, web3, networker, getTime, config);

    assert.isTrue(validDefiPulsePriceFeed instanceof DefiPulsePriceFeed);
  });

  it("Invalid DefiPulse config", async function () {
    const validConfig = {
      type: "defipulse",
      lookback: 604800,
      defipulseApiKey: apiKey,
      minTimeBetweenUpdates: 600,
      project: "SushiSwap",
    };

    assert.equal(
      await createPriceFeed(logger, web3, networker, getTime, { ...validConfig, defipulseApiKey: undefined }),
      null
    );
    assert.equal(await createPriceFeed(logger, web3, networker, getTime, { ...validConfig, project: undefined }), null);
    assert.equal(
      await createPriceFeed(logger, web3, networker, getTime, { ...validConfig, lookback: undefined }),
      null
    );
    assert.equal(
      await createPriceFeed(logger, web3, networker, getTime, { ...validConfig, minTimeBetweenUpdates: undefined }),
      null
    );
  });

  it("Default ethVIX Config", async function () {
    assert.isTrue(
      (await createPriceFeed(logger, web3, networker, getTime, { type: "ethvix" })) instanceof ETHVIXPriceFeed
    );
  });

  it("Valid ethVIX Config", async function () {
    assert.isTrue(
      (await createPriceFeed(logger, web3, networker, getTime, {
        inverse: true,
        randomUnknownParam: Math.random(),
        type: "ethvix",
      })) instanceof ETHVIXPriceFeed
    );
  });
});

const { toWei, utf8ToHex } = web3.utils;

// Script to test
const Poll = require("../index.js");

// Contracts and helpers
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const Finder = artifacts.require("Finder");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const TokenFactory = artifacts.require("TokenFactory");
const Token = artifacts.require("ExpandedERC20");
const Timer = artifacts.require("Timer");
const UniswapMock = artifacts.require("UniswapMock");

// Custom winston transport module to monitor winston log outputs
const winston = require("winston");
const sinon = require("sinon");
const { SpyTransport, spyLogLevel, spyLogIncludes } = require("@umaprotocol/financial-templates-lib");

contract("index.js", function(accounts) {
  const contractCreator = accounts[0];

  let collateralToken;
  let syntheticToken;
  let emp;
  let uniswap;

  let defaultUniswapPricefeedConfig;
  let defaultMedianizerPricefeedConfig;
  let defaultMonitorConfig;

  let spy;
  let spyLogger;
  let pollingDelay = 0; // 0 polling delay creates a serverless bot that yields after one full execution.
  let fromBlock = 0; // setting the from block to 0 will query all historic logs events.
  let toBlock = null; // setting the to block to 0 will query up to the latest block Number.
  let executionRetries = 0; // setting execution re-tried to 0 will exit as soon as the process encounters an error.
  let errorRetriesTimeout = 100; // 100 milliseconds between preforming retries.

  before(async function() {
    collateralToken = await Token.new("DAI", "DAI", 18, { from: contractCreator });

    // Create identifier whitelist and register the price tracking ticker with it.
    identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.addSupportedIdentifier(utf8ToHex("ETH/BTC"));
  });

  beforeEach(async function() {
    // Create a sinon spy and give it to the SpyTransport as the winston logger. Use this to check all winston logs.
    spy = sinon.spy(); // Create a new spy for each test.
    spyLogger = winston.createLogger({
      level: "info",
      transports: [new SpyTransport({ level: "info" }, { spy: spy })]
    });

    const constructorParams = {
      expirationTimestamp: "12345678900",
      withdrawalLiveness: "1000",
      collateralAddress: collateralToken.address,
      finderAddress: Finder.address,
      tokenFactoryAddress: TokenFactory.address,
      priceFeedIdentifier: utf8ToHex("ETH/BTC"),
      syntheticName: "Test UMA Token",
      syntheticSymbol: "ETH/BTC",
      liquidationLiveness: "1000",
      collateralRequirement: { rawValue: toWei("1.2") },
      disputeBondPct: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPct: { rawValue: toWei("0.1") },
      disputerDisputeRewardPct: { rawValue: toWei("0.1") },
      minSponsorTokens: { rawValue: toWei("1") },
      timerAddress: Timer.address
    };

    // Deploy a new expiring multi party
    emp = await ExpiringMultiParty.new(constructorParams);

    syntheticToken = await Token.at(await emp.tokenCurrency());

    uniswap = await UniswapMock.new();

    // Run with empty configs for all input values, except for uniswap mock which is needed as no uniswap market in test env.
    defaultMonitorConfig = {};
    defaultUniswapPricefeedConfig = {
      type: "uniswap",
      uniswapAddress: uniswap.address,
      twapLength: 1,
      lookback: 1
    };
    defaultMedianizerPricefeedConfig = {};

    // Set two uniswap prices to give it a little history.
    await uniswap.setPrice(toWei("1"), toWei("1"));
    await uniswap.setPrice(toWei("1"), toWei("1"));
  });

  it("Completes one iteration without logging any errors", async function() {
    await Poll.run(
      spyLogger,
      emp.address,
      pollingDelay,
      executionRetries,
      errorRetriesTimeout,
      fromBlock,
      toBlock,
      defaultMonitorConfig,
      defaultUniswapPricefeedConfig,
      defaultMedianizerPricefeedConfig
    );

    for (let i = 0; i < spy.callCount; i++) {
      assert.notEqual(spyLogLevel(spy, i), "error");
    }
  });

  it("Correctly re-tries after failed execution loop", async function() {
    // To create an error within the monitor bot we can create a price feed that we know will throw an error.
    // Specifically, creating a invalidUniswapPricefeedConfig that will check against a price that is NOT a valid pair.
    const invalidUniswapPricefeedConfig = defaultUniswapPricefeedConfig;
    invalidUniswapPricefeedConfig.uniswapAddress = "0x0000000000000000000000000000000000000000";

    // We will also create a new spy logger, listening for debug events to validate the re-tries.
    spyLogger = winston.createLogger({
      level: "debug",
      transports: [new SpyTransport({ level: "debug" }, { spy: spy })]
    });

    executionRetries = 3; // set execution retries to 3 to validate.
    await Poll.run(
      spyLogger,
      emp.address,
      pollingDelay,
      executionRetries,
      errorRetriesTimeout,
      fromBlock,
      toBlock,
      defaultMonitorConfig,
      defaultUniswapPricefeedConfig,
      invalidUniswapPricefeedConfig
    );

    // Iterate over all log events and count the number of empStateUpdates, liquidator check for liquidation events
    // execution loop errors and finally liquidator polling errors.
    let reTryCounts = {
      empStateUpdates: 0,
      executionLoopErrors: 0,
      liquidatorPollingErrors: 0
    };
    for (let i = 0; i < spy.callCount; i++) {
      if (spyLogIncludes(spy, i, "Expiring multi party event state updated")) reTryCounts.empStateUpdates += 1;
      if (spyLogIncludes(spy, i, "Checking for liquidatable positions")) reTryCounts.checkingForLiquidatable += 1;
      if (spyLogIncludes(spy, i, "An error was thrown in the execution loop")) reTryCounts.executionLoopErrors += 1;
      if (spyLogIncludes(spy, i, "Monitor polling error")) reTryCounts.liquidatorPollingErrors += 1;
    }

    assert.equal(reTryCounts.empStateUpdates, 4); // Initial loop and each 3 retries should update the EMP state. Expect 4 logs.
    assert.equal(reTryCounts.executionLoopErrors, 3); // Each re-try create a log. These only occur on re-try and so expect 3 logs.
    assert.equal(reTryCounts.liquidatorPollingErrors, 1); // The final error should occur once when re-tries are all spent. Expect 1 log.
  });
});

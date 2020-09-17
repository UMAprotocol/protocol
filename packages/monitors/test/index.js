const { toWei, utf8ToHex } = web3.utils;

// Script to test
const Poll = require("../index.js");

// Contracts and helpers
const PricelessPositionManager = artifacts.require("PricelessPositionManager");
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const Finder = artifacts.require("Finder");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const TokenFactory = artifacts.require("TokenFactory");
const Token = artifacts.require("ExpandedERC20");
const Timer = artifacts.require("Timer");
const UniswapMock = artifacts.require("UniswapMock");
const Store = artifacts.require("Store");

// Custom winston transport module to monitor winston log outputs
const winston = require("winston");
const sinon = require("sinon");
const { SpyTransport, spyLogLevel, spyLogIncludes } = require("@uma/financial-templates-lib");

contract("index.js", function(accounts) {
  const contractCreator = accounts[0];

  let collateralToken;
  let syntheticToken;
  let emp;
  let uniswap;
  let constructorParams;

  let defaultUniswapPricefeedConfig;
  let defaultMedianizerPricefeedConfig;
  let defaultMonitorConfig;

  let spy;
  let spyLogger;
  let pollingDelay = 0; // 0 polling delay creates a serverless bot that yields after one full execution.
  let fromBlock = 0; // setting the from block to 0 will query all historic logs events.
  let toBlock = null; // setting the to block to 0 will query up to the latest block Number.
  let executionRetries = 0; // setting execution re-tried to 0 will exit as soon as the process encounters an error.
  let errorRetriesTimeout = 0.1; // 100 milliseconds between preforming retries.

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
    const store = await Store.deployed();

    constructorParams = {
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
      timerAddress: Timer.address,
      excessTokenBeneficiary: store.address
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
    await Poll.run({
      logger: spyLogger,
      web3,
      empAddress: emp.address,
      pollingDelay,
      executionRetries,
      errorRetriesTimeout,
      startingBlock: fromBlock,
      endingBlock: toBlock,
      monitorConfig: defaultMonitorConfig,
      tokenPriceFeedConfig: defaultUniswapPricefeedConfig,
      medianizerPriceFeedConfig: defaultMedianizerPricefeedConfig
    });

    for (let i = 0; i < spy.callCount; i++) {
      assert.notEqual(spyLogLevel(spy, i), "error");
    }
  });

  it("Correctly re-tries after failed execution loop", async function() {
    // To validate re-try logic this test needs to get the monitor bot to throw within the main while loop. This is
    // not straightforward as the bot is designed to reject invalid configs before getting to the while loop. Once in the
    // while loop it should never throw errors as it gracefully falls over with situations like timed out API calls.
    // One way to induce an error is to give the bot an EMP contract that can get through the initial checks but fails
    // when running any specific calls on the contracts. To do this we can create an EMP that is only the PricelessPositionManager
    // and excludes any liquidation logic. As a result, calling `getLiquidations` in the EMP contract will error out.

    // Need to give an unknown identifier to get past the `createReferencePriceFeedForEmp` & `createUniswapPriceFeedForEmp`
    await identifierWhitelist.addSupportedIdentifier(utf8ToHex("UNKNOWN"));

    const invalidEMP = await PricelessPositionManager.new(
      constructorParams.expirationTimestamp,
      constructorParams.withdrawalLiveness,
      constructorParams.collateralAddress,
      constructorParams.finderAddress,
      utf8ToHex("UNKNOWN"),
      constructorParams.syntheticName,
      "UNKNOWN",
      constructorParams.tokenFactoryAddress,
      constructorParams.minSponsorTokens,
      constructorParams.timerAddress,
      contractCreator
    );

    // Create a spy logger to catch all log messages to validate re-try attempts.
    spyLogger = winston.createLogger({
      level: "debug",
      transports: [new SpyTransport({ level: "debug" }, { spy: spy })]
    });

    executionRetries = 3; // set execution retries to 3 to validate.
    // Not both the uniswap and medanizer price feeds are the same config. This is done so that createReferencePriceFeedForEmp
    // can pass without trying to poll any information on the invalidEMP to ensure that the bot gets into the main while
    // loop without throwing an error in inital set-up. If this left as defaultMedianizerPricefeedConfig (which is blank)
    // The bot will error out in setting up the price feed as the invalidEMP instance cant be queried for `liquidationLiveness`
    // which is required when initalizing the price feed.

    let errorThrown = false;
    try {
      await Poll.run({
        logger: spyLogger,
        web3,
        empAddress: invalidEMP.address,
        pollingDelay,
        errorRetries: executionRetries,
        errorRetriesTimeout,
        startingBlock: fromBlock,
        endingBlock: toBlock,
        monitorConfig: defaultMonitorConfig,
        tokenPriceFeedConfig: defaultUniswapPricefeedConfig,
        medianizerPriceFeedConfig: defaultUniswapPricefeedConfig
      });
    } catch (error) {
      errorThrown = true;
    }

    // Iterate over all log events and count the number of tokenBalanceStorage, liquidator check for liquidation events
    // execution loop errors and finally liquidator polling errors.
    let reTryCounts = {
      tokenBalanceStorage: 0,
      executionLoopErrors: 0
    };
    for (let i = 0; i < spy.callCount; i++) {
      if (spyLogIncludes(spy, i, "Token balance storage updated")) reTryCounts.tokenBalanceStorage += 1;
      if (spyLogIncludes(spy, i, "An error was thrown in the execution loop")) reTryCounts.executionLoopErrors += 1;
    }

    assert.equal(reTryCounts.tokenBalanceStorage, 4); // Initial loop and each 3 retries should update the token ballance storage. Expect 4 logs.
    assert.equal(reTryCounts.executionLoopErrors, 3); // Each re-try create a log. These only occur on re-try and so expect 3 logs.
    assert.isTrue(errorThrown); // An error should have been thrown after the 3 execution re-tries.
  });
});

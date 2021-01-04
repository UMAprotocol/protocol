const { toWei, utf8ToHex, padRight } = web3.utils;
const { MAX_UINT_VAL, ZERO_ADDRESS, interfaceName, addGlobalHardhatTestingAddress } = require("@uma/common");

// Script to test
const Poll = require("../index.js");
// Contracts and helpers
const PricelessPositionManager = artifacts.require("PricelessPositionManager");
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const Finder = artifacts.require("Finder");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const Token = artifacts.require("ExpandedERC20");
const SyntheticToken = artifacts.require("SyntheticToken");
const Timer = artifacts.require("Timer");
const UniswapMock = artifacts.require("UniswapMock");
const Store = artifacts.require("Store");
const MockOracle = artifacts.require("MockOracle");

// Custom winston transport module to monitor winston log outputs
const winston = require("winston");
const sinon = require("sinon");
const { SpyTransport, spyLogLevel, spyLogIncludes } = require("@uma/financial-templates-lib");

contract("index.js", function(accounts) {
  const contractCreator = accounts[0];

  let emp;
  let collateralToken;
  let syntheticToken;
  let uniswap;
  let identifierWhitelist;

  let defaultPriceFeedConfig;
  let constructorParams;
  let store;
  let timer;
  let mockOracle;
  let finder;

  let spy;
  let spyLogger;

  let pollingDelay = 0; // 0 polling delay creates a serverless bot that yields after one full execution.
  let errorRetries = 1;
  let errorRetriesTimeout = 0.1; // 100 milliseconds between preforming retries

  before(async function() {
    collateralToken = await Token.new("Wrapped Ether", "WETH", 18, { from: contractCreator });
    finder = await Finder.new();
    timer = await Timer.new();
    // Create identifier whitelist and register the price tracking ticker with it.
    identifierWhitelist = await IdentifierWhitelist.new();
    await identifierWhitelist.addSupportedIdentifier(utf8ToHex("TEST_IDENTIFIER"));
    await finder.changeImplementationAddress(
      web3.utils.utf8ToHex(interfaceName.IdentifierWhitelist),
      identifierWhitelist.address
    );

    mockOracle = await MockOracle.new(finder.address, timer.address, {
      from: contractCreator
    });
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.Oracle), mockOracle.address);
    // Set the address in the global name space to enable disputer's index.js to access it.
    addGlobalHardhatTestingAddress("Voting", mockOracle.address);

    store = await Store.new({ rawValue: "0" }, { rawValue: "0" }, timer.address);
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.Store), store.address);
  });

  beforeEach(async function() {
    // Create a sinon spy and give it to the SpyTransport as the winston logger. Use this to check all winston logs.
    spy = sinon.spy(); // Create a new spy for each test.
    spyLogger = winston.createLogger({
      level: "info",
      transports: [new SpyTransport({ level: "info" }, { spy: spy })]
    });

    // Create a new synthetic token
    syntheticToken = await SyntheticToken.new("Test Synthetic Token", "SYNTH", 18, { from: contractCreator });

    constructorParams = {
      expirationTimestamp: (await timer.getCurrentTime()).toNumber() + 100,
      withdrawalLiveness: "1000",
      collateralAddress: collateralToken.address,
      tokenAddress: syntheticToken.address,
      finderAddress: finder.address,
      priceFeedIdentifier: padRight(utf8ToHex("TEST_IDENTIFIER"), 64),
      liquidationLiveness: "1000",
      collateralRequirement: { rawValue: toWei("1.2") },
      disputeBondPct: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPct: { rawValue: toWei("0.1") },
      disputerDisputeRewardPct: { rawValue: toWei("0.1") },
      minSponsorTokens: { rawValue: toWei("1") },
      timerAddress: timer.address,
      excessTokenBeneficiary: store.address,
      financialProductLibraryAddress: ZERO_ADDRESS
    };

    // Deploy a new expiring multi party
    emp = await ExpiringMultiParty.new(constructorParams);
    await syntheticToken.addMinter(emp.address);
    await syntheticToken.addBurner(emp.address);

    uniswap = await UniswapMock.new();

    defaultPriceFeedConfig = {
      type: "uniswap",
      uniswapAddress: uniswap.address,
      twapLength: 1,
      lookback: 1,
      getTimeOverride: { useBlockTime: true } // enable tests to run in hardhat
    };

    // Set two uniswap prices to give it a little history.
    await uniswap.setPrice(toWei("1"), toWei("1"));
    await uniswap.setPrice(toWei("1"), toWei("1"));
  });

  it("Detects price feed decimals from collateral decimals", async function() {
    spy = sinon.spy(); // Create a new spy for each test.
    spyLogger = winston.createLogger({
      level: "info",
      transports: [new SpyTransport({ level: "info" }, { spy: spy })]
    });

    collateralToken = await Token.new("DAI8", "DAI8", 8, { from: contractCreator });
    constructorParams = {
      ...constructorParams,
      collateralAddress: collateralToken.address
    };
    emp = await ExpiringMultiParty.new(constructorParams);
    await syntheticToken.addMinter(emp.address);
    await syntheticToken.addBurner(emp.address);

    await Poll.run({
      logger: spyLogger,
      web3,
      empAddress: emp.address,
      pollingDelay,
      errorRetries,
      errorRetriesTimeout,
      priceFeedConfig: defaultPriceFeedConfig
    });

    // First log should include # of decimals
    assert.isTrue(spyLogIncludes(spy, 0, "8"));
  });

  it("Allowances are set", async function() {
    await Poll.run({
      logger: spyLogger,
      web3,
      empAddress: emp.address,
      pollingDelay,
      errorRetries,
      errorRetriesTimeout,
      priceFeedConfig: defaultPriceFeedConfig
    });

    const collateralAllowance = await collateralToken.allowance(contractCreator, emp.address);
    assert.equal(collateralAllowance.toString(), MAX_UINT_VAL);
  });

  it("Completes one iteration without logging any errors", async function() {
    await Poll.run({
      logger: spyLogger,
      web3,
      empAddress: emp.address,
      pollingDelay,
      errorRetries,
      errorRetriesTimeout,
      priceFeedConfig: defaultPriceFeedConfig
    });

    for (let i = 0; i < spy.callCount; i++) {
      assert.notEqual(spyLogLevel(spy, i), "error");
    }
  });
  it("Correctly re-tries after failed execution loop", async function() {
    // To validate re-try logic this test needs to get the dispute bot to throw within the main while loop. This is
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
      constructorParams.tokenAddress,
      constructorParams.finderAddress,
      utf8ToHex("UNKNOWN"),
      constructorParams.minSponsorTokens,
      constructorParams.timerAddress,
      contractCreator,
      ZERO_ADDRESS
    );

    // We will also create a new spy logger, listening for debug events to validate the re-tries.
    spyLogger = winston.createLogger({
      level: "debug",
      transports: [new SpyTransport({ level: "debug" }, { spy: spy })]
    });

    errorRetries = 3; // set execution retries to 3 to validate.
    let errorThrown = false;
    try {
      await Poll.run({
        logger: spyLogger,
        web3,
        empAddress: invalidEMP.address,
        pollingDelay,
        errorRetries,
        errorRetriesTimeout,
        priceFeedConfig: defaultPriceFeedConfig
      });
    } catch (error) {
      errorThrown = true;
    }

    // Iterate over all log events and count the number of gasEstimatorUpdate, disputer check for liquidation events
    // execution loop errors and finally disputer polling errors.
    let reTryCounts = {
      gasEstimatorUpdate: 0,
      executionLoopErrors: 0
    };
    for (let i = 0; i < spy.callCount; i++) {
      if (spyLogIncludes(spy, i, "Gas estimator update skipped")) reTryCounts.gasEstimatorUpdate += 1;
      if (spyLogIncludes(spy, i, "An error was thrown in the execution loop")) reTryCounts.executionLoopErrors += 1;
    }

    assert.equal(reTryCounts.gasEstimatorUpdate, 4); // Initial loop and each 3 re-try should update the gas estimator state. Expect 4 logs.
    assert.equal(reTryCounts.executionLoopErrors, 3); // Each re-try create a log. These only occur on re-try and so expect 3 logs.
    assert.isTrue(errorThrown); // An error should have been thrown after the 3 execution re-tries.
  });
});

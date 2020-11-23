const { toWei, utf8ToHex } = web3.utils;
const { MAX_UINT_VAL, ZERO_ADDRESS, LiquidationStatesEnum, interfaceName } = require("@uma/common");

// Script to test
const Poll = require("../index.js");
// Contracts and helpers
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const Finder = artifacts.require("Finder");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const SyntheticToken = artifacts.require("SyntheticToken");
const Token = artifacts.require("ExpandedERC20");
const Timer = artifacts.require("Timer");
const UniswapMock = artifacts.require("UniswapMock");
const Store = artifacts.require("Store");
const MockOracle = artifacts.require("MockOracle");

// Custom winston transport module to monitor winston log outputs
const winston = require("winston");
const sinon = require("sinon");
const { SpyTransport, spyLogLevel, spyLogIncludes, ExpiringMultiPartyClient } = require("@uma/financial-templates-lib");

contract("index.js", function(accounts) {
  const contractCreator = accounts[0];
  const sponsorUndercollateralized = accounts[1];
  const sponsorOvercollateralized = accounts[2];
  const liquidator = contractCreator;
  const disputer = accounts[4];

  let collateralToken;
  let syntheticToken;
  let emp;
  let uniswap;
  let store;
  let timer;
  let mockOracle;
  let finder;

  let defaultPriceFeedConfig;

  let constructorParams;

  let spy;
  let spyLogger;

  let pollingDelay = 0; // 0 polling delay creates a serverless bot that yields after one full execution.
  let errorRetries = 1;
  let errorRetriesTimeout = 0.1; // 100 milliseconds between preforming retries

  before(async function() {
    collateralToken = await Token.new("Wrapped Ether", "WETH", 18, { from: contractCreator });

    // Create identifier whitelist and register the price tracking ticker with it.
    const identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.addSupportedIdentifier(utf8ToHex("TEST_IDENTIFIER"));

    store = await Store.deployed();
    timer = await Timer.deployed();
    finder = await Finder.deployed();
    mockOracle = await MockOracle.new(finder.address, timer.address, {
      from: contractCreator
    });
    const mockOracleInterfaceName = utf8ToHex(interfaceName.Oracle);
    await finder.changeImplementationAddress(mockOracleInterfaceName, mockOracle.address);
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

    // Deploy a new expiring multi party
    constructorParams = {
      expirationTimestamp: (await timer.getCurrentTime()).toNumber() + 100,
      withdrawalLiveness: "1000",
      collateralAddress: collateralToken.address,
      tokenAddress: syntheticToken.address,
      finderAddress: finder.address,
      priceFeedIdentifier: utf8ToHex("TEST_IDENTIFIER"),
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
    emp = await ExpiringMultiParty.new(constructorParams);
    await syntheticToken.addMinter(emp.address);
    await syntheticToken.addBurner(emp.address);

    syntheticToken = await Token.at(await emp.tokenCurrency());

    uniswap = await UniswapMock.new();

    defaultPriceFeedConfig = {
      type: "uniswap",
      uniswapAddress: uniswap.address,
      twapLength: 1,
      lookback: 1
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

  it("EMP is expired, liquidator exits early without throwing", async function() {
    spy = sinon.spy(); // Create a new spy for each test.
    spyLogger = winston.createLogger({
      level: "info",
      transports: [new SpyTransport({ level: "info" }, { spy: spy })]
    });

    await emp.setCurrentTime(await emp.expirationTimestamp());

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

    // There should be 2 logs that communicates that contract has expired,
    // and no logs about approvals.
    assert.equal(spy.getCalls().length, 2);
    assert.isTrue(spyLogIncludes(spy, 0, "expired"));
    assert.isTrue(spyLogIncludes(spy, 1, "expired"));
  });

  it("Post EMP expiry, liquidator can withdraw rewards but will not attempt to liquidate any undercollateralized positions", async function() {
    spy = sinon.spy(); // Create a new spy for each test.
    spyLogger = winston.createLogger({
      level: "info",
      transports: [new SpyTransport({ level: "info" }, { spy: spy })]
    });

    // Create 2 positions, 1 undercollateralized and 1 sufficiently collateralized.
    // Liquidate the sufficiently collateralized one, and dispute the liquidation.
    // We'll assume that the dispute will resolve to a price of 1, so there must be 1.2 units of collateral for every 1 unit of synthetic.
    await collateralToken.addMember(1, contractCreator, {
      from: contractCreator
    });
    await collateralToken.mint(sponsorUndercollateralized, toWei("110"), { from: contractCreator });
    await collateralToken.mint(sponsorOvercollateralized, toWei("130"), { from: contractCreator });
    await collateralToken.approve(emp.address, toWei("110"), { from: sponsorUndercollateralized });
    await collateralToken.approve(emp.address, toWei("130"), { from: sponsorOvercollateralized });
    await emp.create({ rawValue: toWei("110") }, { rawValue: toWei("100") }, { from: sponsorUndercollateralized });
    await emp.create({ rawValue: toWei("130") }, { rawValue: toWei("100") }, { from: sponsorOvercollateralized });

    // Send liquidator enough synthetic to liquidate one position.
    await syntheticToken.transfer(liquidator, toWei("100"), { from: sponsorOvercollateralized });
    await syntheticToken.approve(emp.address, toWei("100"), { from: liquidator });

    // Check that the liquidator is correctly detecting the undercollateralized position
    const empClientSpy = sinon.spy();
    const empClientSpyLogger = winston.createLogger({
      level: "info",
      transports: [new SpyTransport({ level: "info" }, { spy: empClientSpy })]
    });
    const empClient = new ExpiringMultiPartyClient(empClientSpyLogger, ExpiringMultiParty.abi, web3, emp.address);
    await empClient.update();
    assert.deepStrictEqual(
      [
        {
          sponsor: sponsorUndercollateralized,
          numTokens: toWei("100"),
          amountCollateral: toWei("110"),
          hasPendingWithdrawal: false,
          withdrawalRequestPassTimestamp: "0",
          withdrawalRequestAmount: "0"
        }
      ],
      empClient.getUnderCollateralizedPositions(toWei("1"))
    );

    // Liquidate the over collateralized position and dispute the liquidation.
    const liquidationTime = await emp.getCurrentTime();
    await emp.createLiquidation(
      sponsorOvercollateralized,
      { rawValue: toWei("1.3") },
      { rawValue: toWei("1.3") },
      { rawValue: toWei("100") },
      MAX_UINT_VAL,
      { from: liquidator }
    );

    // Next, expire the contract.
    await emp.setCurrentTime(await emp.expirationTimestamp());

    // Dispute & push a dispute resolution price.
    await collateralToken.mint(disputer, toWei("13"), { from: contractCreator });
    await collateralToken.approve(emp.address, toWei("13"), { from: disputer });
    await emp.dispute(0, sponsorOvercollateralized, { from: disputer });
    await mockOracle.pushPrice(utf8ToHex("TEST_IDENTIFIER"), liquidationTime, toWei("1"));

    // Running the liquidator now should settle and withdraw rewards from the successful dispute,
    // and ignore undercollateralized positions.
    await Poll.run({
      logger: spyLogger,
      web3,
      empAddress: emp.address,
      pollingDelay,
      errorRetries,
      errorRetriesTimeout,
      priceFeedConfig: defaultPriceFeedConfig
    });

    // EMP client should still detect an undercollateralized position and one disputed liquidation with some unwithdrawn rewards.
    await empClient.update();
    assert.deepStrictEqual(
      [
        {
          sponsor: sponsorUndercollateralized,
          numTokens: toWei("100"),
          amountCollateral: toWei("110"),
          hasPendingWithdrawal: false,
          withdrawalRequestPassTimestamp: "0",
          withdrawalRequestAmount: "0"
        }
      ],
      empClient.getUnderCollateralizedPositions(toWei("1"))
    );
    assert.deepStrictEqual(
      [
        {
          sponsor: sponsorOvercollateralized,
          id: "0",
          state: LiquidationStatesEnum.DISPUTE_SUCCEEDED,
          numTokens: toWei("100"),
          liquidatedCollateral: toWei("130"),
          lockedCollateral: toWei("130"),
          liquidationTime: liquidationTime.toString(),
          liquidator: ZERO_ADDRESS,
          disputer
        }
      ],
      empClient.getDisputedLiquidations()
    );

    // 3 logs should be shown. First two are about the contract expiry, third one is for the withdrawn dispute rewards.
    assert.equal(spy.getCalls().length, 3);
    assert.isTrue(spyLogIncludes(spy, 0, "expired"));
    assert.isTrue(spyLogIncludes(spy, 1, "expired"));
    assert.isTrue(spyLogIncludes(spy, 2, "Liquidation withdrawn"));
    assert.equal(spy.getCall(-1).lastArg.amount, toWei("80")); // Amount withdrawn by liquidator minus dispute rewards.
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
    const syntheticAllowance = await syntheticToken.allowance(contractCreator, emp.address);
    assert.equal(syntheticAllowance.toString(), MAX_UINT_VAL);
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
    // To create an error within the liquidator bot we can create a price feed that we know will throw an error.
    // Specifically, creating a uniswap feed with no `sync` events will generate an error. We can then check
    // the execution loop re-tries an appropriate number of times and that the associated logs are generated.
    uniswap = await UniswapMock.new();

    // We will also create a new spy logger, listening for debug events to validate the re-tries.
    spyLogger = winston.createLogger({
      level: "debug",
      transports: [new SpyTransport({ level: "debug" }, { spy: spy })]
    });

    defaultPriceFeedConfig = {
      type: "uniswap",
      uniswapAddress: uniswap.address,
      twapLength: 1,
      lookback: 1
    };

    errorRetries = 3; // set execution retries to 3 to validate.
    let errorThrown = false;
    try {
      await Poll.run({
        logger: spyLogger,
        web3,
        empAddress: emp.address,
        pollingDelay,
        errorRetries,
        errorRetriesTimeout,
        priceFeedConfig: defaultPriceFeedConfig
      });
    } catch (error) {
      errorThrown = true;
    }

    // Iterate over all log events and count the number of empStateUpdates, liquidator check for liquidation events
    // execution loop errors and finally liquidator polling errors.
    let reTryCounts = {
      empStateUpdates: 0,
      checkingForLiquidatable: 0,
      executionLoopErrors: 0
    };
    for (let i = 0; i < spy.callCount; i++) {
      if (spyLogIncludes(spy, i, "Expiring multi party state updated")) reTryCounts.empStateUpdates += 1;
      if (spyLogIncludes(spy, i, "Checking for liquidatable positions")) reTryCounts.checkingForLiquidatable += 1;
      if (spyLogIncludes(spy, i, "An error was thrown in the execution loop")) reTryCounts.executionLoopErrors += 1;
    }

    assert.equal(reTryCounts.empStateUpdates, 4); // Initial loop and each 3 re-try should update the EMP state. Expect 4 logs.
    assert.equal(reTryCounts.checkingForLiquidatable, 4); // Initial loop and 3 re-try should check for liquidable positions. Expect 4 logs.
    assert.equal(reTryCounts.executionLoopErrors, 3); // Each re-try create a log. These only occur on re-try and so expect 3 logs.
    assert.isTrue(errorThrown); // An error should have been thrown after the 3 execution re-tries.
  });
  it("starts with wdf params and runs without errors", async function() {
    const liquidatorConfig = {
      whaleDefenseFundWei: "1000000",
      defenseActivationPercent: 50
    };
    await Poll.run({
      logger: spyLogger,
      web3,
      empAddress: emp.address,
      pollingDelay,
      errorRetries,
      errorRetriesTimeout,
      priceFeedConfig: defaultPriceFeedConfig,
      liquidatorConfig
    });
    for (let i = 0; i < spy.callCount; i++) {
      assert.notEqual(spyLogLevel(spy, i), "error");
    }
  });
});

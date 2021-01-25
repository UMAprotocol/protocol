const { toWei, utf8ToHex, padRight } = web3.utils;
const { MAX_UINT_VAL, ZERO_ADDRESS, interfaceName, addGlobalHardhatTestingAddress } = require("@uma/common");

const { getTruffleContract } = require("@uma/core");

// Script to test
const Poll = require("../index.js");

const SUPPORTED_CONTRACT_VERSIONS = ["ExpiringMultiParty-1.2.2", "ExpiringMultiParty-latest", "Perpetual-latest"];

let collateralToken;
let syntheticToken;
let emp;
let uniswap;
let store;
let timer;
let mockOracle;
let finder;
let identifierWhitelist;
let configStore;
let collateralWhitelist;
let optimisticOracle;

let defaultPriceFeedConfig;

let constructorParams;

let spy;
let spyLogger;

let pollingDelay = 0; // 0 polling delay creates a serverless bot that yields after one full execution.
let errorRetries = 1;
let errorRetriesTimeout = 0.1; // 100 milliseconds between preforming retries
let identifier = "TEST_IDENTIFIER";
let fundingRateIdentifier = "TEST_FUNDING_IDENTIFIER";

const _createConstructorParamsForContractVersion = async function(contractVersion, contractType) {
  let constructorParams = {
    expirationTimestamp: (await timer.getCurrentTime()).toNumber() + 100,
    withdrawalLiveness: "1000",
    collateralAddress: collateralToken.address,
    tokenAddress: syntheticToken.address,
    finderAddress: finder.address,
    priceFeedIdentifier: padRight(utf8ToHex(identifier), 64),
    liquidationLiveness: "1000",
    collateralRequirement: { rawValue: toWei("1.2") },
    disputeBondPercentage: { rawValue: toWei("0.1") },
    sponsorDisputeRewardPercentage: { rawValue: toWei("0.1") },
    disputerDisputeRewardPercentage: { rawValue: toWei("0.1") },
    minSponsorTokens: { rawValue: toWei("5") },
    timerAddress: timer.address,
    excessTokenBeneficiary: store.address,
    financialProductLibraryAddress: ZERO_ADDRESS
  };

  if (contractVersion == "1.2.2") {
    constructorParams.disputerDisputeRewardPct = constructorParams.disputerDisputeRewardPercentage;
    constructorParams.sponsorDisputeRewardPct = constructorParams.sponsorDisputeRewardPercentage;
    constructorParams.disputeBondPct = constructorParams.disputeBondPercentage;
  }

  if (contractType == "Perpetual") {
    configStore = await getTruffleContract("ConfigStore", web3, contractVersion).new(
      {
        timelockLiveness: 86400, // 1 day
        rewardRatePerSecond: { rawValue: "0" },
        proposerBondPercentage: { rawValue: "0" },
        maxFundingRate: { rawValue: toWei("0.00001") },
        minFundingRate: { rawValue: toWei("-0.00001") },
        proposalTimePastLimit: 0
      },
      timer.address
    );

    await identifierWhitelist.addSupportedIdentifier(web3.utils.utf8ToHex(fundingRateIdentifier));
    constructorParams.fundingRateIdentifier = web3.utils.utf8ToHex(fundingRateIdentifier);
    constructorParams.configStoreAddress = configStore.address;
    constructorParams.tokenScaling = { rawValue: toWei("1") };

    const defaultLiveness = 7200;

    optimisticOracle = await getTruffleContract("OptimisticOracle", web3, contractVersion).new(
      defaultLiveness,
      finder.address,
      timer.address
    );

    await finder.changeImplementationAddress(
      web3.utils.utf8ToHex(interfaceName.OptimisticOracle),
      optimisticOracle.address
    );
  }

  return constructorParams;
};

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

  SUPPORTED_CONTRACT_VERSIONS.forEach(function(contractVersion) {
    // Store the currentVersionTested, type and version being tested
    const currentTypeTested = contractVersion.substring(0, contractVersion.indexOf("-"));
    const currentVersionTested = contractVersion.substring(contractVersion.indexOf("-") + 1, contractVersion.length);

    // Import the tested versions of contracts. note that financialContractInstance is either an emp or the perp depending
    // on the current iteration version.
    const financialContractInstance = getTruffleContract(currentTypeTested, web3, currentVersionTested);
    const Finder = getTruffleContract("Finder", web3, currentVersionTested);
    const IdentifierWhitelist = getTruffleContract("IdentifierWhitelist", web3, currentVersionTested);
    const AddressWhitelist = getTruffleContract("AddressWhitelist", web3, currentVersionTested);
    const MockOracle = getTruffleContract("MockOracle", web3, currentVersionTested);
    const Token = getTruffleContract("ExpandedERC20", web3, currentVersionTested);
    const SyntheticToken = getTruffleContract("SyntheticToken", web3, currentVersionTested);
    const Timer = getTruffleContract("Timer", web3, currentVersionTested);
    const UniswapMock = getTruffleContract("UniswapMock", web3, currentVersionTested);
    const Store = getTruffleContract("Store", web3, currentVersionTested);
    describe(`Smart contract version ${contractVersion}`, function() {
      before(async function() {
        finder = await Finder.new();
        // Create identifier whitelist and register the price tracking ticker with it.
        identifierWhitelist = await IdentifierWhitelist.new();
        await identifierWhitelist.addSupportedIdentifier(utf8ToHex(identifier));
        await finder.changeImplementationAddress(
          web3.utils.utf8ToHex(interfaceName.IdentifierWhitelist),
          identifierWhitelist.address
        );

        timer = await Timer.new();

        mockOracle = await MockOracle.new(finder.address, timer.address, {
          from: contractCreator
        });
        await finder.changeImplementationAddress(utf8ToHex(interfaceName.Oracle), mockOracle.address);
        // Set the address in the global name space to enable disputer's index.js to access it.
        addGlobalHardhatTestingAddress("Voting", mockOracle.address);

        store = await Store.new({ rawValue: "0" }, { rawValue: "0" }, timer.address);
        await finder.changeImplementationAddress(utf8ToHex(interfaceName.Store), store.address);

        // Make the contract creator the admin to enable emergencyshutdown in tests.
        await finder.changeImplementationAddress(utf8ToHex(interfaceName.FinancialContractsAdmin), contractCreator);
      });

      beforeEach(async function() {
        // Create a sinon spy and give it to the SpyTransport as the winston logger. Use this to check all winston logs.
        spy = sinon.spy(); // Create a new spy for each test.
        spyLogger = winston.createLogger({
          level: "info",
          transports: [new SpyTransport({ level: "info" }, { spy: spy })]
        });

        // Create a new synthetic token & collateral token.
        syntheticToken = await SyntheticToken.new("Test Synthetic Token", "SYNTH", 18, { from: contractCreator });
        collateralToken = await Token.new("Wrapped Ether", "WETH", 18, { from: contractCreator });

        collateralWhitelist = await AddressWhitelist.new();
        await finder.changeImplementationAddress(
          web3.utils.utf8ToHex(interfaceName.CollateralWhitelist),
          collateralWhitelist.address
        );
        await collateralWhitelist.addToWhitelist(collateralToken.address);

        // Deploy a new expiring multi party OR perpetual.
        constructorParams = await _createConstructorParamsForContractVersion(currentVersionTested, currentTypeTested);
        emp = await financialContractInstance.new(constructorParams);
        await syntheticToken.addMinter(emp.address);
        await syntheticToken.addBurner(emp.address);

        syntheticToken = await Token.at(await emp.tokenCurrency());

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

      it("Detects price feed, collateral and synthetic decimals", async function() {
        spy = sinon.spy();
        spyLogger = winston.createLogger({
          level: "debug",
          transports: [new SpyTransport({ level: "debug" }, { spy: spy })]
        });

        collateralToken = await Token.new("BTC", "BTC", 8, {
          from: contractCreator
        });
        syntheticToken = await SyntheticToken.new("Test Synthetic Token", "SYNTH", 18, { from: contractCreator });
        // For this test we are using a lower decimal identifier, USDBTC. First we need to add it to the whitelist.
        await identifierWhitelist.addSupportedIdentifier(padRight(utf8ToHex("USDBTC"), 64));
        const decimalTestConstructorParams = JSON.parse(
          JSON.stringify({
            ...constructorParams,
            collateralAddress: collateralToken.address,
            tokenAddress: syntheticToken.address,
            priceFeedIdentifier: padRight(utf8ToHex("USDBTC"), 64)
          })
        );
        emp = await financialContractInstance.new(decimalTestConstructorParams);
        await syntheticToken.addMinter(emp.address);
        await syntheticToken.addBurner(emp.address);

        // Note the execution below does not have a price feed included. It should be pulled from the default USDBTC config.
        await Poll.run({
          logger: spyLogger,
          web3,
          empAddress: emp.address,
          pollingDelay,
          errorRetries,
          errorRetriesTimeout
        });

        // Sixth log, which prints the decimal info, should include # of decimals for the price feed, collateral and synthetic.
        // The "6th" log is pretty arbitrary. This is simply the log message that is produced at the end of initialization
        // under `Liquidator initialized`. It does however contain the decimal info, which is what we really care about.
        assert.isTrue(spyLogIncludes(spy, 6, '"collateralDecimals":8'));
        assert.isTrue(spyLogIncludes(spy, 6, '"syntheticDecimals":18'));
        assert.isTrue(spyLogIncludes(spy, 6, '"priceFeedDecimals":8'));
      });

      it("EMP is expired or emergency shutdown, liquidator exits early without throwing", async function() {
        spy = sinon.spy(); // Create a new spy for each test.
        spyLogger = winston.createLogger({
          level: "info",
          transports: [new SpyTransport({ level: "info" }, { spy: spy })]
        });

        if (currentTypeTested == "ExpiringMultiParty") await emp.setCurrentTime(await emp.expirationTimestamp());
        if (currentTypeTested == "Perpetual") await emp.emergencyShutdown();

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

        // There should be 2 logs that communicates that contract has expired, and no logs about approvals.
        assert.equal(spy.getCalls().length, 3);
        if (currentTypeTested == "ExpiringMultiParty")
          assert.isTrue(spyLogIncludes(spy, -1, "EMP is expired, can only withdraw liquidator dispute rewards"));
        if (currentTypeTested == "Perpetual")
          assert.isTrue(spyLogIncludes(spy, -1, "EMP is shutdown, can only withdraw liquidator dispute rewards"));
      });

      it("Post EMP expiry or emergency shutdown, liquidator can withdraw rewards but will not attempt to liquidate any undercollateralized positions", async function() {
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
        const empClient = new ExpiringMultiPartyClient(
          empClientSpyLogger,
          financialContractInstance.abi,
          web3,
          emp.address
        );
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

        // Next, expire or emergencyshutdown the contract.
        if (currentTypeTested == "ExpiringMultiParty") await emp.setCurrentTime(await emp.expirationTimestamp());
        if (currentTypeTested == "Perpetual") await emp.emergencyShutdown();

        // Dispute & push a dispute resolution price.
        await collateralToken.mint(disputer, toWei("13"), {
          from: contractCreator
        });
        await collateralToken.approve(emp.address, toWei("13"), { from: disputer });
        await emp.dispute(0, sponsorOvercollateralized, {
          from: disputer
        });
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

        // 4 logs should be shown. First two are about approval, one about contract expiry and the 4th is for the
        // withdrawn dispute rewards.
        assert.equal(spy.getCalls().length, 4);
        if (currentTypeTested == "ExpiringMultiParty") assert.isTrue(spyLogIncludes(spy, 2, "expired"));
        if (currentTypeTested == "Perpetual") assert.isTrue(spyLogIncludes(spy, 2, "shutdown"));
        assert.isTrue(spyLogIncludes(spy, -1, "Liquidation withdrawn"));
        assert.equal(spy.getCall(-1).lastArg.amountWithdrawn, toWei("80")); // Amount withdrawn by liquidator minus dispute rewards.
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
        spy = sinon.spy();
        spyLogger = winston.createLogger({
          level: "debug",
          transports: [new SpyTransport({ level: "debug" }, { spy: spy })]
        });

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

        // To verify decimal detection is correct for a standard feed, check the third log to see it matches expected.
        assert.isTrue(spyLogIncludes(spy, 3, '"collateralDecimals":18'));
        assert.isTrue(spyLogIncludes(spy, 3, '"syntheticDecimals":18'));
        assert.isTrue(spyLogIncludes(spy, 3, '"priceFeedDecimals":18'));
      });
      it("Correctly detects contract type and rejects unknown contract types", async function() {
        spy = sinon.spy();
        spyLogger = winston.createLogger({
          level: "debug",
          transports: [new SpyTransport({ level: "debug" }, { spy: spy })]
        });

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

        // To verify decimal detection is correct for a standard feed, check the third log to see it matches expected.
        assert.isTrue(spyLogIncludes(spy, 3, `"contractVersion":"${currentVersionTested}"`));
        assert.isTrue(spyLogIncludes(spy, 3, `"contractType":"${currentTypeTested}"`));

        // Should produce an error on a contract type that is unknown. set the emp as the finder, for example

        let didThrowError = false;
        try {
          await Poll.run({
            logger: spyLogger,
            web3,
            empAddress: finder.address,
            pollingDelay,
            errorRetries,
            errorRetriesTimeout,
            priceFeedConfig: defaultPriceFeedConfig
          });
        } catch (error) {
          didThrowError = true;
        }

        assert.isTrue(didThrowError);
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
          lookback: 1,
          getTimeOverride: { useBlockTime: true } // enable tests to run in hardhat
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
      it("Liquidator config packed correctly", async function() {
        // We will also create a new spy logger, listening for debug events to validate the liquidatorConfig.
        spyLogger = winston.createLogger({
          level: "debug",
          transports: [new SpyTransport({ level: "debug" }, { spy: spy })]
        });

        // We test that startingBlock and endingBlock params get packed into
        // the liquidatorConfig correctly by the Liquidator bot.
        const liquidatorConfig = {
          whaleDefenseFundWei: "1000000",
          defenseActivationPercent: 50
        };
        const startingBlock = 9;
        const endingBlock = 10;
        await Poll.run({
          logger: spyLogger,
          web3,
          empAddress: emp.address,
          pollingDelay,
          errorRetries,
          errorRetriesTimeout,
          priceFeedConfig: defaultPriceFeedConfig,
          liquidatorConfig,
          startingBlock,
          endingBlock
        });

        // First log should list the liquidatorConfig with the expected starting and ending block.
        assert.equal(spy.getCall(0).lastArg.liquidatorConfig.startingBlock, startingBlock);
        assert.equal(spy.getCall(0).lastArg.liquidatorConfig.endingBlock, endingBlock);
      });
    });
  });
});

const { toWei, utf8ToHex, padRight } = web3.utils;
const {
  MAX_UINT_VAL,
  interfaceName,
  addGlobalHardhatTestingAddress,
  createConstructorParamsForContractVersion,
  TESTED_CONTRACT_VERSIONS
} = require("@uma/common");

const { getTruffleContract } = require("@uma/core");

// Custom winston transport module to monitor winston log outputs
const winston = require("winston");
const sinon = require("sinon");
const { SpyTransport, spyLogLevel, spyLogIncludes, FinancialContractClient } = require("@uma/financial-templates-lib");

// Script to test
const Poll = require("../index.js");

let collateralToken;
let syntheticToken;
let financialContract;
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
let fundingRateIdentifier = "TEST_FUNDiNG_IDENTIFIER";

contract("index.js", function(accounts) {
  const contractCreator = accounts[0];
  const sponsorUndercollateralized = accounts[1];
  const sponsorOvercollateralized = accounts[2];
  const liquidator = contractCreator;
  const disputer = accounts[4];

  TESTED_CONTRACT_VERSIONS.forEach(function(contractVersion) {
    // Import the tested versions of contracts. Note that financialContract is either an ExpiringMultiParty or the perp
    // depending on the current iteration version.
    const FinancialContract = getTruffleContract(contractVersion.contractType, web3, contractVersion.contractVersion);
    const Finder = getTruffleContract("Finder", web3, contractVersion.contractVersion);
    const IdentifierWhitelist = getTruffleContract("IdentifierWhitelist", web3, contractVersion.contractVersion);
    const AddressWhitelist = getTruffleContract("AddressWhitelist", web3, contractVersion.contractVersion);
    const MockOracle = getTruffleContract("MockOracle", web3, contractVersion.contractVersion);
    const Token = getTruffleContract("ExpandedERC20", web3, contractVersion.contractVersion);
    const SyntheticToken = getTruffleContract("SyntheticToken", web3, contractVersion.contractVersion);
    const Timer = getTruffleContract("Timer", web3, contractVersion.contractVersion);
    const UniswapMock = getTruffleContract("UniswapMock", web3, "latest");
    const Store = getTruffleContract("Store", web3, contractVersion.contractVersion);
    const ConfigStore = getTruffleContract("ConfigStore", web3, contractVersion.contractVersion);
    const OptimisticOracle = getTruffleContract("OptimisticOracle", web3, contractVersion.contractVersion);

    describe(`Tests running on for smart contract version ${contractVersion.contractType} @ ${contractVersion.contractVersion}`, function() {
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

        if (contractVersion.contractType == "Perpetual") {
          configStore = await ConfigStore.new(
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

          await identifierWhitelist.addSupportedIdentifier(padRight(utf8ToHex(fundingRateIdentifier)));
          optimisticOracle = await OptimisticOracle.new(7200, finder.address, timer.address);
          await finder.changeImplementationAddress(utf8ToHex(interfaceName.OptimisticOracle), optimisticOracle.address);
        }
        // Deploy a new expiring multi party OR perpetual.
        constructorParams = await createConstructorParamsForContractVersion(
          contractVersion,
          {
            convertSynthetic: toWei, // These tests do not use convertSynthetic. Override this with toWei
            finder,
            collateralToken,
            syntheticToken,
            identifier,
            fundingRateIdentifier,
            timer,
            store,
            configStore: configStore || {} // if the contract type is not a perp this will be null.
          },
          { expirationTimestamp: (await timer.getCurrentTime()).toNumber() + 100 } // config override expiration time.
        );
        financialContract = await FinancialContract.new(constructorParams);
        await syntheticToken.addMinter(financialContract.address);
        await syntheticToken.addBurner(financialContract.address);

        syntheticToken = await Token.at(await financialContract.tokenCurrency());

        defaultPriceFeedConfig = {
          type: "test",
          currentPrice: "1",
          historicalPrice: "1"
        };
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
        financialContract = await FinancialContract.new(decimalTestConstructorParams);
        await syntheticToken.addMinter(financialContract.address);
        await syntheticToken.addBurner(financialContract.address);

        // Note the execution below does not have a price feed included. It should be pulled from the default USDBTC config.
        await Poll.run({
          logger: spyLogger,
          web3,
          financialContractAddress: financialContract.address,
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

      it("Financial Contract is expired or emergency shutdown, liquidator exits early without throwing", async function() {
        spy = sinon.spy(); // Create a new spy for each test.
        spyLogger = winston.createLogger({
          level: "info",
          transports: [new SpyTransport({ level: "info" }, { spy: spy })]
        });

        if (contractVersion.contractType == "ExpiringMultiParty")
          await financialContract.setCurrentTime(await financialContract.expirationTimestamp());
        if (contractVersion.contractType == "Perpetual") await financialContract.emergencyShutdown();

        await Poll.run({
          logger: spyLogger,
          web3,
          financialContractAddress: financialContract.address,
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
        if (contractVersion.contractType == "ExpiringMultiParty")
          assert.isTrue(
            spyLogIncludes(spy, -1, "Financial Contract is expired, can only withdraw liquidator dispute rewards")
          );
        if (contractVersion.contractType == "Perpetual")
          assert.isTrue(
            spyLogIncludes(spy, -1, "Financial Contract is shutdown, can only withdraw liquidator dispute rewards")
          );
      });

      it("Post Financial Contract expiry or emergency shutdown, liquidator can withdraw rewards but will not attempt to liquidate any undercollateralized positions", async function() {
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
        await collateralToken.approve(financialContract.address, toWei("110"), { from: sponsorUndercollateralized });
        await collateralToken.approve(financialContract.address, toWei("130"), { from: sponsorOvercollateralized });
        await financialContract.create(
          { rawValue: toWei("110") },
          { rawValue: toWei("100") },
          { from: sponsorUndercollateralized }
        );
        await financialContract.create(
          { rawValue: toWei("130") },
          { rawValue: toWei("100") },
          { from: sponsorOvercollateralized }
        );

        // Send liquidator enough synthetic to liquidate one position.
        await syntheticToken.transfer(liquidator, toWei("100"), { from: sponsorOvercollateralized });
        await syntheticToken.approve(financialContract.address, toWei("100"), { from: liquidator });

        // Check that the liquidator is correctly detecting the undercollateralized position
        const empClientSpy = sinon.spy();
        const empClientSpyLogger = winston.createLogger({
          level: "info",
          transports: [new SpyTransport({ level: "info" }, { spy: empClientSpy })]
        });
        const financialContractClient = new FinancialContractClient(
          empClientSpyLogger,
          financialContract.abi,
          web3,
          financialContract.address
        );
        await financialContractClient.update();
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
          financialContractClient.getUnderCollateralizedPositions(toWei("1"))
        );

        // Liquidate the over collateralized position and dispute the liquidation.
        const liquidationTime = await financialContract.getCurrentTime();
        await financialContract.createLiquidation(
          sponsorOvercollateralized,
          { rawValue: toWei("1.3") },
          { rawValue: toWei("1.3") },
          { rawValue: toWei("100") },
          MAX_UINT_VAL,
          { from: liquidator }
        );

        // Next, expire or emergencyshutdown the contract.
        if (contractVersion.contractType == "ExpiringMultiParty")
          await financialContract.setCurrentTime(await financialContract.expirationTimestamp());
        if (contractVersion.contractType == "Perpetual") await financialContract.emergencyShutdown();

        // Dispute & push a dispute resolution price.
        await collateralToken.mint(disputer, toWei("13"), {
          from: contractCreator
        });
        await collateralToken.approve(financialContract.address, toWei("13"), { from: disputer });
        await financialContract.dispute(0, sponsorOvercollateralized, {
          from: disputer
        });
        await mockOracle.pushPrice(utf8ToHex("TEST_IDENTIFIER"), liquidationTime, toWei("1"));

        // Running the liquidator now should settle and withdraw rewards from the successful dispute,
        // and ignore undercollateralized positions.
        await Poll.run({
          logger: spyLogger,
          web3,
          financialContractAddress: financialContract.address,
          pollingDelay,
          errorRetries,
          errorRetriesTimeout,
          priceFeedConfig: defaultPriceFeedConfig
        });

        // Financial Contract client should still detect an undercollateralized position and one disputed liquidation with some unwithdrawn rewards.
        await financialContractClient.update();
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
          financialContractClient.getUnderCollateralizedPositions(toWei("1"))
        );

        // 4 logs should be shown. First two are about approval, one about contract expiry and the 4th is for the
        // withdrawn dispute rewards.
        assert.equal(spy.getCalls().length, 4);
        if (contractVersion.contractType == "ExpiringMultiParty") assert.isTrue(spyLogIncludes(spy, 2, "expired"));
        if (contractVersion.contractType == "Perpetual") assert.isTrue(spyLogIncludes(spy, 2, "shutdown"));
        assert.isTrue(spyLogIncludes(spy, -1, "Liquidation withdrawn"));
        assert.equal(spy.getCall(-1).lastArg.amountWithdrawn, toWei("80")); // Amount withdrawn by liquidator minus dispute rewards.
      });

      it("Allowances are set", async function() {
        await Poll.run({
          logger: spyLogger,
          web3,
          financialContractAddress: financialContract.address,
          pollingDelay,
          errorRetries,
          errorRetriesTimeout,
          priceFeedConfig: defaultPriceFeedConfig
        });

        const collateralAllowance = await collateralToken.allowance(contractCreator, financialContract.address);
        assert.equal(collateralAllowance.toString(), MAX_UINT_VAL);
        const syntheticAllowance = await syntheticToken.allowance(contractCreator, financialContract.address);
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
          financialContractAddress: financialContract.address,
          pollingDelay,
          errorRetries,
          errorRetriesTimeout,
          priceFeedConfig: defaultPriceFeedConfig
        });

        for (let i = 0; i < spy.callCount; i++) {
          assert.notEqual(spyLogLevel(spy, i), "error");
        }

        // To verify contract type detection is correct for a standard feed, check the third log to see it matches expected.
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
          financialContractAddress: financialContract.address,
          pollingDelay,
          errorRetries,
          errorRetriesTimeout,
          priceFeedConfig: defaultPriceFeedConfig
        });

        for (let i = 0; i < spy.callCount; i++) {
          assert.notEqual(spyLogLevel(spy, i), "error");
        }

        // To verify decimal detection is correct for a standard feed, check the third log to see it matches expected.
        assert.isTrue(spyLogIncludes(spy, 3, `"contractVersion":"${contractVersion.contractVersion}"`));
        assert.isTrue(spyLogIncludes(spy, 3, `"contractType":"${contractVersion.contractType}"`));
      });
      it("Correctly rejects unknown contract types", async function() {
        // Should produce an error on a contract type that is unknown. set the financialContract as the finder, for example
        spy = sinon.spy();
        spyLogger = winston.createLogger({
          level: "debug",
          transports: [new SpyTransport({ level: "debug" }, { spy: spy })]
        });
        let didThrowError = false;
        let errorString;
        try {
          await Poll.run({
            logger: spyLogger,
            web3,
            financialContractAddress: finder.address,
            pollingDelay,
            errorRetries,
            errorRetriesTimeout,
            priceFeedConfig: defaultPriceFeedConfig
          });
        } catch (error) {
          didThrowError = true;
          errorString = error.toString();
        }

        assert.isTrue(didThrowError);
        assert.isTrue(errorString.includes("Contract version specified or inferred is not supported by this bot"));
      });
      it("Correctly re-tries after failed execution loop", async function() {
        // To create an error within the liquidator bot we can create a price feed that we know will throw an error.
        // Specifically, creating a uniswap feed with no `sync` events will generate an error. We can then check
        // the execution loop re-tries an appropriate number of times and that the associated logs are generated.
        const uniswap = await UniswapMock.new();
        // token0 and token1 don't matter here so we just arbitrarily set them to an existing token
        // that is already created, like `collateralToken`.
        await uniswap.setTokens(collateralToken.address, collateralToken.address);

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
            financialContractAddress: financialContract.address,
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
          if (spyLogIncludes(spy, i, "Financial Contract state updated")) reTryCounts.empStateUpdates += 1;
          if (spyLogIncludes(spy, i, "Checking for liquidatable positions")) reTryCounts.checkingForLiquidatable += 1;
          if (spyLogIncludes(spy, i, "An error was thrown in the execution loop")) reTryCounts.executionLoopErrors += 1;
        }

        assert.equal(reTryCounts.empStateUpdates, 4); // Initial loop and each 3 re-try should update the Financial Contract state. Expect 4 logs.
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
          financialContractAddress: financialContract.address,
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
        spy = sinon.spy();
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
          financialContractAddress: financialContract.address,
          pollingDelay,
          errorRetries,
          errorRetriesTimeout,
          priceFeedConfig: defaultPriceFeedConfig,
          liquidatorConfig,
          startingBlock,
          endingBlock
        });

        // 3rd log should list the liquidatorConfig with the expected starting and ending block.
        assert.equal(spy.getCall(3).lastArg.liquidatorConfig.startingBlock, startingBlock);
        assert.equal(spy.getCall(3).lastArg.liquidatorConfig.endingBlock, endingBlock);
      });
    });
  });
});

const { toWei, utf8ToHex, padRight } = web3.utils;
const {
  interfaceName,
  addGlobalHardhatTestingAddress,
  createConstructorParamsForContractVersion,
  TESTED_CONTRACT_VERSIONS
} = require("@uma/common");

const { getTruffleContract } = require("@uma/core");

// Custom winston transport module to monitor winston log outputs
const winston = require("winston");
const sinon = require("sinon");
const { SpyTransport, spyLogLevel, spyLogIncludes } = require("@uma/financial-templates-lib");

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

let constructorParams;
let defaultMonitorConfig;
let defaultTokenPricefeedConfig;
let defaultMedianizerPricefeedConfig;

let spy;
let spyLogger;

let pollingDelay = 0; // 0 polling delay creates a serverless bot that yields after one full execution.
let fromBlock = 0; // setting the from block to 0 will query all historic logs events.
let toBlock = null; // setting the to block to 0 will query up to the latest block Number.
let errorRetries = 1; // setting execution re-tried to 0 will exit as soon as the process encounters an error.
let errorRetriesTimeout = 0.1; // 100 milliseconds between preforming retries
let identifier = "TEST_IDENTIFIER";
let fundingRateIdentifier = "TEST_FUNDiNG_IDENTIFIER";

contract("index.js", function(accounts) {
  const contractCreator = accounts[0];

  TESTED_CONTRACT_VERSIONS.forEach(function(contractVersion) {
    // Import the tested versions of contracts. note that FinancialContract is either an ExpiringMultiParty or the perp
    // depending on the current iteration version.
    const FinancialContract = getTruffleContract(contractVersion.contractType, web3, contractVersion.contractVersion);
    const Finder = getTruffleContract("Finder", web3, contractVersion.contractVersion);
    const IdentifierWhitelist = getTruffleContract("IdentifierWhitelist", web3, contractVersion.contractVersion);
    const AddressWhitelist = getTruffleContract("AddressWhitelist", web3, contractVersion.contractVersion);
    const MockOracle = getTruffleContract("MockOracle", web3, contractVersion.contractVersion);
    const Token = getTruffleContract("ExpandedERC20", web3, contractVersion.contractVersion);
    const SyntheticToken = getTruffleContract("SyntheticToken", web3, contractVersion.contractVersion);
    const Timer = getTruffleContract("Timer", web3, contractVersion.contractVersion);
    const Store = getTruffleContract("Store", web3, contractVersion.contractVersion);
    const ConfigStore = getTruffleContract("ConfigStore", web3, contractVersion.contractVersion);
    const OptimisticOracle = getTruffleContract("OptimisticOracle", web3, contractVersion.contractVersion);

    describe(`Tests running on for smart contract version ${contractVersion.contractType} @ ${contractVersion.contractVersion}`, function() {
      before(async function() {
        collateralToken = await Token.new("Wrapped Ether", "WETH", 18, { from: contractCreator });

        identifierWhitelist = await IdentifierWhitelist.new();
        await identifierWhitelist.addSupportedIdentifier(utf8ToHex("TEST_IDENTIFIER"));
        await identifierWhitelist.addSupportedIdentifier(utf8ToHex("ETH/BTC"));

        // Create identifier whitelist and register the price tracking ticker with it.
        finder = await Finder.new();
        timer = await Timer.new();
        store = await Store.new({ rawValue: "0" }, { rawValue: "0" }, timer.address);
        await finder.changeImplementationAddress(utf8ToHex(interfaceName.Store), store.address);

        await finder.changeImplementationAddress(
          utf8ToHex(interfaceName.IdentifierWhitelist),
          identifierWhitelist.address
        );
        await identifierWhitelist.addSupportedIdentifier(utf8ToHex("TEST_IDENTIFIER"));

        mockOracle = await MockOracle.new(finder.address, timer.address, {
          from: contractCreator
        });
        await finder.changeImplementationAddress(utf8ToHex(interfaceName.Oracle), mockOracle.address);
        // Set the address in the global name space to enable disputer's index.js to access it.
        addGlobalHardhatTestingAddress("Voting", mockOracle.address);
      });

      beforeEach(async function() {
        // Create a sinon spy and give it to the SpyTransport as the winston logger. Use this to check all winston logs.
        spy = sinon.spy(); // Create a new spy for each test.
        spyLogger = winston.createLogger({
          level: "debug",
          transports: [new SpyTransport({ level: "debug" }, { spy: spy })]
        });

        // Create a new synthetic token
        syntheticToken = await SyntheticToken.new("Test Synthetic Token", "SYNTH", 18, { from: contractCreator });

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
          // Note: an identifier which is part of the default config is required for this test.
          { priceFeedIdentifier: padRight(utf8ToHex("ETH/BTC"), 64) }
        );
        financialContract = await FinancialContract.new(constructorParams);
        await syntheticToken.addMinter(financialContract.address);
        await syntheticToken.addBurner(financialContract.address);

        defaultMonitorConfig = {};
        defaultTokenPricefeedConfig = {
          type: "test",
          currentPrice: "1",
          historicalPrice: "1"
        };
        defaultMedianizerPricefeedConfig = {};
      });

      it("Completes one iteration without logging any errors", async function() {
        await Poll.run({
          logger: spyLogger,
          web3,
          financialContractAddress: financialContract.address,
          pollingDelay,
          errorRetries,
          errorRetriesTimeout,
          startingBlock: fromBlock,
          endingBlock: toBlock,
          monitorConfig: defaultMonitorConfig,
          tokenPriceFeedConfig: defaultTokenPricefeedConfig,
          medianizerPriceFeedConfig: defaultMedianizerPricefeedConfig
        });

        for (let i = 0; i < spy.callCount; i++) {
          assert.notEqual(spyLogLevel(spy, i), "error");
        }
      });

      it("Detects price feed, collateral and synthetic decimals", async function() {
        spy = sinon.spy(); // Create a new spy for each test.
        spyLogger = winston.createLogger({
          level: "debug",
          transports: [new SpyTransport({ level: "debug" }, { spy: spy })]
        });

        collateralToken = await Token.new("USDC", "USDC", 6, { from: contractCreator });
        syntheticToken = await SyntheticToken.new("Test Synthetic Token", "SYNTH", 6, { from: contractCreator });
        constructorParams = {
          ...constructorParams,
          collateralAddress: collateralToken.address,
          tokenAddress: syntheticToken.address
        };
        financialContract = await FinancialContract.new(constructorParams);
        await syntheticToken.addMinter(financialContract.address);
        await syntheticToken.addBurner(financialContract.address);

        await Poll.run({
          logger: spyLogger,
          web3,
          financialContractAddress: financialContract.address,
          pollingDelay,
          errorRetries,
          errorRetriesTimeout,
          startingBlock: fromBlock,
          endingBlock: toBlock,
          monitorConfig: defaultMonitorConfig,
          tokenPriceFeedConfig: defaultTokenPricefeedConfig,
          medianizerPriceFeedConfig: defaultMedianizerPricefeedConfig
        });

        for (let i = 0; i < spy.callCount; i++) {
          assert.notEqual(spyLogLevel(spy, i), "error");
        }

        // Third log, which prints the decimal info, should include # of decimals for the price feed, collateral and synthetic
        assert.isTrue(spyLogIncludes(spy, 9, '"collateralDecimals":6'));
        assert.isTrue(spyLogIncludes(spy, 9, '"syntheticDecimals":6'));
        assert.isTrue(spyLogIncludes(spy, 9, '"priceFeedDecimals":18'));
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
          startingBlock: fromBlock,
          endingBlock: toBlock,
          monitorConfig: defaultMonitorConfig,
          tokenPriceFeedConfig: defaultTokenPricefeedConfig,
          medianizerPriceFeedConfig: defaultMedianizerPricefeedConfig
        });

        for (let i = 0; i < spy.callCount; i++) {
          assert.notEqual(spyLogLevel(spy, i), "error");
        }

        // To verify contract type detection is correct for a standard feed, check the 9th log to see it matches expected.
        assert.isTrue(spyLogIncludes(spy, 9, `"contractVersion":"${contractVersion.contractVersion}"`));
        assert.isTrue(spyLogIncludes(spy, 9, `"contractType":"${contractVersion.contractType}"`));
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
            startingBlock: fromBlock,
            endingBlock: toBlock,
            monitorConfig: defaultMonitorConfig,
            tokenPriceFeedConfig: defaultTokenPricefeedConfig,
            medianizerPriceFeedConfig: defaultMedianizerPricefeedConfig
          });
        } catch (error) {
          errorString = error.toString();
          didThrowError = true;
        }

        assert.isTrue(didThrowError);
        assert.isTrue(errorString.includes("Contract version specified or inferred is not supported by this bot"));
      });

      it("Correctly re-tries after failed execution loop", async function() {
        // To validate re-try logic this test needs to get the monitor bot to throw within the main while loop. This is
        // not straightforward as the bot is designed to reject invalid configs before getting to the while loop. Once in the
        // while loop it should never throw errors as it gracefully falls over with situations like timed out API calls.
        // One way to induce an error is to give the bot a Financial Contract contract that can get through the initial checks but fails
        // when running any specific calls on the contracts. To do this we can create a Financial Contract that is only the financialContract
        // and excludes any liquidation logic. As a result, calling `getLiquidations` in the Financial Contract contract will error out.

        // Need to give an unknown identifier to get past the `createReferencePriceFeedForFinancialContract` & `createUniswapPriceFeedForFinancialContract`
        await identifierWhitelist.addSupportedIdentifier(utf8ToHex("UNKNOWN"));

        const PricelessPositionManager = getTruffleContract("PricelessPositionManager", web3, "1.2.2");
        const invalidFinancialContract = await PricelessPositionManager.new(
          constructorParams.expirationTimestamp,
          constructorParams.withdrawalLiveness,
          constructorParams.collateralAddress,
          constructorParams.tokenAddress,
          constructorParams.finderAddress,
          utf8ToHex("UNKNOWN"),
          constructorParams.minSponsorTokens,
          constructorParams.timerAddress,
          constructorParams.excessTokenBeneficiary,
          constructorParams.excessTokenBeneficiary
        );

        // Create a spy logger to catch all log messages to validate re-try attempts.
        spyLogger = winston.createLogger({
          level: "debug",
          transports: [new SpyTransport({ level: "debug" }, { spy: spy })]
        });

        errorRetries = 3; // set execution retries to 3 to validate.
        // Note both the token and medanizer price feeds are the same config. This is done so that createReferencePriceFeedForFinancialContract
        // can pass without trying to poll any information on the invalidFinancialContract to ensure that the bot gets into the main while
        // loop without throwing an error in inital set-up. If this left as defaultMedianizerPricefeedConfig (which is blank)
        // The bot will error out in setting up the price feed as the invalidFinancialContract instance cant be queried for `liquidationLiveness`
        // which is required when initalizing the price feed.

        let errorThrown = false;
        try {
          await Poll.run({
            logger: spyLogger,
            web3,
            financialContractAddress: invalidFinancialContract.address,
            pollingDelay,
            errorRetries: errorRetries,
            errorRetriesTimeout,
            startingBlock: fromBlock,
            endingBlock: toBlock,
            monitorConfig: { ...defaultMonitorConfig, contractVersion: "latest", contractType: "ExpiringMultiParty" },
            tokenPriceFeedConfig: defaultTokenPricefeedConfig,
            medianizerPriceFeedConfig: defaultTokenPricefeedConfig
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
  });
});

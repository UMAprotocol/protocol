const { web3, getContract } = require("hardhat");
const { assert } = require("chai");

const { toWei, utf8ToHex, padRight } = web3.utils;
const {
  interfaceName,
  addGlobalHardhatTestingAddress,
  createConstructorParamsForContractVersion,
  TESTED_CONTRACT_VERSIONS,
  getContractsNodePackageAliasForVerion,
} = require("@uma/common");

// Custom winston transport module to monitor winston log outputs
const winston = require("winston");
const sinon = require("sinon");
const { SpyTransport, spyLogLevel, spyLogIncludes, OptimisticOracleType } = require("@uma/financial-templates-lib");

// Script to test
const Poll = require("../index.js");

let collateralToken;
let syntheticToken;
let store;
let timer;
let mockOracle;
let finder;
let identifierWhitelist;
let configStore;
let collateralWhitelist;
let optimisticOracle;
let skinnyOptimisticOracle;

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
let errorRetriesTimeout = 0.1; // 100 milliseconds between performing retries
let identifier = "TEST_IDENTIFIER";
let fundingRateIdentifier = "TEST_FUNDING";

describe("index.js", function () {
  let accounts;
  let contractCreator;

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [contractCreator] = accounts;
  });

  TESTED_CONTRACT_VERSIONS.forEach(function (contractVersion) {
    const { getAbi, getBytecode } = require(getContractsNodePackageAliasForVerion(contractVersion.contractVersion));

    const createContract = (name) => {
      const abi = getAbi(name);
      const bytecode = getBytecode(name);
      return getContract(name, { abi, bytecode });
    };

    // Import the tested versions of contracts.
    const Finder = createContract("Finder");
    const IdentifierWhitelist = createContract("IdentifierWhitelist");
    const AddressWhitelist = createContract("AddressWhitelist");
    const MockOracle = createContract("MockOracle");
    const Token = createContract("ExpandedERC20");
    const SyntheticToken = createContract("SyntheticToken");
    const Timer = createContract("Timer");
    const Store = createContract("Store");
    const ConfigStore = createContract("ConfigStore");
    // Note: OptimisticOracle always uses "2.0.1"
    const OptimisticOracle = getContract("OptimisticOracle");
    const SkinnyOptimisticOracle = getContract("SkinnyOptimisticOracle");

    describe(`Tests running on smart contract version ${contractVersion.contractType} @ ${contractVersion.contractVersion}`, function () {
      before(async function () {
        collateralToken = await Token.new("Wrapped Ether", "WETH", 18).send({ from: contractCreator });

        identifierWhitelist = await IdentifierWhitelist.new().send({ from: contractCreator });
        await identifierWhitelist.methods
          .addSupportedIdentifier(utf8ToHex("TEST_IDENTIFIER"))
          .send({ from: contractCreator });
        await identifierWhitelist.methods.addSupportedIdentifier(utf8ToHex("ETH/BTC")).send({ from: contractCreator });

        // Create identifier whitelist and register the price tracking ticker with it.
        finder = await Finder.new().send({ from: contractCreator });
        timer = await Timer.new().send({ from: contractCreator });
        store = await Store.new({ rawValue: "0" }, { rawValue: "0" }, timer.options.address).send({
          from: contractCreator,
        });
        await finder.methods
          .changeImplementationAddress(utf8ToHex(interfaceName.Store), store.options.address)
          .send({ from: contractCreator });

        await finder.methods
          .changeImplementationAddress(
            utf8ToHex(interfaceName.IdentifierWhitelist),
            identifierWhitelist.options.address
          )
          .send({ from: contractCreator });
        await identifierWhitelist.methods
          .addSupportedIdentifier(utf8ToHex("TEST_IDENTIFIER"))
          .send({ from: contractCreator });

        mockOracle = await MockOracle.new(finder.options.address, timer.options.address).send({
          from: contractCreator,
        });
        await finder.methods
          .changeImplementationAddress(utf8ToHex(interfaceName.Oracle), mockOracle.options.address)
          .send({ from: contractCreator });
        // Set the address in the global name space to enable disputer's index.js to access it.
        addGlobalHardhatTestingAddress("Voting", mockOracle.options.address);
      });

      beforeEach(async function () {
        // Create a sinon spy and give it to the SpyTransport as the winston logger. Use this to check all winston logs.
        spy = sinon.spy(); // Create a new spy for each test.
        spyLogger = winston.createLogger({
          level: "debug",
          transports: [new SpyTransport({ level: "debug" }, { spy: spy })],
        });
        spyLogger.isFlushed = true; // exit instantly when requested to do so.

        // Create a new synthetic token
        syntheticToken = await SyntheticToken.new("Test Synthetic Token", "SYNTH", 18).send({ from: contractCreator });

        collateralWhitelist = await AddressWhitelist.new().send({ from: contractCreator });
        await finder.methods
          .changeImplementationAddress(
            web3.utils.utf8ToHex(interfaceName.CollateralWhitelist),
            collateralWhitelist.options.address
          )
          .send({ from: contractCreator });
        await collateralWhitelist.methods
          .addToWhitelist(collateralToken.options.address)
          .send({ from: contractCreator });

        optimisticOracle = await OptimisticOracle.new(7200, finder.options.address, timer.options.address).send({
          from: contractCreator,
        });
        skinnyOptimisticOracle = await SkinnyOptimisticOracle.new(
          7200,
          finder.options.address,
          timer.options.address
        ).send({ from: contractCreator });
        await finder.methods
          .changeImplementationAddress(utf8ToHex(interfaceName.OptimisticOracle), optimisticOracle.options.address)
          .send({ from: contractCreator });

        if (contractVersion.contractType == "Perpetual") {
          configStore = await ConfigStore.new(
            {
              timelockLiveness: 86400, // 1 day
              rewardRatePerSecond: { rawValue: "0" },
              proposerBondPercentage: { rawValue: "0" },
              maxFundingRate: { rawValue: toWei("0.00001") },
              minFundingRate: { rawValue: toWei("-0.00001") },
              proposalTimePastLimit: 0,
            },
            timer.options.address
          ).send({ from: contractCreator });
          await identifierWhitelist.methods
            .addSupportedIdentifier(padRight(utf8ToHex(fundingRateIdentifier)))
            .send({ from: contractCreator });
        }
        // Deploy a new expiring multi party OR perpetual.
        constructorParams = await createConstructorParamsForContractVersion(
          contractVersion,
          {
            convertDecimals: toWei, // These tests do not use convertSynthetic. Override this with toWei
            finder,
            collateralToken,
            syntheticToken,
            identifier,
            fundingRateIdentifier,
            timer,
            store,
            configStore: configStore || {}, // if the contract type is not a perp this will be null.
          },
          // Note: an identifier which is part of the default config is required for this test.
          { priceFeedIdentifier: padRight(utf8ToHex("ETH/BTC"), 64) }
        );

        defaultMonitorConfig = {};
        defaultTokenPricefeedConfig = { type: "test", currentPrice: "1", historicalPrice: "1" };
        defaultMedianizerPricefeedConfig = {};
      });

      it("OptimisticOracle monitor: Completes one iteration without logging any errors", async function () {
        await Poll.run({
          logger: spyLogger,
          web3,
          optimisticOracleAddress: optimisticOracle.options.address,
          optimisticOracleType: OptimisticOracleType.OptimisticOracle,
          pollingDelay,
          errorRetries,
          errorRetriesTimeout,
          startingBlock: fromBlock,
          endingBlock: toBlock,
          monitorConfig: defaultMonitorConfig,
          tokenPriceFeedConfig: defaultTokenPricefeedConfig,
          medianizerPriceFeedConfig: defaultMedianizerPricefeedConfig,
        });
        for (let i = 0; i < spy.callCount; i++) {
          assert.notEqual(spyLogLevel(spy, i), "error");
        }
        assert.equal(spy.getCall(0).lastArg.optimisticOracleType, OptimisticOracleType.OptimisticOracle);
      });
      it("SkinnyOptimisticOracle monitor: Completes one iteration without logging any errors", async function () {
        await Poll.run({
          logger: spyLogger,
          web3,
          optimisticOracleAddress: skinnyOptimisticOracle.options.address,
          optimisticOracleType: OptimisticOracleType.SkinnyOptimisticOracle,
          pollingDelay,
          errorRetries,
          errorRetriesTimeout,
          startingBlock: fromBlock,
          endingBlock: toBlock,
          monitorConfig: defaultMonitorConfig,
          tokenPriceFeedConfig: defaultTokenPricefeedConfig,
          medianizerPriceFeedConfig: defaultMedianizerPricefeedConfig,
        });
        for (let i = 0; i < spy.callCount; i++) {
          assert.notEqual(spyLogLevel(spy, i), "error");
        }
        assert.equal(spy.getCall(0).lastArg.optimisticOracleType, OptimisticOracleType.SkinnyOptimisticOracle);
      });
      it("Correctly rejects unknown contract types", async function () {
        // Should produce an error on a contract type that is unknown. set the financialContract as the finder, for example
        spy = sinon.spy();
        spyLogger = winston.createLogger({
          level: "debug",
          transports: [new SpyTransport({ level: "debug" }, { spy: spy })],
        });
        spyLogger.isFlushed = true; // exit instantly when requested to do so.

        let didThrowError = false;
        let errorString;
        try {
          await Poll.run({
            logger: spyLogger,
            web3,
            financialContractAddress: finder.options.address,
            pollingDelay,
            errorRetries,
            errorRetriesTimeout,
            startingBlock: fromBlock,
            endingBlock: toBlock,
            monitorConfig: defaultMonitorConfig,
            tokenPriceFeedConfig: defaultTokenPricefeedConfig,
            medianizerPriceFeedConfig: defaultMedianizerPricefeedConfig,
          });
        } catch (error) {
          errorString = error.toString();
          didThrowError = true;
        }

        assert.isTrue(didThrowError);
        assert.isTrue(errorString.includes("Contract version specified or inferred is not supported by this bot"));
      });

      it("Correctly re-tries after failed execution loop", async function () {
        // To validate re-try logic this test needs to get the monitor bot to throw within the main while loop. This is
        // not straightforward as the bot is designed to reject invalid configs before getting to the while loop. Once in the
        // while loop it should never throw errors as it gracefully falls over with situations like timed out API calls.
        // One way to induce an error is to give the bot a Financial Contract contract that can get through the initial checks but fails
        // when running any specific calls on the contracts. To do this we can create a Financial Contract that is only the financialContract
        // and excludes any liquidation logic. As a result, calling `getLiquidations` in the Financial Contract contract will error out.

        // Need to give an unknown identifier to get past the `createReferencePriceFeedForFinancialContract` & `createUniswapPriceFeedForFinancialContract`
        await identifierWhitelist.methods.addSupportedIdentifier(utf8ToHex("UNKNOWN")).send({ from: contractCreator });

        const PricelessPositionManager = getContract("PricelessPositionManager");
        const invalidFinancialContract = await PricelessPositionManager.new(
          constructorParams.expirationTimestamp,
          constructorParams.withdrawalLiveness,
          constructorParams.collateralAddress,
          constructorParams.tokenAddress,
          constructorParams.finderAddress,
          utf8ToHex("UNKNOWN"),
          constructorParams.minSponsorTokens,
          constructorParams.timerAddress,
          constructorParams.excessTokenBeneficiary
        ).send({ from: contractCreator });

        // Create a spy logger to catch all log messages to validate re-try attempts.
        spyLogger = winston.createLogger({
          level: "debug",
          transports: [new SpyTransport({ level: "debug" }, { spy: spy })],
        });
        spyLogger.isFlushed = true; // exit instantly when requested to do so.

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
            financialContractAddress: invalidFinancialContract.options.address,
            pollingDelay,
            errorRetries: errorRetries,
            errorRetriesTimeout,
            startingBlock: fromBlock,
            endingBlock: toBlock,
            monitorConfig: { ...defaultMonitorConfig, contractVersion: "2.0.1", contractType: "ExpiringMultiParty" },
            tokenPriceFeedConfig: defaultTokenPricefeedConfig,
            medianizerPriceFeedConfig: defaultTokenPricefeedConfig,
          });
        } catch (error) {
          errorThrown = true;
        }
        // Iterate over all log events and count the number of
        // execution loop errors.
        let reTryCounts = { executionLoopErrors: 0 };
        for (let i = 0; i < spy.callCount; i++) {
          if (spyLogIncludes(spy, i, "An error was thrown in the execution loop")) reTryCounts.executionLoopErrors += 1;
        }

        assert.equal(reTryCounts.executionLoopErrors, 3); // Each re-try create a log. These only occur on re-try and so expect 3 logs.
        assert.isTrue(errorThrown); // An error should have been thrown after the 3 execution re-tries.
      });
    }).timeout(10000);
  });
});

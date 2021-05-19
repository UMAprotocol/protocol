const { toWei, utf8ToHex, padRight, toBN } = web3.utils;
const truffleContract = require("@truffle/contract");
const {
  MAX_UINT_VAL,
  ZERO_ADDRESS,
  interfaceName,
  addGlobalHardhatTestingAddress,
  createConstructorParamsForContractVersion,
  TESTED_CONTRACT_VERSIONS,
} = require("@uma/common");
const { getTruffleContract } = require("@uma/core");

// Custom winston transport module to monitor winston log outputs
const winston = require("winston");
const sinon = require("sinon");
const { SpyTransport, spyLogLevel, spyLogIncludes } = require("@uma/financial-templates-lib");

// Uniswap related contracts
const UniswapV2Factory = require("@uniswap/v2-core/build/UniswapV2Factory.json");
const IUniswapV2Pair = require("@uniswap/v2-core/build/IUniswapV2Pair.json");
const UniswapV2Router02 = require("@uniswap/v2-periphery/build/UniswapV2Router02.json");

const createContractObjectFromJson = (contractJsonObject) => {
  let truffleContractCreator = truffleContract(contractJsonObject);
  truffleContractCreator.setProvider(web3.currentProvider);
  return truffleContractCreator;
};

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
let dsProxyFactory;

let pollingDelay = 0; // 0 polling delay creates a serverless bot that yields after one full execution.
let errorRetries = 1;
let errorRetriesTimeout = 0.1; // 100 milliseconds between preforming retries
let identifier = "TEST_IDENTIFIER";
let fundingRateIdentifier = "TEST_FUNDING_IDENTIFIER";

contract("index.js", function (accounts) {
  const contractCreator = accounts[0];
  const disputer = contractCreator;

  TESTED_CONTRACT_VERSIONS.forEach(function (contractVersion) {
    // Import the tested versions of contracts. note that financialContract is either an ExpiringMultiParty or the
    // perp depending on the current iteration version.
    const FinancialContract = getTruffleContract(contractVersion.contractType, web3, contractVersion.contractVersion);
    const Finder = getTruffleContract("Finder", web3, contractVersion.contractVersion);
    const IdentifierWhitelist = getTruffleContract("IdentifierWhitelist", web3, contractVersion.contractVersion);
    const AddressWhitelist = getTruffleContract("AddressWhitelist", web3, contractVersion.contractVersion);
    const MockOracle = getTruffleContract("MockOracle", web3, contractVersion.contractVersion);
    const Token = getTruffleContract("ExpandedERC20", web3, contractVersion.contractVersion);
    const SyntheticToken = getTruffleContract("SyntheticToken", web3, contractVersion.contractVersion);
    const Timer = getTruffleContract("Timer", web3, contractVersion.contractVersion);
    const Store = getTruffleContract("Store", web3, contractVersion.contractVersion);
    const ConfigStore = getTruffleContract("ConfigStore", web3);
    const OptimisticOracle = getTruffleContract("OptimisticOracle", web3);
    const DSProxyFactory = getTruffleContract("DSProxyFactory", web3);

    describe(`Smart contract version ${contractVersion.contractType} @ ${contractVersion.contractVersion}`, function () {
      before(async function () {
        finder = await Finder.new();
        timer = await Timer.new();
        // Create identifier whitelist and register the price tracking ticker with it.
        identifierWhitelist = await IdentifierWhitelist.new();
        await identifierWhitelist.addSupportedIdentifier(utf8ToHex(identifier));
        await finder.changeImplementationAddress(
          web3.utils.utf8ToHex(interfaceName.IdentifierWhitelist),
          identifierWhitelist.address
        );

        mockOracle = await MockOracle.new(finder.address, timer.address, {
          from: contractCreator,
        });
        await finder.changeImplementationAddress(utf8ToHex(interfaceName.Oracle), mockOracle.address);
        // Set the address in the global name space to enable disputer's index.js to access it.
        addGlobalHardhatTestingAddress("Voting", mockOracle.address);

        store = await Store.new({ rawValue: "0" }, { rawValue: "0" }, timer.address);
        await finder.changeImplementationAddress(utf8ToHex(interfaceName.Store), store.address);

        dsProxyFactory = await DSProxyFactory.new();
        addGlobalHardhatTestingAddress("DSProxyFactory", dsProxyFactory.address);
      });

      beforeEach(async function () {
        // Create a sinon spy and give it to the SpyTransport as the winston logger. Use this to check all winston logs.
        spy = sinon.spy(); // Create a new spy for each test.
        spyLogger = winston.createLogger({
          level: "info",
          transports: [new SpyTransport({ level: "info" }, { spy: spy })],
        });

        // Create a new synthetic token
        syntheticToken = await SyntheticToken.new("Test Synthetic Token", "SYNTH", 18, { from: contractCreator });
        collateralToken = await Token.new("Wrapped Ether", "WETH", 18, { from: contractCreator });
        await collateralToken.addMember(1, contractCreator, { from: contractCreator });

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
              proposalTimePastLimit: 0,
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
            configStore: configStore || {}, // if the contract type is not a perp this will be null.
          },
          { expirationTimestamp: (await timer.getCurrentTime()).toNumber() + 100 } // config override expiration time.
        );
        financialContract = await FinancialContract.new(constructorParams);
        await syntheticToken.addMinter(financialContract.address);
        await syntheticToken.addBurner(financialContract.address);

        defaultPriceFeedConfig = {
          type: "test",
          currentPrice: "1",
          historicalPrice: "1",
        };
      });

      it("Detects price feed, collateral and synthetic decimals", async function () {
        spy = sinon.spy(); // Create a new spy for each test.
        spyLogger = winston.createLogger({
          level: "debug",
          transports: [new SpyTransport({ level: "debug" }, { spy: spy })],
        });

        collateralToken = await Token.new("BTC", "BTC", 8, { from: contractCreator });
        syntheticToken = await SyntheticToken.new("Test Synthetic Token", "SYNTH", 18, { from: contractCreator });
        // For this test we are using a lower decimal identifier, USDBTC. First we need to add it to the whitelist.
        await identifierWhitelist.addSupportedIdentifier(padRight(utf8ToHex("USDBTC"), 64));
        const decimalTestConstructorParams = JSON.parse(
          JSON.stringify({
            ...constructorParams,
            collateralAddress: collateralToken.address,
            tokenAddress: syntheticToken.address,
            priceFeedIdentifier: padRight(utf8ToHex("USDBTC"), 64),
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
          errorRetriesTimeout,
        });

        // Seventh log, which prints the decimal info, should include # of decimals for the price feed, collateral and synthetic.
        // The "7th" log is pretty arbitrary. This is simply the log message that is produced at the end of initialization
        // under `Liquidator initialized`. It does however contain the decimal info, which is what we really care about.
        assert.isTrue(spyLogIncludes(spy, 7, '"collateralDecimals":8'));
        assert.isTrue(spyLogIncludes(spy, 7, '"syntheticDecimals":18'));
        assert.isTrue(spyLogIncludes(spy, 7, '"priceFeedDecimals":8'));
      });
      it("Can correctly initialize using a DSProxy", async function () {
        // Deploy a reserve currency token.
        const reserveToken = await Token.new("Reserve Token", "RTKN", 18, { from: contractCreator });
        await reserveToken.addMember(1, contractCreator, { from: contractCreator });
        // deploy Uniswap V2 Factory & router.
        const factory = await createContractObjectFromJson(UniswapV2Factory).new(contractCreator, {
          from: contractCreator,
        });
        const router = await createContractObjectFromJson(UniswapV2Router02).new(
          factory.address,
          collateralToken.address,
          { from: contractCreator }
        );

        // initialize the pair
        await factory.createPair(reserveToken.address, collateralToken.address);
        const pairAddress = await factory.getPair(reserveToken.address, collateralToken.address);
        const pair = await createContractObjectFromJson(IUniswapV2Pair).at(pairAddress);

        await reserveToken.mint(pairAddress, toBN(toWei("1000")).muln(10000000), { from: contractCreator });
        await collateralToken.mint(pairAddress, toBN(toWei("1")).muln(10000000), { from: contractCreator });
        await pair.sync();

        spy = sinon.spy();
        spyLogger = winston.createLogger({
          level: "debug",
          transports: [new SpyTransport({ level: "debug" }, { spy: spy })],
        });

        await Poll.run({
          logger: spyLogger,
          web3,
          financialContractAddress: financialContract.address,
          pollingDelay,
          errorRetries,
          errorRetriesTimeout,
          priceFeedConfig: defaultPriceFeedConfig,
          proxyTransactionWrapperConfig: {
            useDsProxyToDispute: true,
            disputerReserveCurrencyAddress: reserveToken.address,
            uniswapRouterAddress: router.address,
          },
        });

        for (let i = 0; i < spy.callCount; i++) {
          assert.notEqual(spyLogLevel(spy, i), "error");
        }

        // A log of a deployed DSProxy should be included.
        assert.isTrue(spyLogIncludes(spy, 6, "No DSProxy found for EOA. Deploying new DSProxy"));
        assert.isTrue(spyLogIncludes(spy, 8, "DSProxy deployed for your EOA"));
        const createdEvents = await dsProxyFactory.getPastEvents("Created", { fromBlock: 0 });

        assert.equal(createdEvents.length, 1);
        assert.equal(createdEvents[0].returnValues.owner, disputer);
        // To verify contract type detection is correct for a standard feed, check the fifth log to see it matches expected.
        assert.isTrue(spyLogIncludes(spy, 9, '"collateralDecimals":18'));
        assert.isTrue(spyLogIncludes(spy, 9, '"syntheticDecimals":18'));
        assert.isTrue(spyLogIncludes(spy, 9, '"priceFeedDecimals":18'));

        spy = sinon.spy(); // Create a new spy for each test.
        spyLogger = winston.createLogger({
          level: "debug",
          transports: [new SpyTransport({ level: "debug" }, { spy: spy })],
        });

        collateralToken = await Token.new("BTC", "BTC", 8, { from: contractCreator });
        syntheticToken = await SyntheticToken.new("Test Synthetic Token", "SYNTH", 18, { from: contractCreator });
        // For this test we are using a lower decimal identifier, USDBTC. First we need to add it to the whitelist.
        await identifierWhitelist.addSupportedIdentifier(padRight(utf8ToHex("USDBTC"), 64));
        const decimalTestConstructorParams = JSON.parse(
          JSON.stringify({
            ...constructorParams,
            collateralAddress: collateralToken.address,
            tokenAddress: syntheticToken.address,
            priceFeedIdentifier: padRight(utf8ToHex("USDBTC"), 64),
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
          errorRetriesTimeout,
        });

        // Seventh log, which prints the decimal info, should include # of decimals for the price feed, collateral and synthetic.
        // The "7th" log is pretty arbitrary. This is simply the log message that is produced at the end of initialization
        // under `Liquidator initialized`. It does however contain the decimal info, which is what we really care about.
        assert.isTrue(spyLogIncludes(spy, 7, '"collateralDecimals":8'));
        assert.isTrue(spyLogIncludes(spy, 7, '"syntheticDecimals":18'));
        assert.isTrue(spyLogIncludes(spy, 7, '"priceFeedDecimals":8'));
      });

      it("Allowances are set", async function () {
        await Poll.run({
          logger: spyLogger,
          web3,
          financialContractAddress: financialContract.address,
          pollingDelay,
          errorRetries,
          errorRetriesTimeout,
          priceFeedConfig: defaultPriceFeedConfig,
        });

        const collateralAllowance = await collateralToken.allowance(contractCreator, financialContract.address);
        assert.equal(collateralAllowance.toString(), MAX_UINT_VAL);
      });

      it("Completes one iteration without logging any errors", async function () {
        await Poll.run({
          logger: spyLogger,
          web3,
          financialContractAddress: financialContract.address,
          pollingDelay,
          errorRetries,
          errorRetriesTimeout,
          priceFeedConfig: defaultPriceFeedConfig,
        });

        for (let i = 0; i < spy.callCount; i++) {
          assert.notEqual(spyLogLevel(spy, i), "error");
        }
      });
      it("Correctly detects contract type and rejects unknown contract types", async function () {
        spy = sinon.spy();
        spyLogger = winston.createLogger({
          level: "debug",
          transports: [new SpyTransport({ level: "debug" }, { spy: spy })],
        });

        await Poll.run({
          logger: spyLogger,
          web3,
          financialContractAddress: financialContract.address,
          pollingDelay,
          errorRetries,
          errorRetriesTimeout,
          priceFeedConfig: defaultPriceFeedConfig,
        });

        for (let i = 0; i < spy.callCount; i++) {
          assert.notEqual(spyLogLevel(spy, i), "error");
        }

        // To verify decimal detection is correct for a standard feed, check the fifth log to see it matches expected.
        assert.isTrue(spyLogIncludes(spy, 5, `"contractVersion":"${contractVersion.contractVersion}"`));
        assert.isTrue(spyLogIncludes(spy, 5, `"contractType":"${contractVersion.contractType}"`));

        // Should produce an error on a contract type that is unknown. set the financialContract as the finder, for example
        let didThrowError = false;
        try {
          await Poll.run({
            logger: spyLogger,
            web3,
            financialContractAddress: finder.address,
            pollingDelay,
            errorRetries,
            errorRetriesTimeout,
            priceFeedConfig: defaultPriceFeedConfig,
          });
        } catch (error) {
          didThrowError = true;
        }

        assert.isTrue(didThrowError);
      });
      it("Correctly re-tries after failed execution loop", async function () {
        // To validate re-try logic this test needs to get the dispute bot to throw within the main while loop. This is
        // not straightforward as the bot is designed to reject invalid configs before getting to the while loop. Once in the
        // while loop it should never throw errors as it gracefully falls over with situations like timed out API calls.
        // One way to induce an error is to give the bot a Financial Contract contract that can get through the initial checks but fails
        // when running any specific calls on the contracts. To do this we can create a Financial Contract that is only the PricelessPositionManager
        // and excludes any liquidation logic. As a result, calling `getLiquidations` in the Financial Contract contract will error out.

        // Need to give an unknown identifier to get past the `createReferencePriceFeedForFinancialContract` & `createUniswapPriceFeedForFinancialContract`
        await identifierWhitelist.addSupportedIdentifier(utf8ToHex("UNKNOWN"));

        const PricelessPositionManager = await getTruffleContract("PricelessPositionManager", web3, "1.2.2");

        const invalidFinancialContract = await PricelessPositionManager.new(
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
          transports: [new SpyTransport({ level: "debug" }, { spy: spy })],
        });

        errorRetries = 3; // set execution retries to 3 to validate.
        let errorThrown = false;
        try {
          await Poll.run({
            logger: spyLogger,
            web3,
            financialContractAddress: invalidFinancialContract.address,
            pollingDelay,
            errorRetries,
            errorRetriesTimeout,
            priceFeedConfig: defaultPriceFeedConfig,
            disputerConfig: {
              // need to override the auto-detected version as we are using a "broken" PricelessPositionManager from above.
              contractVersion: contractVersion.contractVersion,
              contractType: contractVersion.contractType,
            },
          });
        } catch (error) {
          errorThrown = true;
        }

        // Iterate over all log events and count the number of gasEstimatorUpdate, disputer check for liquidation events
        // execution loop errors and finally disputer polling errors.
        let reTryCounts = {
          gasEstimatorUpdate: 0,
          executionLoopErrors: 0,
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
  });
});

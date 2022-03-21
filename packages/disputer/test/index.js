const { web3, getContract } = require("hardhat");
const { assert } = require("chai");
const { toWei, utf8ToHex, padRight, toBN } = web3.utils;
const {
  MAX_UINT_VAL,
  ZERO_ADDRESS,
  interfaceName,
  addGlobalHardhatTestingAddress,
  createConstructorParamsForContractVersion,
  TESTED_CONTRACT_VERSIONS,
  createContractObjectFromJson,
  getContractsNodePackageAliasForVerion,
} = require("@uma/common");

// Custom winston transport module to monitor winston log outputs
const winston = require("winston");
const sinon = require("sinon");
const { SpyTransport, spyLogLevel, spyLogIncludes } = require("@uma/financial-templates-lib");

// Uniswap related contracts
const UniswapV2Factory = require("@uniswap/v2-core/build/UniswapV2Factory.json");
const IUniswapV2Pair = require("@uniswap/v2-core/build/IUniswapV2Pair.json");
const UniswapV2Router02 = require("@uniswap/v2-periphery/build/UniswapV2Router02.json");

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
let errorRetriesTimeout = 0.1; // 100 milliseconds between performing retries
let identifier = "TEST_IDENTIFIER";
let fundingRateIdentifier = "TEST_FUNDING";

describe("index.js", function () {
  let accounts, disputer, contractCreator;

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [contractCreator] = accounts;
    disputer = contractCreator;
  });

  TESTED_CONTRACT_VERSIONS.forEach(function (contractVersion) {
    const { getAbi, getBytecode } = require(getContractsNodePackageAliasForVerion(contractVersion.contractVersion));

    const createContract = (name) => {
      const abi = getAbi(name);
      const bytecode = getBytecode(name);
      return getContract(name, { abi, bytecode });
    };

    // Import the tested versions of contracts. note that financialContract is either an ExpiringMultiParty or the
    // perp depending on the current iteration version.
    const FinancialContract = createContract(contractVersion.contractType);
    const Finder = createContract("Finder");
    const IdentifierWhitelist = createContract("IdentifierWhitelist");
    const AddressWhitelist = createContract("AddressWhitelist");
    const MockOracle = createContract("MockOracle");
    const Token = createContract("ExpandedERC20");
    const SyntheticToken = createContract("SyntheticToken");
    const Timer = createContract("Timer");
    const Store = createContract("Store");
    const ConfigStore = createContract("ConfigStore");
    const OptimisticOracle = createContract("OptimisticOracle");
    const DSProxyFactory = createContract("DSProxyFactory");

    describe(`Smart contract version ${contractVersion.contractType} @ ${contractVersion.contractVersion}`, function () {
      before(async function () {
        finder = await Finder.new().send({ from: contractCreator });
        timer = await Timer.new().send({ from: contractCreator });
        // Create identifier whitelist and register the price tracking ticker with it.
        identifierWhitelist = await IdentifierWhitelist.new().send({ from: contractCreator });
        await identifierWhitelist.methods.addSupportedIdentifier(utf8ToHex(identifier)).send({ from: contractCreator });
        await finder.methods
          .changeImplementationAddress(
            web3.utils.utf8ToHex(interfaceName.IdentifierWhitelist),
            identifierWhitelist.options.address
          )
          .send({ from: contractCreator });

        mockOracle = await MockOracle.new(finder.options.address, timer.options.address).send({
          from: contractCreator,
        });
        await finder.methods
          .changeImplementationAddress(utf8ToHex(interfaceName.Oracle), mockOracle.options.address)
          .send({ from: contractCreator });
        // Set the address in the global name space to enable disputer's index.js to access it.
        addGlobalHardhatTestingAddress("Voting", mockOracle.options.address);

        store = await Store.new({ rawValue: "0" }, { rawValue: "0" }, timer.options.address).send({
          from: contractCreator,
        });
        await finder.methods
          .changeImplementationAddress(utf8ToHex(interfaceName.Store), store.options.address)
          .send({ from: contractCreator });

        dsProxyFactory = await DSProxyFactory.new().send({ from: contractCreator });
        addGlobalHardhatTestingAddress("DSProxyFactory", dsProxyFactory.options.address);
      });

      beforeEach(async function () {
        // Create a sinon spy and give it to the SpyTransport as the winston logger. Use this to check all winston logs.
        spy = sinon.spy(); // Create a new spy for each test.
        spyLogger = winston.createLogger({
          level: "info",
          transports: [new SpyTransport({ level: "info" }, { spy: spy })],
        });

        // Create a new synthetic token
        syntheticToken = await SyntheticToken.new("Test Synthetic Token", "SYNTH", 18).send({ from: contractCreator });
        collateralToken = await Token.new("Wrapped Ether", "WETH", 18).send({ from: contractCreator });
        await collateralToken.methods.addMember(1, contractCreator).send({ from: contractCreator });

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
          optimisticOracle = await OptimisticOracle.new(7200, finder.options.address, timer.options.address).send({
            from: contractCreator,
          });
          await finder.methods
            .changeImplementationAddress(utf8ToHex(interfaceName.OptimisticOracle), optimisticOracle.options.address)
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
          { expirationTimestamp: parseInt(await timer.methods.getCurrentTime().call()) + 100 } // config override expiration time.
        );
        financialContract = await FinancialContract.new(constructorParams).send({ from: contractCreator });
        await syntheticToken.methods.addMinter(financialContract.options.address).send({ from: contractCreator });
        await syntheticToken.methods.addBurner(financialContract.options.address).send({ from: contractCreator });

        defaultPriceFeedConfig = { type: "test", currentPrice: "1", historicalPrice: "1" };
      });

      it("Detects price feed, collateral and synthetic decimals", async function () {
        spy = sinon.spy(); // Create a new spy for each test.
        spyLogger = winston.createLogger({
          level: "debug",
          transports: [new SpyTransport({ level: "debug" }, { spy: spy })],
        });

        collateralToken = await Token.new("BTC", "BTC", 8).send({ from: contractCreator });
        syntheticToken = await SyntheticToken.new("Test Synthetic Token", "SYNTH", 18).send({ from: contractCreator });
        // For this test we are using a lower decimal identifier, USDBTC. First we need to add it to the whitelist.
        await identifierWhitelist.methods
          .addSupportedIdentifier(padRight(utf8ToHex("USDBTC"), 64))
          .send({ from: contractCreator });
        const decimalTestConstructorParams = JSON.parse(
          JSON.stringify({
            ...constructorParams,
            collateralAddress: collateralToken.options.address,
            tokenAddress: syntheticToken.options.address,
            priceFeedIdentifier: padRight(utf8ToHex("USDBTC"), 64),
          })
        );
        financialContract = await FinancialContract.new(decimalTestConstructorParams).send({ from: contractCreator });
        await syntheticToken.methods.addMinter(financialContract.options.address).send({ from: contractCreator });
        await syntheticToken.methods.addBurner(financialContract.options.address).send({ from: contractCreator });

        // Note the execution below does not have a price feed included. It should be pulled from the default USDBTC config.
        await Poll.run({
          logger: spyLogger,
          web3,
          financialContractAddress: financialContract.options.address,
          pollingDelay,
          errorRetries,
          errorRetriesTimeout,
        });

        // Seventh log, which prints the decimal info, should include # of decimals for the price feed, collateral and synthetic.
        // The "7th" log is pretty arbitrary. This is simply the log message that is produced at the end of initialization
        // under `Liquidator initialized`. It does however contain the decimal info, which is what we really care about.
        assert.isTrue(spyLogIncludes(spy, 8, '"collateralDecimals":8'));
        assert.isTrue(spyLogIncludes(spy, 8, '"syntheticDecimals":18'));
        assert.isTrue(spyLogIncludes(spy, 8, '"priceFeedDecimals":8'));
      });
      it("Can correctly initialize using a DSProxy", async function () {
        // Deploy a reserve currency token.
        const reserveToken = await Token.new("Reserve Token", "RTKN", 18).send({ from: contractCreator });
        await reserveToken.methods.addMember(1, contractCreator).send({ from: contractCreator });
        // deploy Uniswap V2 Factory & router.
        const factory = (
          await createContractObjectFromJson(UniswapV2Factory, web3).new(contractCreator, { from: contractCreator })
        ).contract;
        const router = (
          await createContractObjectFromJson(UniswapV2Router02, web3).new(
            factory.options.address,
            collateralToken.options.address,
            { from: contractCreator }
          )
        ).contract;

        // initialize the pair
        await factory.methods
          .createPair(reserveToken.options.address, collateralToken.options.address)
          .send({ from: contractCreator });
        const pairAddress = await factory.methods
          .getPair(reserveToken.options.address, collateralToken.options.address)
          .call();
        const pair = (await createContractObjectFromJson(IUniswapV2Pair, web3).at(pairAddress)).contract;

        await reserveToken.methods
          .mint(pairAddress, toBN(toWei("1000")).muln(10000000))
          .send({ from: contractCreator });
        await collateralToken.methods
          .mint(pairAddress, toBN(toWei("1")).muln(10000000))
          .send({ from: contractCreator });
        await pair.methods.sync().send({ from: contractCreator });

        spy = sinon.spy();
        spyLogger = winston.createLogger({
          level: "debug",
          transports: [new SpyTransport({ level: "debug" }, { spy: spy })],
        });

        await Poll.run({
          logger: spyLogger,
          web3,
          financialContractAddress: financialContract.options.address,
          pollingDelay,
          errorRetries,
          errorRetriesTimeout,
          priceFeedConfig: defaultPriceFeedConfig,
          proxyTransactionWrapperConfig: {
            useDsProxyToDispute: true,
            disputerReserveCurrencyAddress: reserveToken.options.address,
            uniswapRouterAddress: router.options.address,
          },
        });

        for (let i = 0; i < spy.callCount; i++) {
          assert.notEqual(spyLogLevel(spy, i), "error");
        }

        // A log of a deployed DSProxy should be included.
        assert.isTrue(spyLogIncludes(spy, 7, "No DSProxy found for EOA. Deploying new DSProxy"));
        assert.isTrue(spyLogIncludes(spy, 9, "DSProxy deployed for your EOA"));
        const createdEvents = await dsProxyFactory.getPastEvents("Created", { fromBlock: 0 });

        assert.equal(createdEvents.length, 1);
        assert.equal(createdEvents[0].returnValues.owner, disputer);
        // To verify contract type detection is correct for a standard feed, check the fifth log to see it matches expected.
        assert.isTrue(spyLogIncludes(spy, 10, '"collateralDecimals":18'));
        assert.isTrue(spyLogIncludes(spy, 10, '"syntheticDecimals":18'));
        assert.isTrue(spyLogIncludes(spy, 10, '"priceFeedDecimals":18'));

        spy = sinon.spy(); // Create a new spy for each test.
        spyLogger = winston.createLogger({
          level: "debug",
          transports: [new SpyTransport({ level: "debug" }, { spy: spy })],
        });

        collateralToken = await Token.new("BTC", "BTC", 8).send({ from: contractCreator });
        syntheticToken = await SyntheticToken.new("Test Synthetic Token", "SYNTH", 18).send({ from: contractCreator });
        // For this test we are using a lower decimal identifier, USDBTC. First we need to add it to the whitelist.
        await identifierWhitelist.methods
          .addSupportedIdentifier(padRight(utf8ToHex("USDBTC"), 64))
          .send({ from: contractCreator });
        const decimalTestConstructorParams = JSON.parse(
          JSON.stringify({
            ...constructorParams,
            collateralAddress: collateralToken.options.address,
            tokenAddress: syntheticToken.options.address,
            priceFeedIdentifier: padRight(utf8ToHex("USDBTC"), 64),
          })
        );
        financialContract = await FinancialContract.new(decimalTestConstructorParams).send({ from: contractCreator });
        await syntheticToken.methods.addMinter(financialContract.options.address).send({ from: contractCreator });
        await syntheticToken.methods.addBurner(financialContract.options.address).send({ from: contractCreator });

        // Note the execution below does not have a price feed included. It should be pulled from the default USDBTC config.
        await Poll.run({
          logger: spyLogger,
          web3,
          financialContractAddress: financialContract.options.address,
          pollingDelay,
          errorRetries,
          errorRetriesTimeout,
        });

        // Seventh log, which prints the decimal info, should include # of decimals for the price feed, collateral and synthetic.
        // The "7th" log is pretty arbitrary. This is simply the log message that is produced at the end of initialization
        // under `Liquidator initialized`. It does however contain the decimal info, which is what we really care about.
        assert.isTrue(spyLogIncludes(spy, 8, '"collateralDecimals":8'));
        assert.isTrue(spyLogIncludes(spy, 8, '"syntheticDecimals":18'));
        assert.isTrue(spyLogIncludes(spy, 8, '"priceFeedDecimals":8'));
      });

      it("Allowances are set", async function () {
        await Poll.run({
          logger: spyLogger,
          web3,
          financialContractAddress: financialContract.options.address,
          pollingDelay,
          errorRetries,
          errorRetriesTimeout,
          priceFeedConfig: defaultPriceFeedConfig,
        });

        const collateralAllowance = await collateralToken.methods
          .allowance(contractCreator, financialContract.options.address)
          .call();
        assert.equal(collateralAllowance.toString(), MAX_UINT_VAL);
      });

      it("Completes one iteration without logging any errors", async function () {
        await Poll.run({
          logger: spyLogger,
          web3,
          financialContractAddress: financialContract.options.address,
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
          financialContractAddress: financialContract.options.address,
          pollingDelay,
          errorRetries,
          errorRetriesTimeout,
          priceFeedConfig: defaultPriceFeedConfig,
        });

        for (let i = 0; i < spy.callCount; i++) {
          assert.notEqual(spyLogLevel(spy, i), "error");
        }

        // To verify decimal detection is correct for a standard feed, check the fifth log to see it matches expected.
        assert.isTrue(spyLogIncludes(spy, 6, `"contractVersion":"${contractVersion.contractVersion}"`));
        assert.isTrue(spyLogIncludes(spy, 6, `"contractType":"${contractVersion.contractType}"`));

        // Should produce an error on a contract type that is unknown. set the financialContract as the finder, for example
        let didThrowError = false;
        try {
          await Poll.run({
            logger: spyLogger,
            web3,
            financialContractAddress: finder.options.address,
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
        await identifierWhitelist.methods.addSupportedIdentifier(utf8ToHex("UNKNOWN")).send({ from: contractCreator });

        const PricelessPositionManager = await getContract("PricelessPositionManager");

        const invalidFinancialContract = await PricelessPositionManager.new(
          constructorParams.expirationTimestamp,
          constructorParams.withdrawalLiveness,
          constructorParams.collateralAddress,
          constructorParams.tokenAddress,
          constructorParams.finderAddress,
          utf8ToHex("UNKNOWN"),
          constructorParams.minSponsorTokens,
          constructorParams.timerAddress,
          ZERO_ADDRESS
        ).send({ from: contractCreator });

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
            financialContractAddress: invalidFinancialContract.options.address,
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
        let reTryCounts = { gasEstimatorUpdate: 0, executionLoopErrors: 0 };
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

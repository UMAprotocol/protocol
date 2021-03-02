const { toWei, toBN, utf8ToHex, padRight } = web3.utils;
const winston = require("winston");
const sinon = require("sinon");
const {
  PostWithdrawLiquidationRewardsStatusTranslations,
  LiquidationStatesEnum,
  MAX_UINT_VAL,
  interfaceName,
  ZERO_ADDRESS,
  runTestForVersion,
  createConstructorParamsForContractVersion,
  TESTED_CONTRACT_VERSIONS,
  parseFixed
} = require("@uma/common");
const { getTruffleContract } = require("@uma/core");

// Script to test
const { Disputer } = require("../src/disputer.js");

// Helper clients and custom winston transport module to monitor winston log outputs
const { FinancialContractClient, GasEstimator, PriceFeedMock, SpyTransport } = require("@uma/financial-templates-lib");

// Run the tests against 3 different kinds of token/synth decimal combinations:
// 1) matching 18 & 18 for collateral for most token types with normal tokens.
// 2) non-matching 8 collateral & 18 synthetic for legacy UMA synthetics.
// 3) matching 8 collateral & 8 synthetic for current UMA synthetics.
const configs = [
  { tokenSymbol: "WETH", collateralDecimals: 18, syntheticDecimals: 18, priceFeedDecimals: 18 },
  { tokenSymbol: "BTC", collateralDecimals: 8, syntheticDecimals: 18, priceFeedDecimals: 8 },
  { tokenSymbol: "BTC", collateralDecimals: 8, syntheticDecimals: 8, priceFeedDecimals: 18 }
];

let iterationTestVersion; // store the test version between tests that is currently being tested.
const startTime = "15798990420";
const unreachableDeadline = MAX_UINT_VAL;

// Common contract objects.
let collateralToken;
let financialContract;
let syntheticToken;
let mockOracle;
let store;
let timer;
let identifierWhitelist;
let finder;
let collateralWhitelist;
let optimisticOracle;
let configStore;
let constructorParams;

// Js Objects, clients and helpers
let spy;
let spyLogger;
let priceFeedMock;
let financialContractProps;
let disputerConfig;
let identifier;
let fundingRateIdentifier;
let convertCollateral;
let convertSynthetic;
let convertPrice;
let gasEstimator;
let financialContractClient;
let disputer;

// Set the funding rate and advances time by 10k seconds.
const _setFundingRateAndAdvanceTime = async fundingRate => {
  const currentTime = (await financialContract.getCurrentTime()).toNumber();
  await financialContract.proposeFundingRate({ rawValue: fundingRate }, currentTime);
  await financialContract.setCurrentTime(currentTime + 10000);
};

// If the current version being executed is part of the `supportedVersions` array then return `it` to run the test.
// Else, do nothing. Can be used exactly in place of a normal `it` to parameterize contract types and versions supported
// for a given test.eg: versionedversionedIt([{ contractType: "any", contractVersion: "any" }])(["Perpetual-latest"])("test name", async function () { assert.isTrue(true) })
// Note that a second param can be provided to make the test an `it.only` thereby ONLY running that single test, on
// the provided version. This is very useful for debugging and writing single unit tests without having ro run all tests.
const versionedIt = function(supportedVersions, shouldBeItOnly = false) {
  if (shouldBeItOnly)
    return runTestForVersion(supportedVersions, TESTED_CONTRACT_VERSIONS, iterationTestVersion) ? it.only : () => {};
  return runTestForVersion(supportedVersions, TESTED_CONTRACT_VERSIONS, iterationTestVersion) ? it : () => {};
};

const Convert = decimals => number => (number ? parseFixed(number.toString(), decimals).toString() : number);

contract("Disputer.js", function(accounts) {
  const disputeBot = accounts[0];
  const sponsor1 = accounts[1];
  const sponsor2 = accounts[2];
  const sponsor3 = accounts[3];
  const liquidator = accounts[4];
  const contractCreator = accounts[5];
  const rando = accounts[6];

  TESTED_CONTRACT_VERSIONS.forEach(function(contractVersion) {
    // Store the contractVersion.contractVersion, type and version being tested
    iterationTestVersion = contractVersion;

    // Import the tested versions of contracts. note that financialContract is either an ExpiringMultiParty or a
    // Perpetual depending on the current iteration version.
    const FinancialContract = getTruffleContract(contractVersion.contractType, web3, contractVersion.contractVersion);
    const Finder = getTruffleContract("Finder", web3, contractVersion.contractVersion);
    const IdentifierWhitelist = getTruffleContract("IdentifierWhitelist", web3, contractVersion.contractVersion);
    const AddressWhitelist = getTruffleContract("AddressWhitelist", web3, contractVersion.contractVersion);
    const MockOracle = getTruffleContract("MockOracle", web3, contractVersion.contractVersion);
    const Token = getTruffleContract("ExpandedERC20", web3, contractVersion.contractVersion);
    const SyntheticToken = getTruffleContract("SyntheticToken", web3, contractVersion.contractVersion);
    const Timer = getTruffleContract("Timer", web3, contractVersion.contractVersion);
    const Store = getTruffleContract("Store", web3, contractVersion.contractVersion);
    const ConfigStore = getTruffleContract("ConfigStore", web3, "latest");
    const OptimisticOracle = getTruffleContract("OptimisticOracle", web3, "latest");

    for (let testConfig of configs) {
      describe(`${testConfig.collateralDecimals} collateral, ${testConfig.syntheticDecimals} synthetic & ${testConfig.priceFeedDecimals} pricefeed decimals, on for smart contract version ${contractVersion.contractType} @ ${contractVersion.contractVersion}`, function() {
        before(async function() {
          identifier = `${testConfig.tokenName}TEST`;
          fundingRateIdentifier = `${testConfig.tokenName}_FUNDING_IDENTIFIER`;
          convertCollateral = Convert(testConfig.collateralDecimals);
          convertSynthetic = Convert(testConfig.syntheticDecimals);
          convertPrice = Convert(testConfig.priceFeedDecimals);

          collateralToken = await Token.new(
            testConfig.tokenSymbol + " Token", // Construct the token name.
            testConfig.tokenSymbol,
            testConfig.collateralDecimals,
            {
              from: contractCreator
            }
          );

          await collateralToken.addMember(1, contractCreator, {
            from: contractCreator
          });

          // Seed the accounts.
          await collateralToken.mint(sponsor1, convertCollateral("100000"), { from: contractCreator });
          await collateralToken.mint(sponsor2, convertCollateral("100000"), { from: contractCreator });
          await collateralToken.mint(sponsor3, convertCollateral("100000"), { from: contractCreator });
          await collateralToken.mint(liquidator, convertCollateral("100000"), { from: contractCreator });
          await collateralToken.mint(disputeBot, convertCollateral("100000"), { from: contractCreator });

          // Create identifier whitelist and register the price tracking ticker with it.
          identifierWhitelist = await IdentifierWhitelist.new();
          finder = await Finder.new();
          timer = await Timer.new();
          store = await Store.new({ rawValue: "0" }, { rawValue: "0" }, timer.address);
          await finder.changeImplementationAddress(utf8ToHex(interfaceName.Store), store.address);

          await finder.changeImplementationAddress(
            utf8ToHex(interfaceName.IdentifierWhitelist),
            identifierWhitelist.address
          );

          collateralWhitelist = await AddressWhitelist.new();
          await finder.changeImplementationAddress(
            utf8ToHex(interfaceName.CollateralWhitelist),
            collateralWhitelist.address
          );
          await collateralWhitelist.addToWhitelist(collateralToken.address);
        });
        beforeEach(async function() {
          await timer.setCurrentTime(startTime - 1);
          mockOracle = await MockOracle.new(finder.address, timer.address, {
            from: contractCreator
          });
          await finder.changeImplementationAddress(utf8ToHex(interfaceName.Oracle), mockOracle.address);

          // Create a new synthetic token
          syntheticToken = await SyntheticToken.new("Test Synthetic Token", "SYNTH", testConfig.syntheticDecimals);

          // If we are testing a perpetual then we need to also deploy a config store, an optimistic oracle and set the funding rate identifier.
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
            await finder.changeImplementationAddress(
              utf8ToHex(interfaceName.OptimisticOracle),
              optimisticOracle.address
            );
          }

          constructorParams = await createConstructorParamsForContractVersion(
            contractVersion,
            {
              convertSynthetic,
              finder,
              collateralToken,
              syntheticToken,
              identifier,
              fundingRateIdentifier,
              timer,
              store,
              configStore: configStore || {} // if the contract type is not a perp this will be null.
            },
            { minSponsorTokens: { rawValue: convertSynthetic("1") } } // these tests assume a min sponsor size of 1, not 5 as default
          );

          await identifierWhitelist.addSupportedIdentifier(constructorParams.priceFeedIdentifier, {
            from: accounts[0]
          });

          // Deploy a new expiring multi party OR perpetual, depending on what the financialContract has been set to.
          financialContract = await FinancialContract.new(constructorParams);
          // If we are testing a perpetual then we need to apply the initial funding rate to start the timer.
          await financialContract.setCurrentTime(startTime);
          if (contractVersion.contractType == "Perpetual") await financialContract.applyFundingRate();
          await syntheticToken.addMinter(financialContract.address);
          await syntheticToken.addBurner(financialContract.address);

          // Generate Financial Contract properties to inform bot of important on-chain state values that we only want to query once.
          financialContractProps = {
            priceIdentifier: await financialContract.priceIdentifier()
          };

          await collateralToken.approve(financialContract.address, convertCollateral("100000000"), { from: sponsor1 });
          await collateralToken.approve(financialContract.address, convertCollateral("100000000"), { from: sponsor2 });
          await collateralToken.approve(financialContract.address, convertCollateral("100000000"), { from: sponsor3 });
          await collateralToken.approve(financialContract.address, convertCollateral("100000000"), {
            from: liquidator
          });
          await collateralToken.approve(financialContract.address, convertCollateral("100000000"), {
            from: disputeBot
          });

          syntheticToken = await Token.at(await financialContract.tokenCurrency());
          await syntheticToken.approve(financialContract.address, convertSynthetic("100000000"), { from: sponsor1 });
          await syntheticToken.approve(financialContract.address, convertSynthetic("100000000"), { from: sponsor2 });
          await syntheticToken.approve(financialContract.address, convertSynthetic("100000000"), { from: sponsor3 });
          await syntheticToken.approve(financialContract.address, convertSynthetic("100000000"), { from: liquidator });
          await syntheticToken.approve(financialContract.address, convertSynthetic("100000000"), { from: disputeBot });

          spy = sinon.spy();

          spyLogger = winston.createLogger({
            level: "info",
            transports: [new SpyTransport({ level: "info" }, { spy: spy })]
          });

          // Create a new instance of the FinancialContractClient & GasEstimator to construct the disputer
          financialContractClient = new FinancialContractClient(
            spyLogger,
            FinancialContract.abi,
            web3,
            financialContract.address,
            testConfig.collateralDecimals,
            testConfig.syntheticDecimals,
            testConfig.priceFeedDecimals
          );
          gasEstimator = new GasEstimator(spyLogger);

          // Create a new instance of the disputer to test
          disputerConfig = {
            disputeDelay: 0,
            contractType: contractVersion.contractType,
            contractVersion: contractVersion.contractVersion
          };

          // Create price feed mock.
          priceFeedMock = new PriceFeedMock(undefined, undefined, undefined, undefined, testConfig.collateralDecimals);

          disputer = new Disputer({
            logger: spyLogger,
            financialContractClient: financialContractClient,
            gasEstimator,
            priceFeed: priceFeedMock,
            account: accounts[0],
            financialContractProps,
            disputerConfig
          });
        });

        versionedIt([{ contractType: "any", contractVersion: "any" }])(
          "Detect disputable positions and send disputes",
          async function() {
            // sponsor1 creates a position with 125 units of collateral, creating 100 synthetic tokens.
            await financialContract.create(
              { rawValue: convertCollateral("125") },
              { rawValue: convertSynthetic("100") },
              { from: sponsor1 }
            );

            // sponsor2 creates a position with 150 units of collateral, creating 100 synthetic tokens.
            await financialContract.create(
              { rawValue: convertCollateral("150") },
              { rawValue: convertSynthetic("100") },
              { from: sponsor2 }
            );

            // sponsor3 creates a position with 175 units of collateral, creating 100 synthetic tokens.
            await financialContract.create(
              { rawValue: convertCollateral("175") },
              { rawValue: convertSynthetic("100") },
              { from: sponsor3 }
            );

            // The liquidator creates a position to have synthetic tokens.
            await financialContract.create(
              { rawValue: convertCollateral("1000") },
              { rawValue: convertSynthetic("500") },
              { from: liquidator }
            );

            await financialContract.createLiquidation(
              sponsor1,
              { rawValue: "0" },
              { rawValue: convertPrice("1.75") },
              { rawValue: convertSynthetic("100") },
              unreachableDeadline,
              { from: liquidator }
            );
            await financialContract.createLiquidation(
              sponsor2,
              { rawValue: "0" },
              { rawValue: convertPrice("1.75") },
              { rawValue: convertSynthetic("100") },
              unreachableDeadline,
              { from: liquidator }
            );
            await financialContract.createLiquidation(
              sponsor3,
              { rawValue: "0" },
              { rawValue: convertPrice("1.75") },
              { rawValue: convertSynthetic("100") },
              unreachableDeadline,
              { from: liquidator }
            );

            // Try disputing before any mocked prices are set, simulating a situation where the pricefeed
            // fails to return a price. The disputer should emit a "warn" level log about each missing prices.
            await disputer.update();
            const earliestLiquidationTime = Number(
              financialContractClient.getUndisputedLiquidations()[0].liquidationTime
            );
            priceFeedMock.setLastUpdateTime(earliestLiquidationTime);
            await disputer.dispute();
            assert.equal(spy.callCount, 3); // 3 warn level logs should be sent for 3 missing prices

            // Start with a mocked price of 1.75 usd per token.
            // This makes all sponsors undercollateralized, meaning no disputes are issued.
            priceFeedMock.setHistoricalPrice(convertPrice("1.75"));
            await disputer.update();
            await disputer.dispute();

            // There should be no liquidations created from any sponsor account
            assert.equal(
              (await financialContract.getLiquidations(sponsor1))[0].state,
              LiquidationStatesEnum.PRE_DISPUTE
            );
            assert.equal(
              (await financialContract.getLiquidations(sponsor2))[0].state,
              LiquidationStatesEnum.PRE_DISPUTE
            );
            assert.equal(
              (await financialContract.getLiquidations(sponsor3))[0].state,
              LiquidationStatesEnum.PRE_DISPUTE
            );
            assert.equal(spy.callCount, 3); // No info level logs should be sent.

            // With a price of 1.1, two sponsors should be correctly collateralized, so disputes should be issued against sponsor2 and sponsor3's liquidations.
            priceFeedMock.setHistoricalPrice(convertPrice("1.1"));

            // Disputing a timestamp that is before the pricefeed's lookback window will do nothing and print no warnings:
            // Set earliest timestamp to AFTER the liquidation:
            priceFeedMock.setLastUpdateTime(earliestLiquidationTime + 2);
            priceFeedMock.setLookback(1);
            await disputer.update();
            await disputer.dispute();
            // There should be no liquidations created from any sponsor account
            assert.equal(
              (await financialContract.getLiquidations(sponsor1))[0].state,
              LiquidationStatesEnum.PRE_DISPUTE
            );
            assert.equal(
              (await financialContract.getLiquidations(sponsor2))[0].state,
              LiquidationStatesEnum.PRE_DISPUTE
            );
            assert.equal(
              (await financialContract.getLiquidations(sponsor3))[0].state,
              LiquidationStatesEnum.PRE_DISPUTE
            );
            assert.equal(spy.callCount, 3); // No info level logs should be sent.

            // Now, set lookback such that the liquidation timestamp is captured and the dispute should go through:
            priceFeedMock.setLookback(2);
            await disputer.update();
            await disputer.dispute();
            assert.equal(spy.callCount, 5); // 2 info level logs should be sent at the conclusion of the disputes.

            // Sponsor2 and sponsor3 should be disputed.
            assert.equal(
              (await financialContract.getLiquidations(sponsor1))[0].state,
              LiquidationStatesEnum.PRE_DISPUTE
            );
            assert.equal(
              (await financialContract.getLiquidations(sponsor2))[0].state,
              LiquidationStatesEnum.PENDING_DISPUTE
            );
            assert.equal(
              (await financialContract.getLiquidations(sponsor3))[0].state,
              LiquidationStatesEnum.PENDING_DISPUTE
            );

            // The disputeBot should be the disputer in sponsor2 and sponsor3's liquidations.
            assert.equal((await financialContract.getLiquidations(sponsor2))[0].disputer, disputeBot);
            assert.equal((await financialContract.getLiquidations(sponsor3))[0].disputer, disputeBot);
          }
        );

        versionedIt([{ contractType: "any", contractVersion: "any" }])(
          "Detect disputable withdraws and send disputes",
          async function() {
            // sponsor1 creates a position with 125 units of collateral, creating 100 synthetic tokens.
            await financialContract.create(
              { rawValue: convertCollateral("125") },
              { rawValue: convertSynthetic("100") },
              { from: sponsor1 }
            );

            // The liquidator creates a position to have synthetic tokens.
            await financialContract.create(
              { rawValue: convertCollateral("1000") },
              { rawValue: convertSynthetic("500") },
              { from: liquidator }
            );

            // The sponsor1 submits a valid withdrawal request of withdrawing exactly 5e18 collateral. This places their
            // position at collateral of 120 and debt of 100. At a price of 1 unit per token they are exactly collateralized.

            await financialContract.requestWithdrawal({ rawValue: convertCollateral("5") }, { from: sponsor1 });

            await financialContract.createLiquidation(
              sponsor1,
              { rawValue: "0" },
              { rawValue: convertPrice("1.75") }, // Price high enough to initiate the liquidation
              { rawValue: convertSynthetic("100") },
              unreachableDeadline,
              { from: liquidator }
            );

            // With a price of 1 usd per token this withdrawal was actually valid, even though it's very close to liquidation.
            // This makes all sponsors undercollateralized, meaning no disputes are issued.
            priceFeedMock.setHistoricalPrice(convertPrice("1"));
            await disputer.update();
            await disputer.dispute();
            assert.equal(spy.callCount, 1); // 1 info level logs should be sent at the conclusion of the disputes.

            // Sponsor1 should be disputed.
            assert.equal(
              (await financialContract.getLiquidations(sponsor1))[0].state,
              LiquidationStatesEnum.PENDING_DISPUTE
            );

            // The disputeBot should be the disputer in sponsor1  liquidations.
            assert.equal((await financialContract.getLiquidations(sponsor1))[0].disputer, disputeBot);

            // Push a price of 1, which should cause sponsor1's dispute to succeed as the position is correctly collateralized
            // at a price of 1.
            const liquidationTime = await financialContract.getCurrentTime();
            await mockOracle.pushPrice(web3.utils.utf8ToHex(identifier), liquidationTime, convertPrice("1"));

            await disputer.update();
            await disputer.withdrawRewards();
            assert.equal(spy.callCount, 2); // One additional info level event for the successful withdrawal.

            // sponsor1's dispute should be successful (valid withdrawal)
            // Note the check below has a bit of switching logic that is version specific to accommodate the change in withdrawal behaviour.
            assert.equal(
              (await financialContract.getLiquidations(sponsor1))[0].state,
              contractVersion.contractVersion == "1.2.2"
                ? LiquidationStatesEnum.DISPUTE_SUCCEEDED
                : LiquidationStatesEnum.UNINITIALIZED
            );
          }
        );

        versionedIt([{ contractType: "any", contractVersion: "any" }])(
          "Withdraw from successful disputes",
          async function() {
            // sponsor1 creates a position with 150 units of collateral, creating 100 synthetic tokens.
            await financialContract.create(
              { rawValue: convertCollateral("150") },
              { rawValue: convertSynthetic("100") },
              { from: sponsor1 }
            );

            // sponsor2 creates a position with 175 units of collateral, creating 100 synthetic tokens.
            await financialContract.create(
              { rawValue: convertCollateral("175") },
              { rawValue: convertSynthetic("100") },
              { from: sponsor2 }
            );

            // The liquidator creates a position to have synthetic tokens.
            await financialContract.create(
              { rawValue: convertCollateral("1000") },
              { rawValue: convertSynthetic("500") },
              { from: liquidator }
            );

            await financialContract.createLiquidation(
              sponsor1,
              { rawValue: "0" },
              { rawValue: convertPrice("1.75") },
              { rawValue: convertSynthetic("100") },
              unreachableDeadline,
              { from: liquidator }
            );

            await financialContract.createLiquidation(
              sponsor2,
              { rawValue: "0" },
              { rawValue: convertPrice("1.75") },
              { rawValue: convertSynthetic("100") },
              unreachableDeadline,
              { from: liquidator }
            );

            // With a price of 1.1, the sponsors should be correctly collateralized, so disputes should be issued against sponsor1 and sponsor2's liquidations.
            priceFeedMock.setHistoricalPrice(convertPrice("1.1"));
            await disputer.update();
            await disputer.dispute();
            assert.equal(spy.callCount, 2); // Two info level events for the two disputes.

            // Before the dispute is resolved, the bot should simulate the withdrawal, determine that it will fail, and
            // continue to wait.
            await disputer.update();
            await disputer.withdrawRewards();

            // No new info or error logs should appear because no attempted withdrawal should be made.
            assert.equal(spy.callCount, 2);

            // Push a price of 1.3, which should cause sponsor1's dispute to fail and sponsor2's dispute to succeed.
            const liquidationTime = await financialContract.getCurrentTime();
            await mockOracle.pushPrice(web3.utils.utf8ToHex(identifier), liquidationTime, convertPrice("1.3"));

            await disputer.update();
            await disputer.withdrawRewards();
            assert.equal(spy.callCount, 3); // One additional info level event for the successful withdrawal.

            // sponsor1's dispute was unsuccessful, so the disputeBot should not have called the withdraw method.
            assert.equal((await financialContract.getLiquidations(sponsor1))[0].disputer, disputeBot);
            assert.equal(
              (await financialContract.getLiquidations(sponsor1))[0].state,
              LiquidationStatesEnum.PENDING_DISPUTE
            );

            // sponsor2's dispute was successful, so the disputeBot should've called the withdraw method.
            assert.equal((await financialContract.getLiquidations(sponsor2))[0].disputer, ZERO_ADDRESS);
            assert.equal(
              (await financialContract.getLiquidations(sponsor2))[0].state,
              contractVersion.contractVersion == "1.2.2"
                ? LiquidationStatesEnum.DISPUTE_SUCCEEDED
                : LiquidationStatesEnum.UNINITIALIZED
            );

            // Check that the log includes a human readable translation of the liquidation status, and the dispute price.
            assert.equal(
              spy.getCall(-1).lastArg.liquidationResult.liquidationStatus,
              PostWithdrawLiquidationRewardsStatusTranslations[LiquidationStatesEnum.DISPUTE_SUCCEEDED]
            );
            assert.equal(spy.getCall(-1).lastArg.liquidationResult.settlementPrice, convertPrice("1.3"));

            // Check that the log contains the dispute rewards:
            if (disputer.isLegacyEmpVersion) {
              assert.isTrue(toBN(spy.getCall(-1).lastArg.liquidationResult.withdrawalAmount).gt(0));
            } else {
              assert.isTrue(toBN(spy.getCall(-1).lastArg.liquidationResult.paidToLiquidator).gt(0));
              assert.isTrue(toBN(spy.getCall(-1).lastArg.liquidationResult.paidToSponsor).gt(0));
              assert.isTrue(toBN(spy.getCall(-1).lastArg.liquidationResult.paidToDisputer).gt(0));
            }

            // After the dispute is resolved, the liquidation should still exist but the disputer should no longer be able to withdraw any rewards.
            await disputer.update();
            await disputer.withdrawRewards();
            assert.equal(spy.callCount, 3);
          }
        );

        versionedIt([{ contractType: "any", contractVersion: "any" }])("Too little collateral", async function() {
          // sponsor1 creates a position with 150 units of collateral, creating 100 synthetic tokens.
          await financialContract.create(
            { rawValue: convertCollateral("150") },
            { rawValue: convertSynthetic("100") },
            { from: sponsor1 }
          );

          // sponsor2 creates a position with 1.75 units of collateral, creating 1 synthetic tokens.
          await financialContract.create(
            { rawValue: convertCollateral("1.75") },
            { rawValue: convertSynthetic("1") },
            { from: sponsor2 }
          );

          // The liquidator creates a position to have synthetic tokens.
          await financialContract.create(
            { rawValue: convertCollateral("1000") },
            { rawValue: convertSynthetic("500") },
            { from: liquidator }
          );

          await financialContract.createLiquidation(
            sponsor1,
            { rawValue: "0" },
            { rawValue: convertPrice("1.75") },
            { rawValue: convertSynthetic("100") },
            unreachableDeadline,
            { from: liquidator }
          );

          await financialContract.createLiquidation(
            sponsor2,
            { rawValue: "0" },
            { rawValue: convertPrice("1.75") },
            { rawValue: convertSynthetic("1") },
            unreachableDeadline,
            { from: liquidator }
          );

          // Send most of the user's balance elsewhere leaving only enough to dispute sponsor1's position.
          const transferAmount = (await collateralToken.balanceOf(disputeBot)).sub(toBN(convertCollateral("1")));
          await collateralToken.transfer(rando, transferAmount, { from: disputeBot });

          // Both positions should be disputed with a presumed price of 1.1, but will only have enough collateral for the smaller one.
          priceFeedMock.setHistoricalPrice(convertPrice("1.1"));
          await disputer.update();
          await disputer.dispute();
          assert.equal(spy.callCount, 2); // Two info events for the the 1 successful dispute and one for the failed dispute.

          // Only sponsor2 should be disputed.
          assert.equal((await financialContract.getLiquidations(sponsor1))[0].state, LiquidationStatesEnum.PRE_DISPUTE);
          assert.equal(
            (await financialContract.getLiquidations(sponsor2))[0].state,
            LiquidationStatesEnum.PENDING_DISPUTE
          );

          // Transfer balance back, and the dispute should go through.
          await collateralToken.transfer(disputeBot, transferAmount, { from: rando });
          priceFeedMock.setHistoricalPrice(convertPrice("1.1"));
          await disputer.update();
          await disputer.dispute();
          assert.equal(spy.callCount, 3); // Info level event for the correctly processed dispute.

          // sponsor1 should now be disputed.
          assert.equal(
            (await financialContract.getLiquidations(sponsor1))[0].state,
            LiquidationStatesEnum.PENDING_DISPUTE
          );
        });

        describe("Overrides the default disputer configuration settings", function() {
          versionedIt([{ contractType: "any", contractVersion: "any" }])(
            "Cannot set `disputeDelay` < 0",
            async function() {
              let errorThrown;
              try {
                disputerConfig = { ...disputerConfig, disputeDelay: -1 };
                disputer = new Disputer({
                  logger: spyLogger,
                  financialContractClient: financialContractClient,
                  gasEstimator,
                  priceFeed: priceFeedMock,
                  account: accounts[0],
                  financialContractProps,
                  disputerConfig
                });
                errorThrown = false;
              } catch (err) {
                errorThrown = true;
              }
              assert.isTrue(errorThrown);
            }
          );

          versionedIt([{ contractType: "any", contractVersion: "any" }])(
            "Sets `disputeDelay` to 60 seconds",
            async function() {
              disputerConfig = { ...disputerConfig, disputeDelay: 60 };
              disputer = new Disputer({
                logger: spyLogger,
                financialContractClient: financialContractClient,
                gasEstimator,
                priceFeed: priceFeedMock,
                account: accounts[0],
                financialContractProps,
                disputerConfig
              });

              // sponsor1 creates a position with 150 units of collateral, creating 100 synthetic tokens.
              await financialContract.create(
                { rawValue: convertCollateral("150") },
                { rawValue: convertSynthetic("100") },
                { from: sponsor1 }
              );

              // The liquidator creates a position to have synthetic tokens.
              await financialContract.create(
                { rawValue: convertCollateral("1000") },
                { rawValue: convertSynthetic("500") },
                { from: liquidator }
              );

              await financialContract.createLiquidation(
                sponsor1,
                { rawValue: "0" },
                { rawValue: convertPrice("1.75") },
                { rawValue: convertSynthetic("100") },
                unreachableDeadline,
                { from: liquidator }
              );
              const liquidationTime = await financialContract.getCurrentTime();

              // With a price of 1.1, sponsor1 should be correctly collateralized, so a dispute should be issued. However,
              // not enough time has passed since the liquidation timestamp, so we'll delay disputing for now. The
              // `disputeDelay` configuration enforces that we must wait `disputeDelay` seconds after the liquidation
              // timestamp before disputing.
              priceFeedMock.setHistoricalPrice(convertPrice("1.1"));
              await disputer.update();
              await disputer.dispute();
              assert.equal(spy.callCount, 0);

              // Sponsor1 should not be disputed.
              assert.equal(
                (await financialContract.getLiquidations(sponsor1))[0].state,
                LiquidationStatesEnum.PRE_DISPUTE
              );

              // Advance contract time and attempt to dispute again.
              await financialContract.setCurrentTime(Number(liquidationTime) + disputerConfig.disputeDelay);

              priceFeedMock.setHistoricalPrice(convertPrice("1.1"));
              await disputer.update();
              await disputer.dispute();
              assert.equal(spy.callCount, 1);

              // The disputeBot should be the disputer in sponsor1's liquidations.
              assert.equal(
                (await financialContract.getLiquidations(sponsor1))[0].state,
                LiquidationStatesEnum.PENDING_DISPUTE
              );
              assert.equal((await financialContract.getLiquidations(sponsor1))[0].disputer, disputeBot);
            }
          );

          versionedIt([{ contractType: "any", contractVersion: "any" }])(
            "Can provide an override price to disputer",
            async function() {
              // sponsor1 creates a position with 130 units of collateral, creating 100 synthetic tokens.
              await financialContract.create(
                { rawValue: convertCollateral("130") },
                { rawValue: convertSynthetic("100") },
                { from: sponsor1 }
              );

              // The liquidator creates a position to have synthetic tokens.
              await financialContract.create(
                { rawValue: convertCollateral("1000") },
                { rawValue: convertSynthetic("500") },
                { from: liquidator }
              );

              // The sponsor1 submits a valid withdrawal request of withdrawing 5e18 collateral. This places their
              // position at collateral of 125 and debt of 100.
              await financialContract.requestWithdrawal({ rawValue: convertCollateral("5") }, { from: sponsor1 });

              // Next, we will create an invalid liquidation to liquidate the whole position.
              await financialContract.createLiquidation(
                sponsor1,
                { rawValue: "0" },
                { rawValue: convertPrice("1.75") }, // Price high enough to initiate the liquidation
                { rawValue: convertSynthetic("100") },
                unreachableDeadline,
                { from: liquidator }
              );

              // Say the price feed reports a price of 1 USD per token. This makes the liquidation invalid and the disputer should
              // dispute the liquidation: 125/(100*1.0)=1.25 CR -> Position was collateralized and invalid liquidation.
              priceFeedMock.setHistoricalPrice(convertPrice("1"));

              // However, say disputer operator has provided an override price of 1.2 USD per token. This makes the liquidation
              // valid and the disputer should do nothing: 125/(100*1.2)=1.0
              await disputer.update();
              const earliestLiquidationTime = Number(
                financialContractClient.getUndisputedLiquidations()[0].liquidationTime
              );
              priceFeedMock.setLastUpdateTime(earliestLiquidationTime);
              await disputer.dispute(convertPrice("1.2"));
              assert.equal(spy.callCount, 0); // 0 info level logs should be sent as no dispute.
              assert.equal(
                (await financialContract.getLiquidations(sponsor1))[0].state,
                LiquidationStatesEnum.PRE_DISPUTE
              );

              // Next assume that the override price is in fact 1 USD per token. At this price point the liquidation is now
              // invalid that the disputer should try dispute the tx. This should work even if the liquidation timestamp is
              // earlier than the price feed's earliest available timestamp:
              priceFeedMock.setLastUpdateTime(earliestLiquidationTime + 2);
              priceFeedMock.setLookback(1);
              await disputer.update();
              await disputer.dispute(convertPrice("1.0"));
              assert.equal(spy.callCount, 1); // 1 info level logs should be sent for the dispute
              assert.equal(
                (await financialContract.getLiquidations(sponsor1))[0].state,
                LiquidationStatesEnum.PENDING_DISPUTE
              );

              // The disputeBot should be the disputer in sponsor1  liquidations.
              assert.equal((await financialContract.getLiquidations(sponsor1))[0].disputer, disputeBot);
            }
          );
          describe("disputer correctly deals with funding rates from perpetual contract", () => {
            versionedIt([{ contractType: "Perpetual", contractVersion: "latest" }])(
              "Can correctly detect invalid liquidations and dispute them",
              async function() {
                // sponsor1 creates a position with 125 units of collateral, creating 100 synthetic tokens.
                await financialContract.create(
                  { rawValue: convertCollateral("125") },
                  { rawValue: convertSynthetic("100") },
                  { from: sponsor1 }
                );

                // sponsor2 creates a position with 150 units of collateral, creating 100 synthetic tokens.
                await financialContract.create(
                  { rawValue: convertCollateral("150") },
                  { rawValue: convertSynthetic("100") },
                  { from: sponsor2 }
                );

                // sponsor3 creates a position with 175 units of collateral, creating 100 synthetic tokens.
                await financialContract.create(
                  { rawValue: convertCollateral("175") },
                  { rawValue: convertSynthetic("100") },
                  { from: sponsor3 }
                );

                // liquidator creates a position with 2000 units of collateral, creating 1000 synthetic tokens for creating
                // liquidations.
                await financialContract.create(
                  { rawValue: convertCollateral("2000") },
                  { rawValue: convertSynthetic("1000") },
                  { from: liquidator }
                );

                // Assume the current real token price is 1.1. This would place sponsor 1 at an undercollateralized CR
                // with 125/(100*1.1) = 1.136 (note no funding rate applied yet). If this sponsor is liquidated there
                // should be no dispute against them.

                // Liquidate the first sponsor.
                await financialContract.createLiquidation(
                  sponsor1,
                  { rawValue: "0" },
                  { rawValue: convertPrice("1.5") },
                  { rawValue: convertSynthetic("100") },
                  unreachableDeadline,
                  { from: liquidator }
                );

                priceFeedMock.setHistoricalPrice(convertPrice("1.1"));
                await disputer.update();
                await disputer.dispute();
                assert.equal(spy.callCount, 0); // No info level logs should be sent as no dispute.

                // There should be exactly one liquidation in sponsor1's account.
                let liquidationObject = (await financialContract.getLiquidations(sponsor1))[0];
                assert.equal(liquidationObject.sponsor, sponsor1);
                assert.equal(liquidationObject.liquidator, liquidator);
                assert.equal(liquidationObject.state, LiquidationStatesEnum.PRE_DISPUTE);
                assert.equal(liquidationObject.liquidatedCollateral.rawValue, convertCollateral("125"));
                assert.equal(liquidationObject.lockedCollateral.rawValue, convertCollateral("125"));

                // The liquidation should NOT be disputed
                assert.equal(
                  (await financialContract.getLiquidations(sponsor1))[0].state,
                  LiquidationStatesEnum.PRE_DISPUTE
                );

                // No other sponsors should have been liquidated.
                assert.deepStrictEqual(await financialContract.getLiquidations(sponsor2), []);
                assert.deepStrictEqual(await financialContract.getLiquidations(sponsor3), []);

                // Next, introduce some funding rate. Setting the funding rate multiplier to 1.08, results in modifying
                // sponsor's debt. This becomes 100 * 1.08 = 108. After applying this funding rate sponsor 2 should
                // still be correctly capitalized with 150 / (100 * 1.08 * 1.1) = 1.262. This is above 1.25 CR.
                // However, let's assume that an invalid liquidator sees this position and tries to liquidate it (incorrectly).
                // The disputer bot should dispute this liquidation and save the day.

                await _setFundingRateAndAdvanceTime(toWei("0.000008"));
                await financialContract.applyFundingRate();
                assert.equal((await financialContract.fundingRate()).cumulativeMultiplier.toString(), toWei("1.08"));

                // Liquidate the second sponsor.
                await financialContract.createLiquidation(
                  sponsor2,
                  { rawValue: "0" },
                  { rawValue: convertPrice("1.5") },
                  { rawValue: convertSynthetic("100") },
                  unreachableDeadline,
                  { from: liquidator }
                );
                const liquidation2Time = await financialContract.getCurrentTime();

                priceFeedMock.setHistoricalPrice(convertPrice("1.1"));
                await disputer.update();
                await disputer.dispute();
                assert.equal(spy.callCount, 1); // 1 info level logs should be sent for the dispute.

                // Sponsor 1 should be pre-dispute liquidation, sponsor 2 should be pending dispute and sponsor 3 should have nothing.
                assert.equal(
                  (await financialContract.getLiquidations(sponsor1))[0].state,
                  LiquidationStatesEnum.PRE_DISPUTE
                );
                liquidationObject = (await financialContract.getLiquidations(sponsor2))[0];
                assert.equal(liquidationObject.sponsor, sponsor2);
                assert.equal(liquidationObject.liquidator, liquidator);
                assert.equal(liquidationObject.disputer, disputeBot);
                assert.equal(liquidationObject.state, LiquidationStatesEnum.PENDING_DISPUTE);
                assert.equal(liquidationObject.liquidatedCollateral.rawValue, convertCollateral("150"));
                assert.equal(liquidationObject.lockedCollateral.rawValue, convertCollateral("150"));
                assert.deepStrictEqual(await financialContract.getLiquidations(sponsor3), []);

                // Next, we can test applying a large negative funding rate. Say we shift the funding rate by -0.1 two times.
                // this would work out to 1.08 * (1 - 0.00001 * 10000) * (1 - 0.00001 * 10000) = 0.8748. From this, token
                // sponsor debt has been decreased.
                await _setFundingRateAndAdvanceTime(toWei("-0.00001"));
                await financialContract.applyFundingRate();
                await _setFundingRateAndAdvanceTime(toWei("-0.00001"));
                await financialContract.applyFundingRate();
                assert.equal((await financialContract.fundingRate()).cumulativeMultiplier.toString(), toWei("0.8748"));

                // For the sake of this test let's assume that the liquidator is incorrectly configured and does not
                // consider the effects of funding rate in creating liquidations. With a set price of 1.5 the liquidation
                // "thinks" the CR is: 175 / (100 * 1.5) = 1.166 below CR (note no funding rate) but in actuality the "real"
                // CR is: 175 / (100 * 1.5*0.864) = 1.333 which is above CR, making the liquidation invalid (and disputable).

                // Liquidate the third sponsor.
                await financialContract.createLiquidation(
                  sponsor3,
                  { rawValue: "0" },
                  { rawValue: convertPrice("2") },
                  { rawValue: convertSynthetic("100") },
                  unreachableDeadline,
                  { from: liquidator }
                );
                const liquidation3Time = await financialContract.getCurrentTime();

                priceFeedMock.setHistoricalPrice(convertPrice("1.5"));
                await disputer.update();
                await disputer.dispute();
                assert.equal(spy.callCount, 2); // 1 additional info log for the new dispute.

                liquidationObject = (await financialContract.getLiquidations(sponsor3))[0];
                assert.equal(liquidationObject.sponsor, sponsor3);
                assert.equal(liquidationObject.liquidator, liquidator);
                assert.equal(liquidationObject.disputer, disputeBot);
                assert.equal(liquidationObject.state, LiquidationStatesEnum.PENDING_DISPUTE);
                assert.equal(liquidationObject.liquidatedCollateral.rawValue, convertCollateral("175"));
                assert.equal(liquidationObject.lockedCollateral.rawValue, convertCollateral("175"));

                // Finally, Push prices into the mock oracle to enable the disputes to settle.
                await mockOracle.pushPrice(web3.utils.utf8ToHex(identifier), liquidation2Time, convertPrice("1.1"));
                await mockOracle.pushPrice(web3.utils.utf8ToHex(identifier), liquidation3Time, convertPrice("1.5"));

                // Now that the liquidation has expired, the disputer can withdraw rewards.
                const collateralPreWithdraw = await collateralToken.balanceOf(disputeBot);
                await disputer.update();
                await disputer.withdrawRewards();

                assert.equal(spy.callCount, 4); // 2 new info level events should be sent for withdrawing the two liquidations.

                // Disputer should have their collateral increased from the two rewards.
                const collateralPostWithdraw = await collateralToken.balanceOf(disputeBot);
                assert.isTrue(collateralPostWithdraw.gt(collateralPreWithdraw));

                // Liquidation data should have been deleted.
                assert.deepStrictEqual(
                  (await financialContract.getLiquidations(sponsor1))[0].state,
                  LiquidationStatesEnum.PRE_DISPUTE
                );
                assert.deepStrictEqual(
                  (await financialContract.getLiquidations(sponsor2))[0].state,
                  LiquidationStatesEnum.UNINITIALIZED
                );
                assert.deepStrictEqual(
                  (await financialContract.getLiquidations(sponsor3))[0].state,
                  LiquidationStatesEnum.UNINITIALIZED
                );
              }
            );
          });
        });
      });
    }
  });
});

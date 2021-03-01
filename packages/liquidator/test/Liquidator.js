const { toWei, toBN, utf8ToHex, padRight } = web3.utils;
const winston = require("winston");
const sinon = require("sinon");
const {
  parseFixed,
  interfaceName,
  LiquidationStatesEnum,
  PostWithdrawLiquidationRewardsStatusTranslations,
  runTestForVersion,
  createConstructorParamsForContractVersion,
  TESTED_CONTRACT_VERSIONS
} = require("@uma/common");
const { getTruffleContract } = require("@uma/core");

// Helper clients and custom winston transport module to monitor winston log outputs
const {
  FinancialContractClient,
  GasEstimator,
  PriceFeedMock,
  SpyTransport,
  lastSpyLogLevel,
  spyLogIncludes,
  spyLogLevel
} = require("@uma/financial-templates-lib");

// Script to test
const { Liquidator } = require("../src/liquidator.js");

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

// Common contract objects.
let store;
let optimisticOracle;
let finder;
let collateralToken;
let configStore;
let financialContract;
let syntheticToken;
let mockOracle;
let priceFeedMock;
let identifierWhitelist;
let collateralWhitelist;
let timer;
let fundingRateIdentifier;

// Js Objects, clients and helpers
let identifier;
let liquidator;
let spy;
let spyLogger;
let gasEstimator;
let financialContractClient;
let liquidatorConfig;
let liquidatorOverridePrice;
let financialContractProps;
let convertCollateral;
let convertSynthetic;
let convertPrice;

// Set the funding rate and advances time by 10k seconds.
const _setFundingRateAndAdvanceTime = async fundingRate => {
  const currentTime = (await financialContract.getCurrentTime()).toNumber();
  await financialContract.proposeFundingRate({ rawValue: fundingRate }, currentTime);
  await financialContract.setCurrentTime(currentTime + 10000);
};

// If the current version being executed is part of the `supportedVersions` array then return `it` to run the test.
// Else, do nothing. Can be used exactly in place of a normal `it` to parameterize contract types and versions supported
// for a given test.eg: versionedIt(["Perpetual-latest"])("test name", async function () { assert.isTrue(true) })
// Note that a second param can be provided to make the test an `it.only` thereby ONLY running that single test, on
// the provided version. This is very useful for debugging and writing single unit tests without having ro run all tests.
const versionedIt = function(supportedVersions, shouldBeItOnly = false) {
  if (shouldBeItOnly)
    return runTestForVersion(supportedVersions, TESTED_CONTRACT_VERSIONS, iterationTestVersion) ? it.only : () => {};
  return runTestForVersion(supportedVersions, TESTED_CONTRACT_VERSIONS, iterationTestVersion) ? it : () => {};
};

// allows this to be set to null without throwing.
const Convert = decimals => number => (number ? parseFixed(number.toString(), decimals).toString() : number);

contract("Liquidator.js", function(accounts) {
  // Implementation uses the 0th address by default as the bot runs using the default truffle wallet accounts[0]
  const liquidatorBot = accounts[0];
  const sponsor1 = accounts[1];
  const sponsor2 = accounts[2];
  const sponsor3 = accounts[3];
  const contractCreator = accounts[4];
  const liquidityProvider = accounts[5];

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

          // Seed the sponsors accounts.
          await collateralToken.mint(sponsor1, convertCollateral("100000"), { from: contractCreator });
          await collateralToken.mint(sponsor2, convertCollateral("100000"), { from: contractCreator });
          await collateralToken.mint(sponsor3, convertCollateral("100000"), { from: contractCreator });
          await collateralToken.mint(liquidityProvider, convertCollateral("1000000"), { from: contractCreator });

          // seed the liquidatorBot's wallet so it can perform liquidations.
          await collateralToken.mint(liquidatorBot, convertCollateral("100000"), { from: contractCreator });

          // Create identifier whitelist and register the price tracking ticker with it.
          identifierWhitelist = await IdentifierWhitelist.new();
          await identifierWhitelist.addSupportedIdentifier(utf8ToHex(identifier));

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

          const constructorParams = await createConstructorParamsForContractVersion(contractVersion, {
            convertSynthetic,
            finder,
            collateralToken,
            syntheticToken,
            identifier,
            fundingRateIdentifier,
            timer,
            store,
            configStore: configStore || {} // if the contract type is not a perp this will be null.
          });

          // Deploy a new expiring multi party OR perpetual, depending on the test version.
          financialContract = await FinancialContract.new(constructorParams);
          await syntheticToken.addMinter(financialContract.address);
          await syntheticToken.addBurner(financialContract.address);

          await collateralToken.approve(financialContract.address, convertCollateral("10000000"), { from: sponsor1 });
          await collateralToken.approve(financialContract.address, convertCollateral("10000000"), { from: sponsor2 });
          await collateralToken.approve(financialContract.address, convertCollateral("10000000"), { from: sponsor3 });
          await collateralToken.approve(financialContract.address, convertCollateral("100000000"), {
            from: liquidatorBot
          });
          await collateralToken.approve(financialContract.address, convertCollateral("100000000"), {
            from: liquidityProvider
          });

          syntheticToken = await Token.at(await financialContract.tokenCurrency());
          await syntheticToken.approve(financialContract.address, convertSynthetic("100000000"), { from: sponsor1 });
          await syntheticToken.approve(financialContract.address, convertSynthetic("100000000"), { from: sponsor2 });
          await syntheticToken.approve(financialContract.address, convertSynthetic("100000000"), { from: sponsor3 });
          await syntheticToken.approve(financialContract.address, convertSynthetic("100000000"), {
            from: liquidatorBot
          });
          await syntheticToken.approve(financialContract.address, convertSynthetic("100000000"), {
            from: liquidityProvider
          });

          // If we are testing a perpetual then we need to apply the initial funding rate to start the timer.
          await financialContract.setCurrentTime(startTime);
          if (contractVersion.contractType == "Perpetual") await financialContract.applyFundingRate();

          spy = sinon.spy();

          spyLogger = winston.createLogger({
            level: "info",
            transports: [new SpyTransport({ level: "info" }, { spy: spy })]
          });

          // Create a new instance of the FinancialContractClient & gasEstimator to construct the liquidator
          financialContractClient = new FinancialContractClient(
            spyLogger,
            FinancialContract.abi,
            web3,
            financialContract.address,
            testConfig.collateralDecimals,
            testConfig.syntheticDecimals,
            testConfig.priceFeedDecimals,
            contractVersion.contractType
          );
          gasEstimator = new GasEstimator(spyLogger);

          // Create a new instance of the price feed mock.
          priceFeedMock = new PriceFeedMock(undefined, undefined, undefined, testConfig.priceFeedDecimals);

          // Create a new instance of the liquidator to test
          liquidatorConfig = {
            crThreshold: 0,
            contractType: contractVersion.contractType,
            contractVersion: contractVersion.contractVersion
          };

          // Generate Financial Contract properties to inform bot of important on-chain state values that we only want to query once.
          financialContractProps = {
            crRatio: await financialContract.collateralRequirement(),
            priceIdentifier: await financialContract.priceIdentifier(),
            minSponsorSize: await financialContract.minSponsorTokens(),
            withdrawLiveness: await financialContract.withdrawalLiveness()
          };

          liquidator = new Liquidator({
            logger: spyLogger,
            financialContractClient: financialContractClient,
            gasEstimator,
            syntheticToken: syntheticToken.contract,
            priceFeed: priceFeedMock,
            account: accounts[0],
            financialContractProps,
            liquidatorConfig
          });
        });
        versionedIt([{ contractType: "any", contractVersion: "any" }])(
          "Can correctly detect undercollateralized positions and liquidate them",
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

            // liquidatorBot creates a position to have synthetic tokens to pay off debt upon liquidation.
            await financialContract.create(
              { rawValue: convertCollateral("1000") },
              { rawValue: convertSynthetic("500") },
              { from: liquidatorBot }
            );

            // Start with a mocked price of 1 usd per token.
            // This puts both sponsors over collateralized so no liquidations should occur.
            priceFeedMock.setCurrentPrice(convertPrice("1"));

            await liquidator.update();
            await liquidator.liquidatePositions();
            assert.equal(spy.callCount, 0); // No info level logs should be sent.

            // Both token sponsors should still have their positions with full collateral.
            assert.equal((await financialContract.getCollateral(sponsor1)).rawValue, convertCollateral("125"));
            assert.equal((await financialContract.getCollateral(sponsor2)).rawValue, convertCollateral("150"));

            // Liquidator throws an error if the price feed returns an invalid value.
            priceFeedMock.setCurrentPrice(convertPrice(null));
            await liquidator.update();
            let errorThrown = false;
            try {
              await liquidator.liquidatePositions();
            } catch (error) {
              errorThrown = true;
            }
            assert.isTrue(errorThrown);

            // There should be no liquidations created from any sponsor account
            assert.deepStrictEqual(await financialContract.getLiquidations(sponsor1), []);
            assert.deepStrictEqual(await financialContract.getLiquidations(sponsor2), []);
            assert.deepStrictEqual(await financialContract.getLiquidations(sponsor3), []);

            // Next, assume the price feed given to the liquidator has moved such that two of the three sponsors
            // are now undercollateralized. The liquidator bot should correctly identify this and liquidate the positions.
            // A price of 1.3 USD per token puts sponsor1 and sponsor2 at undercollateralized while sponsor3 remains
            // collateralized. Numerically debt * price * coltReq > debt for collateralized position.
            // Sponsor1: 100 * 1.3 * 1.2 > 125 [undercollateralized]
            // Sponsor2: 100 * 1.3 * 1.2 > 150 [undercollateralized]
            // Sponsor3: 100 * 1.3 * 1.2 < 175 [sufficiently collateralized]

            priceFeedMock.setCurrentPrice(convertPrice("1.3"));
            await liquidator.update();
            await liquidator.liquidatePositions();
            assert.equal(spy.callCount, 2); // 2 info level events should be sent at the conclusion of the 2 liquidations.

            // Sponsor1 should be in a liquidation state with the bot as the liquidator.
            let liquidationObject = (await financialContract.getLiquidations(sponsor1))[0];
            assert.equal(liquidationObject.sponsor, sponsor1);
            assert.equal(liquidationObject.liquidator, liquidatorBot);
            assert.equal(liquidationObject.state, LiquidationStatesEnum.PRE_DISPUTE);
            assert.equal(liquidationObject.liquidatedCollateral, convertCollateral("125"));

            // Sponsor1 should have zero collateral left in their position from the liquidation.
            assert.equal((await financialContract.getCollateral(sponsor1)).rawValue, 0);

            // Sponsor2 should be in a liquidation state with the bot as the liquidator.
            liquidationObject = (await financialContract.getLiquidations(sponsor2))[0];
            assert.equal(liquidationObject.sponsor, sponsor2);
            assert.equal(liquidationObject.liquidator, liquidatorBot);
            assert.equal(liquidationObject.state, LiquidationStatesEnum.PRE_DISPUTE);
            assert.equal(liquidationObject.liquidatedCollateral, convertCollateral("150"));

            // Sponsor2 should have zero collateral left in their position from the liquidation.
            assert.equal((await financialContract.getCollateral(sponsor2)).rawValue, 0);

            // Sponsor3 should have all their collateral left and no liquidations.
            assert.deepStrictEqual(await financialContract.getLiquidations(sponsor3), []);
            assert.equal((await financialContract.getCollateral(sponsor3)).rawValue, convertCollateral("175"));

            // Another query at the same price should execute no new liquidations.
            priceFeedMock.setCurrentPrice(convertPrice("1.3"));
            await liquidator.update();
            await liquidator.liquidatePositions();
            assert.equal(spy.callCount, 2);
          }
        );
        versionedIt([{ contractType: "any", contractVersion: "any" }])(
          "Can correctly detect invalid withdrawals and liquidate them",
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

            // liquidatorBot creates a position to have synthetic tokens to pay off debt upon liquidation.
            await financialContract.create(
              { rawValue: convertCollateral("1000") },
              { rawValue: convertSynthetic("500") },
              { from: liquidatorBot }
            );

            // Start with a mocked price of 1 usd per token.
            // This puts both sponsors over collateralized so no liquidations should occur.
            priceFeedMock.setCurrentPrice(convertPrice("1"));
            await liquidator.update();
            await liquidator.liquidatePositions();
            // assert.equal(spy.callCount, 0); // No info level logs should be sent.

            // There should be no liquidations created from any sponsor account
            assert.deepStrictEqual(await financialContract.getLiquidations(sponsor1), []);
            assert.deepStrictEqual(await financialContract.getLiquidations(sponsor2), []);

            // Both token sponsors should still have their positions with full collateral.
            assert.equal((await financialContract.getCollateral(sponsor1)).rawValue, convertCollateral("125"));
            assert.equal((await financialContract.getCollateral(sponsor2)).rawValue, convertCollateral("150"));

            // If sponsor1 requests a withdrawal of any amount of collateral above 5 units at the given price of 1 usd per token
            // their remaining position becomes undercollateralized. Say they request to withdraw 10 units of collateral.
            // This places their position with a CR of: 115 / (100 * 1) * 100 = 115%. This is below the CR threshold.
            await financialContract.requestWithdrawal({ rawValue: convertCollateral("10") }, { from: sponsor1 });

            priceFeedMock.setCurrentPrice(convertPrice("1"));
            await liquidator.update();
            await liquidator.liquidatePositions();
            // assert.equal(spy.callCount, 1); // There should be one log from the liquidation event of the withdrawal.

            // There should be exactly one liquidation in sponsor1's account. The liquidated collateral should be the original
            // amount of collateral minus the collateral withdrawn. 125 - 10 = 115
            let liquidationObject = (await financialContract.getLiquidations(sponsor1))[0];
            assert.equal(liquidationObject.sponsor, sponsor1);
            assert.equal(liquidationObject.liquidator, liquidatorBot);
            assert.equal(liquidationObject.state, LiquidationStatesEnum.PRE_DISPUTE);
            assert.equal(liquidationObject.liquidatedCollateral, convertCollateral("115"));
            assert.equal(liquidationObject.lockedCollateral, convertCollateral("125"));

            // Advance the timer to the liquidation expiry.
            const liquidationTime = liquidationObject.liquidationTime;
            const liquidationLiveness = 1000;
            await financialContract.setCurrentTime(Number(liquidationTime) + liquidationLiveness);

            // Now that the liquidation has expired, the liquidator can withdraw rewards.
            const collateralPreWithdraw = await collateralToken.balanceOf(liquidatorBot);
            await liquidator.update();
            await liquidator.withdrawRewards();
            // assert.equal(spy.callCount, 2); // 1 new info level events should be sent at the conclusion of the withdrawal. total 2.

            // Liquidator should have their collateral increased by Sponsor1's collateral.
            const collateralPostWithdraw = await collateralToken.balanceOf(liquidatorBot);
            assert.equal(
              toBN(collateralPreWithdraw)
                .add(toBN(convertCollateral("125")))
                .toString(),
              collateralPostWithdraw.toString()
            );

            // Liquidation data should have been deleted.
            assert.deepStrictEqual(
              (await financialContract.getLiquidations(sponsor1))[0].state,
              LiquidationStatesEnum.UNINITIALIZED
            );

            // The other two positions should not have any liquidations associated with them.
            assert.deepStrictEqual(await financialContract.getLiquidations(sponsor2), []);
          }
        );

        versionedIt([{ contractType: "any", contractVersion: "any" }])(
          "Can withdraw rewards from expired liquidations",
          async function() {
            // sponsor1 creates a position with 125 units of collateral, creating 100 synthetic tokens.
            await financialContract.create(
              { rawValue: convertCollateral("125") },
              { rawValue: convertSynthetic("100") },
              { from: sponsor1 }
            );

            // liquidatorBot creates a position to have synthetic tokens to pay off debt upon liquidation.
            await financialContract.create(
              { rawValue: convertCollateral("1000") },
              { rawValue: convertSynthetic("500") },
              { from: liquidatorBot }
            );

            // Next, the liquidator believes the price to be 1.3, which would make the position undercollateralized,
            // and liquidates the position.
            // Sponsor1: 100 * 1.3 * 1.2 > 125 [undercollateralized]
            priceFeedMock.setCurrentPrice(convertPrice("1.3"));
            await liquidator.update();
            await liquidator.liquidatePositions();
            // assert.equal(spy.callCount, 1); // 1 info level events should be sent at the conclusion of the liquidation.

            // Advance the timer to the liquidation expiry.
            const liquidationTime = (await financialContract.getLiquidations(sponsor1))[0].liquidationTime;
            const liquidationLiveness = 1000;
            await financialContract.setCurrentTime(Number(liquidationTime) + liquidationLiveness);

            // Now that the liquidation has expired, the liquidator can withdraw rewards.
            const collateralPreWithdraw = await collateralToken.balanceOf(liquidatorBot);
            await liquidator.update();
            await liquidator.withdrawRewards();
            // assert.equal(spy.callCount, 2); // 1 new info level events should be sent at the conclusion of the withdrawal. Total 2.

            // Liquidator should have their collateral increased by Sponsor1's collateral.
            const collateralPostWithdraw = await collateralToken.balanceOf(liquidatorBot);
            assert.equal(
              toBN(collateralPreWithdraw)
                .add(toBN(convertCollateral("125")))
                .toString(),
              collateralPostWithdraw.toString()
            );

            // Liquidation data should have been deleted.
            assert.deepStrictEqual(
              (await financialContract.getLiquidations(sponsor1))[0].state,
              LiquidationStatesEnum.UNINITIALIZED
            );
          }
        );

        versionedIt([{ contractType: "any", contractVersion: "any" }])(
          "Can withdraw rewards from liquidations that were disputed unsuccessfully",
          async function() {
            // sponsor1 creates a position with 125 units of collateral, creating 100 synthetic tokens.
            await financialContract.create(
              { rawValue: convertCollateral("125") },
              { rawValue: convertSynthetic("100") },
              { from: sponsor1 }
            );

            // liquidatorBot creates a position to have synthetic tokens to pay off debt upon liquidation.
            await financialContract.create(
              { rawValue: convertCollateral("1000") },
              { rawValue: convertSynthetic("500") },
              { from: liquidatorBot }
            );

            // Next, the liquidator believes the price to be 1.3, which would make the position undercollateralized,
            // and liquidates the position.
            // Sponsor1: 100 * 1.3 * 1.2 > 125 [undercollateralized]
            priceFeedMock.setCurrentPrice(convertPrice("1.3"));
            await liquidator.update();
            await liquidator.liquidatePositions();
            assert.equal(spy.callCount, 1); // 1 info level events should be sent at the conclusion of the liquidation.

            // Dispute the liquidation, which requires staking a dispute bond.
            await financialContract.dispute("0", sponsor1, { from: sponsor3 });

            // Attempt to withdraw before dispute resolves should do nothing exit gracefully.
            await liquidator.update();
            await liquidator.withdrawRewards();
            assert.equal(spy.callCount, 1); // no new info level events as too early.

            // Simulate a failed dispute by pushing a price to the oracle, at the time of the liquidation request, such that
            // the position was truly undercollateralized. In other words, the liquidator was liquidating at the correct price.
            const disputePrice = convertPrice("1.3");
            const liquidationTime = (await financialContract.getLiquidations(sponsor1))[0].liquidationTime;
            await mockOracle.pushPrice(utf8ToHex(`${testConfig.tokenName}TEST`), liquidationTime, disputePrice);

            // The liquidator can now settle the dispute by calling `withdrawRewards()` because the oracle has a price
            // for the liquidation time.
            const collateralPreWithdraw = await collateralToken.balanceOf(liquidatorBot);
            await liquidator.update();
            await liquidator.withdrawRewards();
            assert.equal(spy.callCount, 2); // 1 new info level event should be sent due to the withdrawal.

            // Liquidator should have their collateral increased by Sponsor1's collateral + the disputer's dispute bond:
            // 125 + (10% of 125) = 137.5 units of collateral.
            const collateralPostWithdraw = await collateralToken.balanceOf(liquidatorBot);
            assert.equal(
              toBN(collateralPreWithdraw)
                .add(toBN(convertCollateral("137.5")))
                .toString(),
              collateralPostWithdraw.toString()
            );

            // Liquidation data should have been deleted.
            assert.deepStrictEqual(
              (await financialContract.getLiquidations(sponsor1))[0].state,
              LiquidationStatesEnum.UNINITIALIZED
            );

            // Check that the log includes a human readable translation of the liquidation status, and the dispute price.
            // Note the check below has a bit of switching logic that is version specific to accommodate the change in withdrawal behaviour.
            assert.equal(
              spy.getCall(-1).lastArg.liquidationResult.liquidationStatus,
              PostWithdrawLiquidationRewardsStatusTranslations[
                contractVersion.contractVersion == "1.2.2"
                  ? LiquidationStatesEnum.UNINITIALIZED
                  : LiquidationStatesEnum.DISPUTE_FAILED
              ]
            );
            assert.equal(spy.getCall(-1).lastArg.liquidationResult.settlementPrice, convertPrice("1.3"));

            // Check that the log contains the dispute rewards:
            if (liquidator.isLegacyEmpVersion) {
              assert.isTrue(toBN(spy.getCall(-1).lastArg.liquidationResult.withdrawalAmount).gt(0));
            } else {
              assert.isTrue(toBN(spy.getCall(-1).lastArg.liquidationResult.paidToLiquidator).gt(0));
              assert.isTrue(toBN(spy.getCall(-1).lastArg.liquidationResult.paidToSponsor).gt(0));
              assert.isTrue(toBN(spy.getCall(-1).lastArg.liquidationResult.paidToDisputer).gt(0));
            }

            // After the dispute is resolved, the liquidation should no longer exist and there should be no disputes to withdraw rewards from.
            await liquidator.update();
            await liquidator.withdrawRewards();
            assert.equal(spy.callCount, 2);
          }
        );

        versionedIt([{ contractType: "any", contractVersion: "any" }])(
          "Can withdraw rewards from liquidations that were disputed successfully",
          async function() {
            // sponsor1 creates a position with 125 units of collateral, creating 100 synthetic tokens.
            await financialContract.create(
              { rawValue: convertCollateral("125") },
              { rawValue: convertSynthetic("100") },
              { from: sponsor1 }
            );

            // liquidatorBot creates a position to have synthetic tokens to pay off debt upon liquidation.
            await financialContract.create(
              { rawValue: convertCollateral("1000") },
              { rawValue: convertSynthetic("500") },
              { from: liquidatorBot }
            );

            // Next, the liquidator believes the price to be 1.3, which would make the position undercollateralized,
            // and liquidates the position.
            // Sponsor1: 100 * 1.3 * 1.2 > 125 [undercollateralized]
            priceFeedMock.setCurrentPrice(convertPrice("1.3"));
            await liquidator.update();
            await liquidator.liquidatePositions();
            assert.equal(spy.callCount, 1); // 1 info level events should be sent at the conclusion of the liquidation.

            // Dispute the liquidation, which requires staking a dispute bond.
            await financialContract.dispute("0", sponsor1, { from: sponsor3 });

            // Attempt to withdraw before dispute resolves should do nothing exit gracefully.
            await liquidator.update();
            await liquidator.withdrawRewards();
            assert.equal(spy.callCount, 1); // no new info level events as too early.

            // Simulate a successful dispute by pushing a price to the oracle, at the time of the liquidation request, such that
            // the position was not undercollateralized. In other words, the liquidator was liquidating at the incorrect price.
            const disputePrice = convertPrice("1");
            const liquidationTime = (await financialContract.getLiquidations(sponsor1))[0].liquidationTime;
            await mockOracle.pushPrice(utf8ToHex(identifier), liquidationTime, disputePrice);

            // The liquidator can now settle the dispute by calling `withdrawRewards()` because the oracle has a price
            // for the liquidation time.
            const collateralPreWithdraw = await collateralToken.balanceOf(liquidatorBot);
            await liquidator.update();
            await liquidator.withdrawRewards();
            assert.equal(spy.callCount, 2); // 1 new info level event should be sent due to the withdrawal.

            // Liquidator should have their collateral increased by TRV - (disputer and sponsor rewards):
            // 100 - 2 * (10% of 100) = 80 units of collateral.
            const collateralPostWithdraw = await collateralToken.balanceOf(liquidatorBot);
            assert.equal(
              toBN(collateralPreWithdraw)
                .add(toBN(convertCollateral("80")))
                .toString(),
              collateralPostWithdraw.toString()
            );

            // Check that the log includes a human readable translation of the liquidation status, and the dispute price.
            assert.equal(
              spy.getCall(-1).lastArg.liquidationResult.liquidationStatus,
              PostWithdrawLiquidationRewardsStatusTranslations[LiquidationStatesEnum.DISPUTE_SUCCEEDED]
            );
            assert.equal(spy.getCall(-1).lastArg.liquidationResult.settlementPrice, convertPrice("1"));

            // Check that the log contains the dispute rewards:
            if (liquidator.isLegacyEmpVersion) {
              assert.isTrue(toBN(spy.getCall(-1).lastArg.liquidationResult.withdrawalAmount).gt(0));
            } else {
              assert.isTrue(toBN(spy.getCall(-1).lastArg.liquidationResult.paidToLiquidator).gt(0));
              assert.isTrue(toBN(spy.getCall(-1).lastArg.liquidationResult.paidToSponsor).gt(0));
              assert.isTrue(toBN(spy.getCall(-1).lastArg.liquidationResult.paidToDisputer).gt(0));
            }

            // After the dispute is resolved, the liquidation should still exist but the liquidator should no longer be able to withdraw any rewards.
            await liquidator.update();
            await liquidator.withdrawRewards();
            assert.equal(spy.callCount, 2);
          }
        );

        versionedIt([{ contractType: "any", contractVersion: "any" }])(
          "Detect if the liquidator cannot liquidate due to capital constraints",
          async function() {
            // sponsor1 creates a position with 125 units of collateral, creating 100 synthetic tokens.
            await financialContract.create(
              { rawValue: convertCollateral("125") },
              { rawValue: convertSynthetic("100") },
              { from: sponsor1 }
            );

            // Next, the liquidator believes the price to be 1.3, which would make the position undercollateralized,
            // and liquidates the position.
            // Sponsor1: 100 * 1.3 * 1.2 > 125 [undercollateralized]
            priceFeedMock.setCurrentPrice(convertPrice("1.3"));

            // No transaction should be sent, so this should not throw.
            await liquidator.update();
            await liquidator.liquidatePositions();
            assert.equal(spy.callCount, 1); // 1 new error level event due to the failed liquidation.

            // No liquidations should have gone through.
            assert.equal((await financialContract.getLiquidations(sponsor1)).length, 0);

            // liquidatorBot creates a position to have synthetic tokens to pay off debt upon liquidation.
            await financialContract.create(
              { rawValue: convertCollateral("1000") },
              { rawValue: convertSynthetic("500") },
              { from: liquidatorBot }
            );
            // No need to force update the `financialContractClient` here since we are not interested in detecting the `liquidatorBot`'s new
            // position, but now when we try to liquidate the position the liquidation will go through because the bot will have
            // the requisite balance.

            // Can now liquidate the position.
            priceFeedMock.setCurrentPrice(convertPrice("1.3"));
            await liquidator.update();
            await liquidator.liquidatePositions();
            assert.equal(spy.callCount, 2); // 1 new info level event due to the successful liquidation.

            // The liquidation should have gone through.
            assert.equal((await financialContract.getLiquidations(sponsor1)).length, 1);
            assert.equal(spy.callCount, 2); // 1 new log level event due to the successful execution.
          }
        );

        describe("Overrides the default liquidator configuration settings", function() {
          versionedIt([{ contractType: "any", contractVersion: "any" }])(
            "Cannot set `crThreshold` >= 1",
            async function() {
              let errorThrown;
              try {
                liquidatorConfig = { ...liquidatorConfig, crThreshold: 1 };
                liquidator = new Liquidator({
                  logger: spyLogger,
                  financialContractClient: financialContractClient,
                  gasEstimator,
                  syntheticToken: syntheticToken.contract,
                  priceFeed: priceFeedMock,
                  account: accounts[0],
                  financialContractProps,
                  liquidatorConfig
                });
                errorThrown = false;
              } catch (err) {
                errorThrown = true;
              }
              assert.isTrue(errorThrown);
            }
          );

          versionedIt([{ contractType: "any", contractVersion: "any" }])(
            "Cannot set `crThreshold` < 0",
            async function() {
              let errorThrown;
              try {
                liquidatorConfig = { ...liquidatorConfig, crThreshold: -0.02 };
                liquidator = new Liquidator({
                  account: accounts[0],
                  financialContractProps,
                  liquidatorConfig
                });
                errorThrown = false;
              } catch (err) {
                errorThrown = true;
              }
              assert.isTrue(errorThrown);
            }
          );

          versionedIt([{ contractType: "any", contractVersion: "any" }])("Sets `crThreshold` to 2%", async function() {
            liquidatorConfig = { ...liquidatorConfig, crThreshold: 0.02 };
            liquidator = new Liquidator({
              logger: spyLogger,
              financialContractClient: financialContractClient,
              gasEstimator,
              syntheticToken: syntheticToken.contract,
              priceFeed: priceFeedMock,
              account: accounts[0],
              financialContractProps,
              liquidatorConfig
            });

            // sponsor1 creates a position with 115 units of collateral, creating 100 synthetic tokens.
            await financialContract.create(
              { rawValue: convertCollateral("115") },
              { rawValue: convertSynthetic("100") },
              { from: sponsor1 }
            );

            // sponsor2 creates a position with 118 units of collateral, creating 100 synthetic tokens.
            await financialContract.create(
              { rawValue: convertCollateral("118") },
              { rawValue: convertSynthetic("100") },
              { from: sponsor2 }
            );

            // liquidatorBot creates a position to have synthetic tokens to pay off debt upon liquidation.
            await financialContract.create(
              { rawValue: convertCollateral("1000") },
              { rawValue: convertSynthetic("500") },
              { from: liquidatorBot }
            );

            // Next, assume that the price feed has moved such that both sponsors are technically undercollateralized.
            // However, the price threshold provides just enough buffer for sponsor2 to avoid liquidation.
            // Numerically: (tokens_outstanding * price * coltReq * (1-crThreshold) > debt)
            // must hold for correctly collateralized positions. If the price feed is 1 USD, then
            // there must be more than (100 * 1 * 1.2 * 0.98 = 117.6) collateral in the position.
            // Note that without the price threshold, the minimum collateral would be (100 * 1 * 1.2 = 120), which
            // would make both sponsors undercollateralized. Because of the price threshold setting, the bot should only
            // liquidate sponsor1.
            // Sponsor1: 100 * 1 * 1.2 * 0.98 > 115 [undercollateralized]
            // Sponsor1: 100 * 1 * 1.2 * 0.98 < 118 [sufficiently collateralized]
            // Sponsor2: 100 * 1 * 1.2 > 118 [would be undercollateralized w/o threshold]

            priceFeedMock.setCurrentPrice(convertPrice("1"));
            await liquidator.update();
            await liquidator.liquidatePositions();
            assert.equal(spy.callCount, 1); // 1 info level events should be sent at the conclusion of the 1 liquidation.

            // Sponsor1 should be in a liquidation state with the bot as the liquidator.
            let liquidationObject = (await financialContract.getLiquidations(sponsor1))[0];
            assert.equal(liquidationObject.sponsor, sponsor1);
            assert.equal(liquidationObject.liquidator, liquidatorBot);
            assert.equal(liquidationObject.state, LiquidationStatesEnum.PRE_DISPUTE);
            assert.equal(liquidationObject.liquidatedCollateral, convertCollateral("115"));

            // Sponsor1 should have zero collateral left in their position from the liquidation.
            assert.equal((await financialContract.getCollateral(sponsor1)).rawValue, 0);

            // Sponsor2 should have all their collateral left and no liquidations.
            assert.deepStrictEqual(await financialContract.getLiquidations(sponsor2), []);
            assert.equal((await financialContract.getCollateral(sponsor2)).rawValue, convertCollateral("118"));
          });
          versionedIt([{ contractType: "any", contractVersion: "any" }])(
            "Cannot set invalid alerting overrides",
            async function() {
              let errorThrown;
              try {
                // Create an invalid log level override. This should be rejected.
                liquidatorConfig = {
                  ...liquidatorConfig,
                  logOverrides: { positionLiquidated: "not a valid log level" }
                };
                liquidator = new Liquidator({
                  logger: spyLogger,
                  financialContractClient: financialContractClient,
                  gasEstimator,
                  syntheticToken: syntheticToken.contract,
                  priceFeed: priceFeedMock,
                  account: accounts[0],
                  financialContractProps,
                  liquidatorConfig
                });
                errorThrown = false;
              } catch (err) {
                errorThrown = true;
              }
              assert.isTrue(errorThrown);
            }
          );
          versionedIt([{ contractType: "any", contractVersion: "any" }])(
            "amount-to-liquidate > min-sponsor-tokens, but bot balance is too low to send liquidation",
            async function() {
              // We'll attempt to liquidate 10 tokens, but we will only have enough balance to complete the first liquidation.
              const amountToLiquidate = toWei("10");

              await financialContract.create(
                { rawValue: convertCollateral("100") },
                { rawValue: convertSynthetic("12") },
                { from: sponsor1 }
              );
              await financialContract.create(
                { rawValue: convertCollateral("100") },
                { rawValue: convertSynthetic("8") },
                { from: sponsor2 }
              );

              // liquidatorBot creates a position with enough tokens to liquidate all positions.
              await financialContract.create(
                { rawValue: convertCollateral("10000") },
                { rawValue: convertSynthetic("10") },
                { from: liquidatorBot }
              );

              // These positions are both undercollateralized at price of 25: 8 * 25 * 1.2 > 100.
              priceFeedMock.setCurrentPrice(convertPrice("25"));

              await liquidator.update();
              await liquidator.liquidatePositions(amountToLiquidate);

              // 2 partial liquidations. This behavior has changed slightly from previous test
              // as the liquidation amount calculator is slightly improved. Previous calculation
              // did not take into account current bot balance correctly and overestimated liquidation
              // amount causing an error.
              assert.equal(spy.callCount, 4);
              assert.equal(spyLogLevel(spy, 3), "info");
              assert.isTrue(spyLogIncludes(spy, 3, "liquidated"));
              assert.equal(spyLogLevel(spy, 2), "error");
              assert.isTrue(spyLogIncludes(spy, 2, "partial liquidation"));
              assert.equal(spyLogLevel(spy, 1), "info");
              assert.isTrue(spyLogIncludes(spy, 1, "liquidated"));
              assert.equal(spyLogLevel(spy, 0), "error");
              assert.isTrue(spyLogIncludes(spy, 0, "partial liquidation"));

              // Sponsor1 should be in a liquidation state with the bot as the liquidator. (7/12) = 58.33% of the 100 starting collateral and 7 tokens should be liquidated.
              let liquidationObject = (await financialContract.getLiquidations(sponsor1))[0];
              assert.equal(liquidationObject.sponsor, sponsor1);
              assert.equal(liquidationObject.liquidator, liquidatorBot);
              assert.equal(liquidationObject.state, LiquidationStatesEnum.PRE_DISPUTE);
              if (testConfig.collateralDecimals == 18) {
                assert.equal(liquidationObject.liquidatedCollateral.rawValue, convertCollateral("58.3333333333333333"));
              } else if (testConfig.collateralDecimals == 8) {
                assert.equal(liquidationObject.liquidatedCollateral.rawValue, convertCollateral("58.33333333"));
              }
              assert.equal(liquidationObject.tokensOutstanding.rawValue, convertSynthetic("7"));

              // Sponsor2 should not be in a liquidation state because the bot would have attempted to liquidate its full position of 8 tokens, but it only had remaining.

              // Sponsor1 should have some collateral and tokens left in their position from the liquidation.
              if (testConfig.collateralDecimals == 18) {
                assert.equal(
                  (await financialContract.getCollateral(sponsor1)).rawValue,
                  convertCollateral("41.6666666666666667")
                );
              } else if (testConfig.collateralDecimals == 8) {
                assert.equal(
                  (await financialContract.getCollateral(sponsor1)).rawValue,
                  convertCollateral("41.66666667")
                );
              }
              let positionObject = await financialContract.positions(sponsor1);
              assert.equal(positionObject.tokensOutstanding.rawValue, convertSynthetic("5"));

              // Sponsor2 should not have its full position left, it was partially liquidated
              // Bot has 3 tokens left after first liquidation, and this brings position
              // to just at the min sponsor size of 5.
              // (8-3)/8 = 5/8, 5/8 * 100 = 62.5
              assert.equal((await financialContract.getCollateral(sponsor2)).rawValue, convertCollateral("62.5"));
              positionObject = await financialContract.positions(sponsor2);
              assert.equal(positionObject.tokensOutstanding.rawValue, convertSynthetic("5"));
            }
          );
          describe("Partial liquidations", function() {
            versionedIt([{ contractType: "any", contractVersion: "any" }])(
              "amount-to-liquidate > min-sponsor-tokens",
              async function() {
                // We'll attempt to liquidate 6 tokens. The minimum sponsor position is 5. There are 3 different scenarios
                // we should test for, each of which we'll attempt to liquidate in one call of `liquidatePositions`.
                const amountToLiquidate = convertSynthetic("6");

                // 1. (tokens-outstanding - amount-to-liquidate) > min-sponsor-tokens, and amount-to-liquidate < tokens-outstanding
                //     - The bot will be able to liquidate its desired amount, leaving the position above the minimum token threshold.
                //     - Example: (12 - 6) > 5, new position will have 6 tokens remaining.
                await financialContract.create(
                  { rawValue: convertCollateral("100") },
                  { rawValue: convertSynthetic("12") },
                  { from: sponsor1 }
                );
                // 2. (tokens-outstanding - amount-to-liquidate) <= min-sponsor-tokens, and amount-to-liquidate < tokens-outstanding
                //     - The bot will NOT be able to liquidate its desired amount. It will liquidate a reduced amount and
                //       reduce the position exactly to the minimum.
                //     - Example: (8 - 6) <= 5, so instead the bot will liquidate (8 - 5) = 3 tokens to leave the position with (8 - 3) = 5 tokens remaining.
                await financialContract.create(
                  { rawValue: convertCollateral("100") },
                  { rawValue: convertSynthetic("8") },
                  { from: sponsor2 }
                );
                // 3. amount-to-liquidate > tokens-outstanding
                //     - The bot will liquidate the full position.
                //     - Example: 6 > 5, so the bot will liquidate 5 tokens.
                await financialContract.create(
                  { rawValue: convertCollateral("100") },
                  { rawValue: convertSynthetic("5") },
                  { from: sponsor3 }
                );

                // liquidatorBot creates a position with enough tokens to liquidate all positions.
                await financialContract.create(
                  { rawValue: convertCollateral("10000") },
                  { rawValue: convertSynthetic("50") },
                  { from: liquidatorBot }
                );

                // Next, assume the price feed given to the liquidator has moved such that the sponsors
                // are all now undercollateralized. The liquidator bot should correctly identify this and liquidate the positions.
                // A price of 25 USD per token will make all positions undercollateralized.
                // Numerically debt * price * coltReq > debt for collateralized position.
                // Sponsor1: 12 * 25 * 1.2 > 100
                // Sponsor2: 8 * 25 * 1.2 > 100
                // Sponsor3: 5 * 25 * 1.2 > 100
                priceFeedMock.setCurrentPrice(convertPrice("25"));

                await liquidator.update();
                await liquidator.liquidatePositions(amountToLiquidate);

                // Check logs are emitted correctly. Partial liquidations should emit an "error"-level alert before a normal liquidation "info"-level alert.
                assert.equal(spy.callCount, 5); // 3 info + 2 error level events should be sent at the conclusion of the 3 liquidations including 2 partials.
                assert.equal(spyLogLevel(spy, 4), "info");
                assert.isTrue(spyLogIncludes(spy, 4, "liquidated"));
                assert.equal(spyLogLevel(spy, 3), "info");
                assert.isTrue(spyLogIncludes(spy, 3, "liquidated"));
                assert.equal(spyLogLevel(spy, 2), "error");
                assert.isTrue(spyLogIncludes(spy, 2, "partial liquidation"));
                assert.equal(spyLogLevel(spy, 1), "info");
                assert.isTrue(spyLogIncludes(spy, 1, "liquidated"));
                assert.equal(spyLogLevel(spy, 0), "error");
                assert.isTrue(spyLogIncludes(spy, 0, "partial liquidation"));

                // Sponsor1 should be in a liquidation state with the bot as the liquidator. (6/12) = 50% of the 100 starting collateral and 6 tokens should be liquidated.
                let liquidationObject = (await financialContract.getLiquidations(sponsor1))[0];
                assert.equal(liquidationObject.sponsor, sponsor1);
                assert.equal(liquidationObject.liquidator, liquidatorBot);
                assert.equal(liquidationObject.state, LiquidationStatesEnum.PRE_DISPUTE);
                assert.equal(liquidationObject.liquidatedCollateral, convertCollateral("50"));
                assert.equal(liquidationObject.tokensOutstanding, convertSynthetic("6"));

                // Sponsor2 should be in a liquidation state with the bot as the liquidator. (3/8) = 37.5% of the 100 starting collateral and 3 tokens should be liquidated.
                liquidationObject = (await financialContract.getLiquidations(sponsor2))[0];
                assert.equal(liquidationObject.sponsor, sponsor2);
                assert.equal(liquidationObject.liquidator, liquidatorBot);
                assert.equal(liquidationObject.state, LiquidationStatesEnum.PRE_DISPUTE);
                assert.equal(liquidationObject.liquidatedCollateral, convertCollateral("37.5"));
                assert.equal(liquidationObject.tokensOutstanding, convertSynthetic("3"));

                // Sponsor3 should be in a liquidation state with the bot as the liquidator. (5/5) = 100% of the 100 starting collateral and 5 tokens should be liquidated.
                liquidationObject = (await financialContract.getLiquidations(sponsor3))[0];
                assert.equal(liquidationObject.sponsor, sponsor3);
                assert.equal(liquidationObject.liquidator, liquidatorBot);
                assert.equal(liquidationObject.state, LiquidationStatesEnum.PRE_DISPUTE);
                assert.equal(liquidationObject.liquidatedCollateral, convertCollateral("100"));
                assert.equal(liquidationObject.tokensOutstanding, convertSynthetic("5"));

                // Sponsor1 should have some collateral and tokens left in their position from the liquidation.
                assert.equal((await financialContract.getCollateral(sponsor1)).rawValue, convertCollateral("50"));
                let positionObject = await financialContract.positions(sponsor1);
                assert.equal(positionObject.tokensOutstanding.rawValue, convertSynthetic("6"));

                // Sponsor2 should have some collateral and tokens left in their position from the liquidation.
                assert.equal((await financialContract.getCollateral(sponsor2)).rawValue, convertCollateral("62.5"));
                positionObject = await financialContract.positions(sponsor2);
                assert.equal(positionObject.tokensOutstanding.rawValue, convertSynthetic("5"));

                // Sponsor3 should not have a position remaining.
                assert.equal((await financialContract.getCollateral(sponsor3)).rawValue, 0);
              }
            );

            versionedIt([{ contractType: "any", contractVersion: "any" }])(
              "amount-to-liquidate < min-sponsor-tokens",
              async function() {
                // We'll attempt to liquidate 4 tokens. The minimum sponsor position is 5. There are 3 different scenarios
                // we should test for, each of which we'll attempt to liquidate in one call of `liquidatePositions`.
                const amountToLiquidate = convertSynthetic("4");

                // 1. (tokens-outstanding - amount-to-liquidate) > min-sponsor-tokens, and amount-to-liquidate < tokens-outstanding.
                //     - The bot will be able to liquidate its desired amount, leaving the position above the minimum token threshold.
                //     - Example: (12 - 4) > 5, new position will have 8 tokens remaining.
                await financialContract.create(
                  { rawValue: convertCollateral("100") },
                  { rawValue: convertSynthetic("12") },
                  { from: sponsor1 }
                );
                // 2. (tokens-outstanding - amount-to-liquidate) < min-sponsor-tokens, and amount-to-liquidate < tokens-outstanding.
                //     - The bot will NOT be able to liquidate its desired amount. It will liquidate a reduced amount and
                //       reduce the position exactly to the minimum.
                //     - Example: (8 - 4) <= 5, so instead the bot will liquidate (8 - 5) = 3 tokens to leave the position with (8 - 3) = 5 tokens remaining.
                await financialContract.create(
                  { rawValue: convertCollateral("100") },
                  { rawValue: convertSynthetic("8") },
                  { from: sponsor2 }
                );
                // 3. amount-to-liquidate < tokens-outstanding, and amount-to-liquidate < min-sponsor-tokens.
                //     - The bot does not have enough balance to send a full liquidation, and partials are not allowed since 5 >= 5.
                await financialContract.create(
                  { rawValue: convertCollateral("100") },
                  { rawValue: convertSynthetic("5") },
                  { from: sponsor3 }
                );

                // liquidatorBot creates a position with enough tokens to liquidate all positions.
                await financialContract.create(
                  { rawValue: convertCollateral("10000") },
                  { rawValue: convertSynthetic("50") },
                  { from: liquidatorBot }
                );

                // Next, assume the price feed given to the liquidator has moved such that the sponsors
                // are all now undercollateralized. The liquidator bot should correctly identify this and liquidate the positions.
                // A price of 25 USD per token will make all positions undercollateralized.
                // Numerically debt * price * coltReq > debt for collateralized position.
                // Sponsor1: 12 * 25 * 1.2 > 100
                // Sponsor2: 8 * 25 * 1.2 > 100
                // Sponsor3: 5 * 25 * 1.2 > 100
                priceFeedMock.setCurrentPrice(convertPrice("25"));

                await liquidator.update();
                await liquidator.liquidatePositions(amountToLiquidate);
                assert.equal(spy.callCount, 5); // 2 info + 3 error level events should be sent at the conclusion of the 2 successful, 2 partial, and 1 failed liquidations.

                // Check logs are emitted correctly. Partial liquidations should emit an "error"-level alert before a normal liquidation "info"-level alert.
                assert.equal(spy.callCount, 5); // 2 info + 3 error level events should be sent at the conclusion of the 2 liquidations, including 2 partials, and 1 failed attempt to liquidate 0 tokens.
                assert.equal(spyLogLevel(spy, 4), "error");
                assert.isTrue(spyLogIncludes(spy, 4, "minimum"));
                assert.equal(spyLogLevel(spy, 3), "info");
                assert.isTrue(spyLogIncludes(spy, 3, "liquidated"));
                assert.equal(spyLogLevel(spy, 2), "error");
                assert.isTrue(spyLogIncludes(spy, 2, "partial liquidation"));
                assert.equal(spyLogLevel(spy, 1), "info");
                assert.isTrue(spyLogIncludes(spy, 1, "liquidated"));
                assert.equal(spyLogLevel(spy, 0), "error");
                assert.isTrue(spyLogIncludes(spy, 0, "partial liquidation"));

                // Sponsor1 should be in a liquidation state with the bot as the liquidator. (4/12) = 33.33% of the 100 starting collateral and 6 tokens should be liquidated.
                let liquidationObject = (await financialContract.getLiquidations(sponsor1))[0];
                assert.equal(liquidationObject.sponsor, sponsor1);
                assert.equal(liquidationObject.liquidator, liquidatorBot);
                assert.equal(liquidationObject.state, LiquidationStatesEnum.PRE_DISPUTE);
                // Dont know how to generalize this check for multi decimal paradigms
                if (testConfig.collateralDecimals == 18) {
                  assert.equal(
                    liquidationObject.liquidatedCollateral.rawValue,
                    convertCollateral("33.3333333333333333")
                  );
                } else if (testConfig.collateralDecimals == 8) {
                  assert.equal(liquidationObject.liquidatedCollateral.rawValue, convertCollateral("33.33333333"));
                }
                assert.equal(liquidationObject.tokensOutstanding.rawValue, convertSynthetic("4"));

                // Sponsor2 should be in a liquidation state with the bot as the liquidator. (3/8) = 37.5% of the 100 starting collateral and 3 tokens should be liquidated.
                liquidationObject = (await financialContract.getLiquidations(sponsor2))[0];
                assert.equal(liquidationObject.sponsor, sponsor2);
                assert.equal(liquidationObject.liquidator, liquidatorBot);
                assert.equal(liquidationObject.state, LiquidationStatesEnum.PRE_DISPUTE);
                assert.equal(liquidationObject.liquidatedCollateral.rawValue, convertCollateral("37.5"));
                assert.equal(liquidationObject.tokensOutstanding.rawValue, convertSynthetic("3"));

                // Sponsor3 should not have been liquidated.

                // Sponsor1 should have some collateral and tokens left in their position from the liquidation.
                // Dont know how to generalize this check for multi decimal paradigms
                if (testConfig.collateralDecimals == 18) {
                  assert.equal(
                    (await financialContract.getCollateral(sponsor1)).rawValue,
                    convertCollateral("66.6666666666666667")
                  );
                } else if (testConfig.collateralDecimals == 8) {
                  assert.equal(
                    (await financialContract.getCollateral(sponsor1)).rawValue,
                    convertCollateral("66.66666667")
                  );
                }
                let positionObject = await financialContract.positions(sponsor1);
                assert.equal(positionObject.tokensOutstanding.rawValue, convertSynthetic("8"));

                // Sponsor2 should have some collateral and tokens left in their position from the liquidation.
                assert.equal((await financialContract.getCollateral(sponsor2)).rawValue, convertCollateral("62.5"));
                positionObject = await financialContract.positions(sponsor2);
                assert.equal(positionObject.tokensOutstanding.rawValue, convertSynthetic("5"));

                // Sponsor3 should have its full position remaining.
                assert.equal((await financialContract.getCollateral(sponsor3)).rawValue, convertCollateral("100"));
                positionObject = await financialContract.positions(sponsor3);
                assert.equal(positionObject.tokensOutstanding.rawValue, convertSynthetic("5"));
              }
            );

            versionedIt([{ contractType: "any", contractVersion: "any" }])(
              "Overriding threshold correctly effects generated logs",
              async function() {
                // Liquidation events normally are `info` level. This override should change the value to `warn` which can be
                // validated after the log is generated.
                liquidatorConfig = { ...liquidatorConfig, logOverrides: { positionLiquidated: "warn" } };
                liquidator = new Liquidator({
                  logger: spyLogger,
                  financialContractClient: financialContractClient,
                  gasEstimator,
                  syntheticToken: syntheticToken.contract,
                  priceFeed: priceFeedMock,
                  account: accounts[0],
                  financialContractProps,
                  liquidatorConfig
                });

                // sponsor1 creates a position with 115 units of collateral, creating 100 synthetic tokens.
                await financialContract.create(
                  { rawValue: convertCollateral("115") },
                  { rawValue: convertSynthetic("100") },
                  { from: sponsor1 }
                );

                // sponsor2 creates a position with 125 units of collateral, creating 100 synthetic tokens.
                await financialContract.create(
                  { rawValue: convertCollateral("125") },
                  { rawValue: convertSynthetic("100") },
                  { from: sponsor2 }
                );

                // liquidatorBot creates a position to have synthetic tokens to pay off debt upon liquidation.
                await financialContract.create(
                  { rawValue: convertCollateral("1000") },
                  { rawValue: convertSynthetic("500") },
                  { from: liquidatorBot }
                );

                priceFeedMock.setCurrentPrice(convertPrice("1"));
                assert.equal(spy.callCount, 0); // No log events before liquidation query
                await liquidator.update();
                await liquidator.liquidatePositions();
                assert.equal(spy.callCount, 1); // 1 log events after liquidation query.
                assert.equal(lastSpyLogLevel(spy), "warn"); // most recent log level should be "warn"
              }
            );

            versionedIt([{ contractType: "any", contractVersion: "any" }])(
              "Can correctly override price feed input",
              async function() {
                // sponsor1 creates a position with 115 units of collateral, creating 100 synthetic tokens.
                await financialContract.create(
                  { rawValue: convertCollateral("115") },
                  { rawValue: convertSynthetic("100") },
                  { from: sponsor1 }
                );

                // sponsor2 creates a position with 125 units of collateral, creating 100 synthetic tokens.
                await financialContract.create(
                  { rawValue: convertCollateral("125") },
                  { rawValue: convertSynthetic("100") },
                  { from: sponsor2 }
                );

                // liquidatorBot creates a position to have synthetic tokens to pay off debt upon liquidation.
                await financialContract.create(
                  { rawValue: convertCollateral("1000") },
                  { rawValue: convertSynthetic("500") },
                  { from: liquidatorBot }
                );

                // specify an override price of 0.5e18.
                liquidatorOverridePrice = convertPrice("0.5");
                // At a price point of 1 sponsor 1 is undercollateralized and sponsor 2 is overcollateralized. However, there
                // is an override price present at 0.5. At this price point neither position is undercollateralized and so
                // there should be no liquidation events generated from the liquidation call.
                priceFeedMock.setCurrentPrice(convertPrice("1"));
                assert.equal(spy.callCount, 0); // No log events before liquidation query

                // Next, call the `liquidatePositions` function with the override price. The `null` param is for
                // `maxTokensToLiquidateWei` which null will attempt to liquidate the full position, if undercollateralized.
                await liquidator.update();
                await liquidator.liquidatePositions(null, liquidatorOverridePrice);
                assert.equal(spy.callCount, 0); // still no liquidation events generated as price override is set to 0.5.

                let liquidationObject = await financialContract.getLiquidations(sponsor1);
                // There should be no liquidation's created.
                assert.equal(liquidationObject.length, 0);

                // Specifying a new override price that places one of the positions undercollateralized should initiate a liquidation.
                // This should again be independent of the price feed.
                priceFeedMock.setCurrentPrice(convertPrice("0.5")); // set the price feed to something that should not create a liquidation.

                liquidatorOverridePrice = convertPrice("1.0"); // specify an override price of 1.0e18. This should place sponsor 1 underwater.
                await liquidator.update();
                await liquidator.liquidatePositions(null, liquidatorOverridePrice);
                assert.equal(spy.callCount, 1); // This should initiate the liquidation event and so there should be 1 log.

                liquidationObject = await financialContract.getLiquidations(sponsor1);
                // There should be one liquidation created.
                assert.equal(liquidationObject.length, 1);
              }
            );
          });
        });
        describe("enabling withdraw defense feature", () => {
          versionedIt([{ contractType: "any", contractVersion: "any" }])("should initialize when enabled", async () => {
            liquidatorConfig = { ...liquidatorConfig, defenseActivationPercent: 50 };
            const liquidator = new Liquidator({
              logger: spyLogger,
              financialContractClient: financialContractClient,
              gasEstimator,
              syntheticToken: syntheticToken.contract,
              priceFeed: priceFeedMock,
              account: accounts[0],
              financialContractProps,
              liquidatorConfig
            });
            assert.ok(liquidator);
          });
          versionedIt([{ contractType: "any", contractVersion: "any" }])(
            "If withdrawal request that's passed liveness, submit full liquidations where possible, or trigger extensions with minimum liquidations",
            async () => {
              liquidatorConfig = {
                ...liquidatorConfig,
                // will extend even if withdraw progress is 80% complete
                defenseActivationPercent: 80
              };
              const withdrawLiveness = financialContractProps.withdrawLiveness.toNumber();
              const liquidator = new Liquidator({
                logger: spyLogger,
                financialContractClient: financialContractClient,
                gasEstimator,
                syntheticToken: syntheticToken.contract,
                priceFeed: priceFeedMock,
                account: accounts[0],
                financialContractProps,
                liquidatorConfig
              });
              await financialContract.create(
                { rawValue: convertCollateral("120") },
                { rawValue: convertSynthetic("100") },
                { from: sponsor1 }
              );
              await financialContract.create(
                { rawValue: convertCollateral("120") },
                { rawValue: convertSynthetic("100") },
                { from: sponsor2 }
              );
              // we will have enough to fully liquidate sponsor1, then we have to extend the other
              await financialContract.create(
                { rawValue: convertCollateral("1000") },
                { rawValue: convertSynthetic("150") },
                { from: liquidatorBot }
              );

              // Start with a mocked price of 1 usd per token.
              // This puts both sponsors over collateralized so no liquidations should occur.
              priceFeedMock.setCurrentPrice(convertPrice("1"));

              // both sponsors under collateralized
              await financialContract.requestWithdrawal({ rawValue: convertCollateral("10") }, { from: sponsor1 });
              await financialContract.requestWithdrawal({ rawValue: convertCollateral("10") }, { from: sponsor2 });
              // advance time passed activation %
              let sponsor2Positions = await financialContract.positions(sponsor2);
              let nextTime = Math.ceil(
                Number(sponsor2Positions.withdrawalRequestPassTimestamp) - withdrawLiveness * 0.2
              );
              await financialContract.setCurrentTime(nextTime);

              // Liquidator only has enough balance to liquidate 1 position fully, will
              // minimally liquidate the other
              await liquidator.update();
              await liquidator.liquidatePositions();

              let [sponsor1Liquidation, sponsor2Liquidation] = [
                (await financialContract.getLiquidations(sponsor1))[0],
                (await financialContract.getLiquidations(sponsor2))[0]
              ];
              assert.equal(sponsor1Liquidation.tokensOutstanding, convertSynthetic("100"));
              assert.equal(sponsor2Liquidation.tokensOutstanding, convertSynthetic("5"));
              // show position has been extended
              sponsor2Positions = await financialContract.positions(sponsor2);
              assert.equal(
                sponsor2Positions.withdrawalRequestPassTimestamp.toNumber(),
                Number(sponsor2Liquidation.liquidationTime) + Number(withdrawLiveness)
              );
              // Updating again, the liquidator should not send another liquidation
              // because the liveness has been reset.
              await liquidator.update();
              await liquidator.liquidatePositions();

              let sponsor2Liquidations = await financialContract.getLiquidations(sponsor2);
              sponsor2Positions = await financialContract.positions(sponsor2);
              // no new liquidations
              assert.equal(sponsor2Liquidations.length, 1);

              // advance time to 50% of withdraw. This should not trigger extension until 80%
              nextTime = Math.ceil(Number(sponsor2Positions.withdrawalRequestPassTimestamp) - withdrawLiveness * 0.5);
              await financialContract.setCurrentTime(nextTime);
              // running again, should have no change
              await liquidator.update();
              await liquidator.liquidatePositions();
              sponsor2Liquidations = await financialContract.getLiquidations(sponsor2);
              sponsor2Positions = await financialContract.positions(sponsor2);
              assert.equal(sponsor2Liquidations.length, 1);

              // Now advance past activation threshold, should see another liquidation
              nextTime = Math.ceil(Number(sponsor2Positions.withdrawalRequestPassTimestamp) - withdrawLiveness * 0.2);
              await financialContract.setCurrentTime(nextTime);
              await liquidator.update();
              await liquidator.liquidatePositions();

              sponsor2Liquidations = await financialContract.getLiquidations(sponsor2);
              sponsor2Positions = await financialContract.positions(sponsor2);
              assert.equal(sponsor2Liquidations.length, 2);
              // min collateral for min liquidation
              assert.equal(sponsor2Liquidations[1].tokensOutstanding.rawValue, convertSynthetic("5"));

              // Now, advance time past the withdrawal liveness and test that the bot
              // uses the remainder of its balance to send a liquidation. Once the withdrawal passes and the liveness
              // can no longer be reset, we should liquidate with as many funds as possible.
              // At this point, sponsor has 90 tokens remaining and the liquidator
              // has 40 tokens left.
              await financialContract.setCurrentTime(sponsor2Positions.withdrawalRequestPassTimestamp);
              await liquidator.update();
              await liquidator.liquidatePositions();

              sponsor2Liquidations = await financialContract.getLiquidations(sponsor2);
              sponsor2Positions = await financialContract.positions(sponsor2);

              // show a fourth liquidation has been added (final liquidation)
              assert.equal(sponsor2Liquidations.length, 3);
              // show position has 90 - 40 = 50 tokens remaining
              assert.equal(sponsor2Positions.tokensOutstanding.rawValue, convertSynthetic("50"));
            }
          );
          versionedIt([{ contractType: "any", contractVersion: "any" }])(
            "if no withdrawal request, then use all available balance to liquidate",
            async () => {
              // If there is no withdrawal liveness that can be extended, either because its absent
              // or it has expired already, then liquidate using as many
              // funds as the bot owns.
              liquidatorConfig = {
                ...liquidatorConfig,
                defenseActivationPercent: 50
              };
              const liquidator = new Liquidator({
                logger: spyLogger,
                financialContractClient,
                gasEstimator,
                syntheticToken: syntheticToken.contract,
                priceFeed: priceFeedMock,
                account: accounts[0],
                financialContractProps,
                liquidatorConfig
              });
              // sponsor1 creates a position with 120 units of collateral, creating 100 synthetic tokens.
              await financialContract.create(
                { rawValue: convertCollateral("120") },
                { rawValue: convertSynthetic("100") },
                { from: sponsor1 }
              );

              // liquidatorBot creates a position to have synthetic tokens to pay off debt upon liquidation.
              // does not have enough to liquidate entire position
              await financialContract.create(
                { rawValue: convertCollateral("1000") },
                { rawValue: convertSynthetic("70") },
                { from: liquidatorBot }
              );

              // Start with a mocked price of 5 usd per token.
              // This makes the sponsor under collateralized even without a withdraw request
              priceFeedMock.setCurrentPrice(convertPrice("5"));
              await liquidator.update();
              await liquidator.liquidatePositions();

              // There should be exactly one liquidation in sponsor1's account that used the entire
              // liquidator bot's balance of 70 tokens.
              let liquidationObject = (await financialContract.getLiquidations(sponsor1))[0];
              assert.equal(liquidationObject.liquidator, liquidatorBot);
              // 70/100 tokens were liquidated, using the liquidator's full balance
              assert.equal(liquidationObject.tokensOutstanding.rawValue, convertSynthetic("70"));

              // Now make a withdrawal request and check that the bot activates its WDF strat
              // and only liquidates the minimum. Create 29 more tokens with which to liquidate,
              // and check that the bot only uses the minimum amount. If the bot
              // had the full 30 amount of tokens needed to retire the position, it would,
              // but otherwise it will just send the minimum
              await financialContract.requestWithdrawal({ rawValue: convertCollateral("10") }, { from: sponsor1 });
              let sponsor1Positions = await financialContract.positions(sponsor1);
              const withdrawLiveness = financialContractProps.withdrawLiveness.toNumber();
              let nextTime = Math.ceil(
                Number(sponsor1Positions.withdrawalRequestPassTimestamp) - withdrawLiveness * 0.5
              );
              await financialContract.setCurrentTime(nextTime);
              await financialContract.create(
                { rawValue: convertCollateral("1000") },
                { rawValue: convertSynthetic("29") },
                { from: liquidatorBot }
              );
              await liquidator.update();
              await liquidator.liquidatePositions();
              liquidationObject = (await financialContract.getLiquidations(sponsor1))[1];
              assert.equal(liquidationObject.liquidator, liquidatorBot);
              // The minimum of 5 tokens should have been liquidated.
              assert.equal(liquidationObject.tokensOutstanding.rawValue, convertSynthetic("5"));
            }
          );
        });
        describe("Liquidator correctly deals with funding rates from perpetual contract", () => {
          versionedIt([{ contractType: "Perpetual", contractVersion: "latest" }])(
            "Can correctly detect invalid positions and liquidate them",
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

              // liquidatorBot creates a position to have synthetic tokens to pay off debt upon liquidation.
              await financialContract.create(
                { rawValue: convertCollateral("1000") },
                { rawValue: convertSynthetic("500") },
                { from: liquidatorBot }
              );

              // Start with a mocked price of 1 usd per token.
              // This puts both sponsors over collateralized so no liquidations should occur.
              priceFeedMock.setCurrentPrice(convertPrice("1"));
              await liquidator.update();
              await liquidator.liquidatePositions();
              // assert.equal(spy.callCount, 0); // No info level logs should be sent.

              // There should be no liquidations created from any sponsor account
              assert.deepStrictEqual(await financialContract.getLiquidations(sponsor1), []);
              assert.deepStrictEqual(await financialContract.getLiquidations(sponsor2), []);
              assert.deepStrictEqual(await financialContract.getLiquidations(sponsor3), []);

              // Both token sponsors should still have their positions with full collateral.
              assert.equal((await financialContract.getCollateral(sponsor1)).rawValue, convertCollateral("125"));
              assert.equal((await financialContract.getCollateral(sponsor2)).rawValue, convertCollateral("150"));
              assert.equal((await financialContract.getCollateral(sponsor3)).rawValue, convertCollateral("175"));

              // Next, introduce some funding rate. Setting the funding rate multiplier to 1.04, results in modifying
              // sponsor's debt. This becomes 100*1.04 = 104. All this debt, with a price of 1, both sponsors are
              // still correctly capatalized with sponsor1 @ 125 / (104 * 1) = 1.202 & sponsor2 @ 150 / (104 * 1) = 1.44.
              // So, if there is 150 collateral backing 105 token debt, with a collateral requirement of 1.2, then
              // the price must be <= 150 / 1.2 / 105 = 1.19. Any price above 1.19 will cause the dispute to fail.
              await _setFundingRateAndAdvanceTime(toWei("0.000004"));
              await financialContract.applyFundingRate();
              assert.equal((await financialContract.fundingRate()).cumulativeMultiplier.toString(), toWei("1.04"));

              priceFeedMock.setCurrentPrice(convertPrice("1"));
              await liquidator.update();
              await liquidator.liquidatePositions();
              assert.equal(spy.callCount, 0); // No info level logs should be sent as no liquidations yet.

              // There should be no liquidations created from any sponsor account
              assert.deepStrictEqual(await financialContract.getLiquidations(sponsor1), []);
              assert.deepStrictEqual(await financialContract.getLiquidations(sponsor2), []);
              assert.deepStrictEqual(await financialContract.getLiquidations(sponsor3), []);

              // Both token sponsors should still have their positions with full collateral.
              assert.equal((await financialContract.getCollateral(sponsor1)).rawValue, convertCollateral("125"));
              assert.equal((await financialContract.getCollateral(sponsor2)).rawValue, convertCollateral("150"));
              assert.equal((await financialContract.getCollateral(sponsor3)).rawValue, convertCollateral("175"));

              // If either the price increase, funding ratemultiplier increase or the sponsors collateral decrease they
              // will be at risk of being liquidated. Say that the funding rate has another 0.01 added to it. The cumulative
              // funding rate will then be 1.04 * (1 + 0.000001 * 10000) = 1.0504. This will place sponsor1 underwater with
              // a CR of 125 / (100 * 1.0504 * 1) = 1.19 (which is less than 1.2) and they should get liquidated by the bot.
              await _setFundingRateAndAdvanceTime(toWei("0.000001"));
              await financialContract.applyFundingRate();
              assert.equal((await financialContract.fundingRate()).cumulativeMultiplier.toString(), toWei("1.0504"));

              await liquidator.update();
              await liquidator.liquidatePositions();
              assert.equal(spy.callCount, 1); // There should be one log from the liquidation event.

              // There should be exactly one liquidation in sponsor1's account. The liquidated collateral should be the original
              // amount of collateral minus the collateral withdrawn. 125 - 10 = 115
              let liquidationObject = (await financialContract.getLiquidations(sponsor1))[0];
              assert.equal(liquidationObject.sponsor, sponsor1);
              assert.equal(liquidationObject.liquidator, liquidatorBot);
              assert.equal(liquidationObject.state, LiquidationStatesEnum.PRE_DISPUTE);
              assert.equal(liquidationObject.liquidatedCollateral.rawValue, convertCollateral("125"));
              assert.equal(liquidationObject.lockedCollateral.rawValue, convertCollateral("125"));

              // No other sponsors should have been liquidated
              assert.deepStrictEqual(await financialContract.getLiquidations(sponsor2), []);
              assert.deepStrictEqual(await financialContract.getLiquidations(sponsor3), []);

              // Next, we can increase the price per token to force sponsor2 to become undercollateralized. At a price of 1.2
              // sponsor2 will become just undercollateralized with the current cumulative funding rate multipler. Their
              // CR can be found by: 150 / (100 * 1.0504 * 1.2) = 1.19  (which is less than 1.2). Sponsor 3 is still safe.
              priceFeedMock.setCurrentPrice(convertPrice("1.2"));
              await liquidator.update();
              await liquidator.liquidatePositions();
              assert.equal(spy.callCount, 2); // 1 new info level events should be sent at the conclusion of the second liquidation.

              liquidationObject = (await financialContract.getLiquidations(sponsor2))[0];
              assert.equal(liquidationObject.sponsor, sponsor2);
              assert.equal(liquidationObject.liquidator, liquidatorBot);
              assert.equal(liquidationObject.state, LiquidationStatesEnum.PRE_DISPUTE);
              assert.equal(liquidationObject.liquidatedCollateral.rawValue, convertCollateral("150"));
              assert.equal(liquidationObject.lockedCollateral.rawValue, convertCollateral("150"));

              // Sponsor3 should not have been liquidated
              assert.deepStrictEqual(await financialContract.getLiquidations(sponsor3), []);

              // Advance the timer to the liquidation expiry.
              const liquidationTime = liquidationObject.liquidationTime;
              await financialContract.setCurrentTime(Number(liquidationTime) + 1000);

              // Now that the liquidation has expired, the liquidator can withdraw rewards.
              const collateralPreWithdraw = await collateralToken.balanceOf(liquidatorBot);
              await liquidator.update();
              await liquidator.withdrawRewards();

              assert.equal(spy.callCount, 4); // 2 new info level events should be sent for withdrawing the two liquidations.

              // Liquidator should have their collateral increased by Sponsor1 + Sponsor2's collateral
              const collateralPostWithdraw = await collateralToken.balanceOf(liquidatorBot);
              assert.equal(
                toBN(collateralPreWithdraw)
                  .add(toBN(convertCollateral("125")))
                  .add(toBN(convertCollateral("150")))
                  .toString(),
                collateralPostWithdraw.toString()
              );

              // Liquidation data should have been deleted.
              assert.deepStrictEqual(
                (await financialContract.getLiquidations(sponsor1))[0].state,
                LiquidationStatesEnum.UNINITIALIZED
              );
              assert.deepStrictEqual(
                (await financialContract.getLiquidations(sponsor2))[0].state,
                LiquidationStatesEnum.UNINITIALIZED
              );

              // The other two positions should not have any liquidations associated with them.
              assert.deepStrictEqual(await financialContract.getLiquidations(sponsor3), []);
            }
          );
        });
      });
    }
  });
});

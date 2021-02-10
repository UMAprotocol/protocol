const { toWei, utf8ToHex, padRight } = web3.utils;
const winston = require("winston");

const {
  interfaceName,
  parseFixed,
  MAX_UINT_VAL,
  advanceBlockAndSetTime,
  runTestForVersion,
  createConstructorParamsForContractVersion,
  TESTED_CONTRACT_VERSIONS
} = require("@uma/common");
const { getTruffleContract } = require("@uma/core");

// Script to test
const { FinancialContractEventClient } = require("../../src/clients/FinancialContractEventClient");

// Run the tests against 3 different kinds of token/synth decimal combinations:
// 1) matching 18 & 18 for collateral for most token types with normal tokens.
// 2) non-matching 8 collateral & 18 synthetic for legacy UMA synthetics.
// 3) matching 8 collateral & 8 synthetic for current UMA synthetics.
const configs = [
  { tokenSymbol: "WETH", collateralDecimals: 18, syntheticDecimals: 18, priceFeedDecimals: 18 },
  { tokenSymbol: "BTC", collateralDecimals: 8, syntheticDecimals: 18, priceFeedDecimals: 8 },
  { tokenSymbol: "BTC", collateralDecimals: 8, syntheticDecimals: 8, priceFeedDecimals: 18 }
];

const startTime = "15798990420";
const unreachableDeadline = MAX_UINT_VAL;

// Common contract objects.
let collateralToken;
let syntheticToken;
let financialContract;
let mockOracle;
let identifierWhitelist;
let identifier;
let finder;
let store;
let timer;
let collateralWhitelist;
let constructorParams;
let iterationTestVersion;

// Js Objects, clients and helpers
let client;
let convertCollateral;
let convertSynthetic;
let convertPrice;
let dummyLogger;
let expirationTime;

// Perpetual
let configStore;
let optimisticOracle;
let fundingRateIdentifier;

// Track new sponsor positions created in the `beforeEach` block so that we can test event querying for NewSponsor events.
let newSponsorTxObj1;
let newSponsorTxObj2;
let newSponsorTxObj3;

const Convert = decimals => number => parseFixed(number.toString(), decimals).toString();

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

contract("FinancialContractEventClient.js", function(accounts) {
  for (let tokenConfig of configs) {
    describe(`${tokenConfig.collateralDecimals} decimals`, function() {
      const tokenSponsor = accounts[0];
      const liquidator = accounts[1];
      const sponsor1 = accounts[2];
      const sponsor2 = accounts[3];
      const sponsor3 = accounts[4];

      TESTED_CONTRACT_VERSIONS.forEach(function(contractVersion) {
        // Store the contractVersion.contractVersion, type and version being tested
        iterationTestVersion = contractVersion;

        // Import the tested versions of contracts. note that financialContract is either an ExpiringMultiParty or a
        // Perpetual depending on the current iteration version.
        const FinancialContract = getTruffleContract(
          contractVersion.contractType,
          web3,
          contractVersion.contractVersion
        );
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

        for (let testConfig of configs) {
          describe(`${testConfig.collateralDecimals} collateral, ${testConfig.syntheticDecimals} synthetic & ${testConfig.priceFeedDecimals} pricefeed decimals, on for smart contract version ${contractVersion.contractType} @ ${contractVersion.contractVersion}`, function() {
            before(async function() {
              identifier = `${testConfig.tokenName}TEST`;
              fundingRateIdentifier = `${testConfig.tokenName}_FUNDING_IDENTIFIER`;
              convertCollateral = Convert(testConfig.collateralDecimals);
              convertSynthetic = Convert(testConfig.syntheticDecimals);
              convertPrice = Convert(testConfig.priceFeedDecimals);
              collateralToken = await Token.new(
                testConfig.tokenSymbol + " Token", // Construct the token name.,
                testConfig.tokenSymbol,
                tokenConfig.collateralDecimals,
                {
                  from: tokenSponsor
                }
              );
              await collateralToken.addMember(1, tokenSponsor, { from: tokenSponsor });
              await collateralToken.mint(liquidator, convertCollateral("100000"), { from: tokenSponsor });
              await collateralToken.mint(sponsor1, convertCollateral("100000"), { from: tokenSponsor });
              await collateralToken.mint(sponsor2, convertCollateral("100000"), { from: tokenSponsor });
              await collateralToken.mint(sponsor3, convertCollateral("100000"), { from: tokenSponsor });

              identifierWhitelist = await IdentifierWhitelist.new();
              await identifierWhitelist.addSupportedIdentifier(utf8ToHex(identifier));

              finder = await Finder.new();
              timer = await Timer.new();

              store = await Store.new({ rawValue: "0" }, { rawValue: "0" }, timer.address);
              await finder.changeImplementationAddress(utf8ToHex(interfaceName.Store), store.address);

              collateralWhitelist = await AddressWhitelist.new();
              await finder.changeImplementationAddress(
                web3.utils.utf8ToHex(interfaceName.CollateralWhitelist),
                collateralWhitelist.address
              );
              await collateralWhitelist.addToWhitelist(collateralToken.address);

              await finder.changeImplementationAddress(
                utf8ToHex(interfaceName.IdentifierWhitelist),
                identifierWhitelist.address
              );
            });

            beforeEach(async function() {
              mockOracle = await MockOracle.new(finder.address, timer.address);
              await finder.changeImplementationAddress(utf8ToHex(interfaceName.Oracle), mockOracle.address);

              await timer.setCurrentTime(startTime - 1);
              const currentTime = await mockOracle.getCurrentTime.call();
              expirationTime = currentTime.toNumber() + 100; // 100 seconds in the future

              // Create a new synthetic token
              syntheticToken = await SyntheticToken.new(
                "Test Synthetic Token",
                "SYNTH",
                tokenConfig.syntheticDecimals,
                {
                  from: tokenSponsor
                }
              );

              // If we are testing a perpetual then we need to also deploy a config store, an optimistic oracle and set the funding rate identifier.
              if (contractVersion.contractType == "Perpetual") {
                configStore = await ConfigStore.new(
                  {
                    timelockLiveness: 86400, // 1 day
                    rewardRatePerSecond: { rawValue: "0" },
                    proposerBondPercentage: { rawValue: "0" },
                    maxFundingRate: { rawValue: convertSynthetic("0.00001") },
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
                {
                  minSponsorTokens: { rawValue: convertSynthetic("1") },
                  collateralRequirement: { rawValue: toWei("1.5") }, // these tests assume a CR of 1.5, not the 1.2 default.
                  expirationTimestamp: expirationTime.toString()
                }
              );

              financialContract = await FinancialContract.new(constructorParams);

              await syntheticToken.addMinter(financialContract.address);
              await syntheticToken.addBurner(financialContract.address);

              // The FinancialContractEventClient does not emit any info level events. Therefore no need to test Winston outputs.
              dummyLogger = winston.createLogger({
                level: "info",
                transports: [new winston.transports.Console()]
              });

              // If we are testing a perpetual then we need to apply the initial funding rate to start the timer.
              await financialContract.setCurrentTime(startTime);
              if (contractVersion.contractType == "Perpetual") await financialContract.applyFundingRate();

              client = new FinancialContractEventClient(
                dummyLogger,
                financialContract.abi,
                web3,
                financialContract.address,
                0, // startingBlockNumber
                null, // endingBlockNumber
                contractVersion.contractType,
                contractVersion.contractVersion
              );
              await collateralToken.approve(financialContract.address, convertCollateral("1000000"), {
                from: sponsor1
              });
              await collateralToken.approve(financialContract.address, convertCollateral("1000000"), {
                from: sponsor2
              });
              await collateralToken.approve(financialContract.address, convertCollateral("1000000"), {
                from: sponsor3
              });

              syntheticToken = await Token.at(await financialContract.tokenCurrency());
              await syntheticToken.approve(financialContract.address, convertSynthetic("100000000"), {
                from: sponsor1
              });
              await syntheticToken.approve(financialContract.address, convertSynthetic("100000000"), {
                from: sponsor2
              });

              // Create two positions
              newSponsorTxObj1 = await financialContract.create(
                { rawValue: convertCollateral("10") },
                { rawValue: convertSynthetic("50") },
                { from: sponsor1 }
              );
              newSponsorTxObj2 = await financialContract.create(
                { rawValue: convertCollateral("100") },
                { rawValue: convertSynthetic("45") },
                { from: sponsor2 }
              );

              // Seed the liquidator position
              await collateralToken.approve(financialContract.address, convertCollateral("1000000"), {
                from: liquidator
              });
              await syntheticToken.approve(financialContract.address, convertSynthetic("100000000"), {
                from: liquidator
              });
              newSponsorTxObj3 = await financialContract.create(
                { rawValue: convertCollateral("500") },
                { rawValue: convertSynthetic("200") },
                { from: liquidator }
              );
            });

            versionedIt([{ contractType: "any", contractVersion: "any" }])(
              "Return NewSponsor Events",
              async function() {
                // Update the client and check it has the new sponsor event stored correctly
                await client.clearState();

                // State is empty before update().
                assert.deepStrictEqual([], client.getAllNewSponsorEvents());

                await client.update();

                // Compare with expected processed event objects
                assert.deepStrictEqual(
                  [
                    {
                      transactionHash: newSponsorTxObj1.tx,
                      blockNumber: newSponsorTxObj1.receipt.blockNumber,
                      sponsor: sponsor1,
                      collateralAmount: convertCollateral("10"),
                      tokenAmount: convertSynthetic("50")
                    },
                    {
                      transactionHash: newSponsorTxObj2.tx,
                      blockNumber: newSponsorTxObj2.receipt.blockNumber,
                      sponsor: sponsor2,
                      collateralAmount: convertCollateral("100"),
                      tokenAmount: convertSynthetic("45")
                    },
                    {
                      transactionHash: newSponsorTxObj3.tx,
                      blockNumber: newSponsorTxObj3.receipt.blockNumber,
                      sponsor: liquidator,
                      collateralAmount: convertCollateral("500"),
                      tokenAmount: convertSynthetic("200")
                    }
                  ],
                  client.getAllNewSponsorEvents()
                );

                // Correctly adds only new events after last query
                const newSponsorTxObj4 = await financialContract.create(
                  { rawValue: convertCollateral("10") },
                  { rawValue: convertSynthetic("1") },
                  { from: sponsor3 }
                );
                await client.clearState();
                await client.update();

                assert.deepStrictEqual(
                  [
                    {
                      transactionHash: newSponsorTxObj4.tx,
                      blockNumber: newSponsorTxObj4.receipt.blockNumber,
                      sponsor: sponsor3,
                      collateralAmount: convertCollateral("10"),
                      tokenAmount: convertSynthetic("1")
                    }
                  ],
                  client.getAllNewSponsorEvents()
                );
              }
            );

            versionedIt([{ contractType: "any", contractVersion: "any" }])("Return Create Events", async function() {
              // Update the client and check it has the new sponsor event stored correctly
              await client.clearState();

              // State is empty before update().
              assert.deepStrictEqual([], client.getAllCreateEvents());

              await client.update();

              // Compare with expected processed event objects
              assert.deepStrictEqual(
                [
                  {
                    transactionHash: newSponsorTxObj1.tx,
                    blockNumber: newSponsorTxObj1.receipt.blockNumber,
                    sponsor: sponsor1,
                    collateralAmount: convertCollateral("10"),
                    tokenAmount: convertSynthetic("50")
                  },
                  {
                    transactionHash: newSponsorTxObj2.tx,
                    blockNumber: newSponsorTxObj2.receipt.blockNumber,
                    sponsor: sponsor2,
                    collateralAmount: convertCollateral("100"),
                    tokenAmount: convertSynthetic("45")
                  },
                  {
                    transactionHash: newSponsorTxObj3.tx,
                    blockNumber: newSponsorTxObj3.receipt.blockNumber,
                    sponsor: liquidator,
                    collateralAmount: convertCollateral("500"),
                    tokenAmount: convertSynthetic("200")
                  }
                ],
                client.getAllCreateEvents()
              );

              // Correctly adds only new events after last query
              const newSponsorTxObj4 = await financialContract.create(
                { rawValue: convertCollateral("10") },
                { rawValue: convertSynthetic("1") },
                { from: sponsor3 }
              );
              await client.clearState();
              await client.update();

              assert.deepStrictEqual(
                [
                  {
                    transactionHash: newSponsorTxObj4.tx,
                    blockNumber: newSponsorTxObj4.receipt.blockNumber,
                    sponsor: sponsor3,
                    collateralAmount: convertCollateral("10"),
                    tokenAmount: convertSynthetic("1")
                  }
                ],
                client.getAllCreateEvents()
              );
            });

            versionedIt([{ contractType: "any", contractVersion: "any" }])("Return Deposit Events", async function() {
              // Update the client and check it has the new sponsor event stored correctly
              await client.clearState();

              // State is empty before update().
              assert.deepStrictEqual([], client.getAllDepositEvents());

              const depositTxObj1 = await financialContract.deposit(
                { rawValue: convertCollateral("5") },
                { from: sponsor1 }
              );

              await client.update();

              // Compare with expected processed event objects
              assert.deepStrictEqual(
                [
                  {
                    transactionHash: depositTxObj1.tx,
                    blockNumber: depositTxObj1.receipt.blockNumber,
                    sponsor: sponsor1,
                    collateralAmount: convertCollateral("5")
                  }
                ],
                client.getAllDepositEvents()
              );

              // Correctly adds only new events after last query
              const depositTxObj2 = await financialContract.deposit(
                { rawValue: convertCollateral("3") },
                { from: sponsor2 }
              );
              await client.clearState();
              await client.update();

              assert.deepStrictEqual(
                [
                  {
                    transactionHash: depositTxObj2.tx,
                    blockNumber: depositTxObj2.receipt.blockNumber,
                    sponsor: sponsor2,
                    collateralAmount: convertCollateral("3")
                  }
                ],
                client.getAllDepositEvents()
              );
            });

            versionedIt([{ contractType: "any", contractVersion: "any" }])("Return Withdraw Events", async function() {
              // Update the client and check it has the new sponsor event stored correctly
              await client.clearState();

              // State is empty before update().
              assert.deepStrictEqual([], client.getAllWithdrawEvents());

              // GCR is ~2.0, so sponsor2 and liquidator should be able to withdraw small amounts while keeping their CR above GCR.
              const withdrawTxObj1 = await financialContract.withdraw(
                { rawValue: convertCollateral("1") },
                { from: liquidator }
              );

              await client.update();

              // Compare with expected processed event objects
              assert.deepStrictEqual(
                [
                  {
                    transactionHash: withdrawTxObj1.tx,
                    blockNumber: withdrawTxObj1.receipt.blockNumber,
                    sponsor: liquidator,
                    collateralAmount: convertCollateral("1")
                  }
                ],
                client.getAllWithdrawEvents()
              );

              // Correctly adds only new events after last query
              const withdrawTxObj2 = await financialContract.withdraw(
                { rawValue: convertCollateral("2") },
                { from: sponsor2 }
              );
              await client.clearState();
              await client.update();

              assert.deepStrictEqual(
                [
                  {
                    transactionHash: withdrawTxObj2.tx,
                    blockNumber: withdrawTxObj2.receipt.blockNumber,
                    sponsor: sponsor2,
                    collateralAmount: convertCollateral("2")
                  }
                ],
                client.getAllWithdrawEvents()
              );
            });

            versionedIt([{ contractType: "any", contractVersion: "any" }])("Return Redeem Events", async function() {
              // Update the client and check it has the new sponsor event stored correctly
              await client.clearState();

              // State is empty before update().
              assert.deepStrictEqual([], client.getAllRedeemEvents());

              // Redeem from liquidator who has many more than the min token amount
              const redeemTxObj1 = await financialContract.redeem(
                { rawValue: convertSynthetic("1") },
                { from: liquidator }
              );

              await client.update();

              // Compare with expected processed event objects
              assert.deepStrictEqual(
                [
                  {
                    transactionHash: redeemTxObj1.tx,
                    blockNumber: redeemTxObj1.receipt.blockNumber,
                    sponsor: liquidator,
                    collateralAmount: convertCollateral("2.5"),
                    tokenAmount: convertSynthetic("1")
                  }
                ],
                client.getAllRedeemEvents()
              );

              // Correctly adds only new events after last query
              const redeemTxObj2 = await financialContract.redeem(
                { rawValue: convertSynthetic("1") },
                { from: sponsor1 }
              );
              await client.clearState();
              await client.update();

              assert.deepStrictEqual(
                [
                  {
                    transactionHash: redeemTxObj2.tx,
                    blockNumber: redeemTxObj2.receipt.blockNumber,
                    sponsor: sponsor1,
                    collateralAmount: convertCollateral("0.2"),
                    tokenAmount: convertSynthetic("1")
                  }
                ],
                client.getAllRedeemEvents()
              );
            });

            versionedIt([{ contractType: "any", contractVersion: "any" }])(
              "Return RegularFee Events",
              async function() {
                await client.clearState();

                // State is empty before update()
                assert.deepStrictEqual([], client.getAllRegularFeeEvents());

                // Set fees to 1% per second and advance 1 second.
                await store.setFixedOracleFeePerSecondPerPfc({ rawValue: toWei("0.01") });
                await timer.setCurrentTime((await store.getCurrentTime()).toNumber() + 1);
                const regularFeeTxObj1 = await financialContract.payRegularFees();

                await client.update();

                // Compare with expected processed event objects.
                // The starting collateral is 610 so 6.1 are paid in fees.
                assert.deepStrictEqual(
                  [
                    {
                      transactionHash: regularFeeTxObj1.tx,
                      blockNumber: regularFeeTxObj1.receipt.blockNumber,
                      regularFee: convertCollateral("6.1"),
                      lateFee: convertSynthetic("0")
                    }
                  ],
                  client.getAllRegularFeeEvents()
                );

                // Correctly adds only new events after last query.
                // 1% of (610-6.1) = 603.9 is 6.039
                await timer.setCurrentTime((await timer.getCurrentTime()).toNumber() + 1);
                const regularFeeTxObj2 = await financialContract.payRegularFees();
                await client.clearState();
                await client.update();

                assert.deepStrictEqual(
                  [
                    {
                      transactionHash: regularFeeTxObj2.tx,
                      blockNumber: regularFeeTxObj2.receipt.blockNumber,
                      regularFee: convertCollateral("6.039"),
                      lateFee: convertSynthetic("0")
                    }
                  ],
                  client.getAllRegularFeeEvents()
                );

                // Reset fees
                await store.setFixedOracleFeePerSecondPerPfc({ rawValue: "0" });
              }
            );

            versionedIt([{ contractType: "ExpiringMultiParty", contractVersion: "1.2.2" }])(
              "Return FinalFee Events",
              async function() {
                // Update the client and check it has the new sponsor event stored correctly
                await client.clearState();

                // State is empty before update()
                assert.deepStrictEqual([], client.getAllFinalFeeEvents());

                await store.setFinalFee(collateralToken.address, { rawValue: convertCollateral("1") });
                await financialContract.createLiquidation(
                  sponsor1,
                  { rawValue: "0" },
                  { rawValue: convertPrice("99999") },
                  { rawValue: convertSynthetic("1") },
                  unreachableDeadline,
                  { from: liquidator }
                );

                // Compare with expected processed event objects.
                const finalFeeTxObj1 = await financialContract.dispute("0", sponsor1, { from: sponsor2 });
                await client.update();
                assert.deepStrictEqual(
                  [
                    {
                      transactionHash: finalFeeTxObj1.tx,
                      blockNumber: finalFeeTxObj1.receipt.blockNumber,
                      amount: convertCollateral("1")
                    }
                  ],
                  client.getAllFinalFeeEvents()
                );

                // Correctly adds only new events after last query.
                await timer.setCurrentTime(await financialContract.expirationTimestamp());
                const finalFeeTxObj2 = await financialContract.expire();
                await client.clearState();
                await client.update();
                assert.deepStrictEqual(
                  [
                    {
                      transactionHash: finalFeeTxObj2.tx,
                      blockNumber: finalFeeTxObj2.receipt.blockNumber,
                      amount: convertCollateral("1")
                    }
                  ],
                  client.getAllFinalFeeEvents()
                );

                // Reset fees
                await store.setFinalFee(collateralToken.address, { rawValue: "0" });
              }
            );

            versionedIt([{ contractType: "any", contractVersion: "any" }])(
              "Return Liquidation Events",
              async function() {
                // Create liquidation to liquidate sponsor2 from sponsor1
                const txObject1 = await financialContract.createLiquidation(
                  sponsor1,
                  { rawValue: "0" },
                  { rawValue: convertPrice("99999") },
                  { rawValue: convertSynthetic("100") },
                  unreachableDeadline,
                  { from: liquidator }
                );

                // Update the client and check it has the liquidation event stored correctly
                await client.clearState();

                // State is empty before update().
                assert.deepStrictEqual([], client.getAllLiquidationEvents());

                await client.update();

                // Compare with expected processed event object
                assert.deepStrictEqual(
                  [
                    {
                      transactionHash: txObject1.tx,
                      blockNumber: txObject1.receipt.blockNumber,
                      sponsor: sponsor1,
                      liquidator: liquidator,
                      liquidationId: "0",
                      tokensOutstanding: convertSynthetic("50"),
                      lockedCollateral: convertCollateral("10"),
                      liquidatedCollateral: convertCollateral("10")
                    }
                  ],
                  client.getAllLiquidationEvents()
                );

                // Correctly adds a second event after creating a new liquidation
                const txObject2 = await financialContract.createLiquidation(
                  sponsor2,
                  { rawValue: "0" },
                  { rawValue: convertPrice("99999") },
                  { rawValue: convertSynthetic("100") },
                  unreachableDeadline,
                  { from: liquidator }
                );
                await client.clearState();
                await client.update();
                assert.deepStrictEqual(
                  [
                    {
                      transactionHash: txObject2.tx,
                      blockNumber: txObject2.receipt.blockNumber,
                      sponsor: sponsor2,
                      liquidator: liquidator,
                      liquidationId: "0",
                      tokensOutstanding: convertSynthetic("45"),
                      lockedCollateral: convertCollateral("100"),
                      liquidatedCollateral: convertCollateral("100")
                    }
                  ],
                  client.getAllLiquidationEvents()
                );
              }
            );

            versionedIt([{ contractType: "any", contractVersion: "any" }])("Return Dispute Events", async function() {
              // Create liquidation to liquidate sponsor2 from sponsor1
              await financialContract.createLiquidation(
                sponsor1,
                { rawValue: "0" },
                { rawValue: convertPrice("99999") },
                { rawValue: convertSynthetic("100") },
                unreachableDeadline,
                { from: liquidator }
              );

              const txObject = await financialContract.dispute("0", sponsor1, { from: sponsor2 });

              // Update the client and check it has the dispute event stored correctly
              await client.clearState();

              // State is empty before update().
              assert.deepStrictEqual([], client.getAllDisputeEvents());

              await client.update();

              // Compare with expected processed event object
              assert.deepStrictEqual(
                [
                  {
                    transactionHash: txObject.tx,
                    blockNumber: txObject.receipt.blockNumber,
                    sponsor: sponsor1,
                    liquidator: liquidator,
                    disputer: sponsor2,
                    liquidationId: "0",
                    disputeBondAmount: convertCollateral("1") // 10% of the liquidated position's collateral.
                  }
                ],
                client.getAllDisputeEvents()
              );
            });

            versionedIt([{ contractType: "any", contractVersion: "any" }])(
              "Return Dispute Settlement Events",
              async function() {
                // Create liquidation to liquidate sponsor2 from sponsor1
                const liquidationTime = (await financialContract.getCurrentTime()).toNumber();
                await financialContract.createLiquidation(
                  sponsor1,
                  { rawValue: "0" },
                  { rawValue: convertPrice("99999") },
                  { rawValue: convertSynthetic("100") },
                  unreachableDeadline,
                  { from: liquidator }
                );

                // Dispute the position from the second sponsor
                await financialContract.dispute("0", sponsor1, {
                  from: sponsor2
                });

                // Advance time and settle
                const timeAfterLiquidationLiveness = liquidationTime + 10;
                await mockOracle.setCurrentTime(timeAfterLiquidationLiveness.toString());
                await financialContract.setCurrentTime(timeAfterLiquidationLiveness.toString());

                // Force a price such that the dispute fails, and then withdraw from the unsuccessfully
                // disputed liquidation.
                const disputePrice = convertPrice("1.6");
                await mockOracle.pushPrice(utf8ToHex(identifier), liquidationTime, disputePrice);

                const txObject = await financialContract.withdrawLiquidation("0", sponsor1, { from: liquidator });
                await client.clearState();

                // State is empty before update().
                assert.deepStrictEqual([], client.getAllDisputeSettlementEvents());

                // Update the client and check it has the dispute event stored correctly
                await client.update();

                // Compare with expected processed event object
                assert.deepStrictEqual(
                  [
                    {
                      transactionHash: txObject.tx,
                      blockNumber: txObject.receipt.blockNumber,
                      caller: liquidator,
                      sponsor: sponsor1,
                      liquidator: liquidator,
                      disputer: sponsor2,
                      liquidationId: "0",
                      disputeSucceeded: false // Settlement price makes liquidation valid
                    }
                  ],
                  client.getAllDisputeSettlementEvents()
                );
              }
            );

            versionedIt([{ contractType: "any", contractVersion: "any" }])(
              "Return Liquidation Withdrawn Events",
              async function() {
                // Create liquidation to liquidate sponsor1
                const liquidationTime = (await financialContract.getCurrentTime()).toNumber();
                await financialContract.createLiquidation(
                  sponsor1,
                  { rawValue: "0" },
                  { rawValue: convertPrice("99999") },
                  { rawValue: convertSynthetic("100") },
                  unreachableDeadline,
                  { from: liquidator }
                );

                // Dispute the position from the second sponsor
                await financialContract.dispute("0", sponsor1, {
                  from: sponsor2
                });

                // Advance time and settle
                const timeAfterLiquidationLiveness = liquidationTime + 10;
                await mockOracle.setCurrentTime(timeAfterLiquidationLiveness.toString());
                await financialContract.setCurrentTime(timeAfterLiquidationLiveness.toString());

                // Force a price such that the dispute succeeds, and then withdraw from the successfully
                // disputed liquidation.
                const disputePrice = convertPrice("0.1");
                await mockOracle.pushPrice(utf8ToHex(identifier), liquidationTime, disputePrice);

                const txObject = await financialContract.withdrawLiquidation("0", sponsor1, { from: liquidator });
                await client.clearState();

                // State is empty before update().
                assert.deepStrictEqual([], client.getAllLiquidationWithdrawnEvents());

                // Update the client and check it has the liquidation withdrawn event stored correctly
                await client.update();

                // Compare with expected processed event object
                assert.deepStrictEqual(
                  [
                    {
                      transactionHash: txObject.tx,
                      blockNumber: txObject.receipt.blockNumber,
                      caller: liquidator,
                      withdrawalAmount: convertCollateral("4"), // On successful disputes, liquidator gets TRV - dispute rewards. TRV = (50 * 0.1 = 5), and rewards = (TRV * 0.1 = 5 * 0.1 = 0.5).
                      liquidationStatus: "3" // Settlement price makes dispute successful
                    }
                  ],
                  client.getAllLiquidationWithdrawnEvents()
                );
              }
            );

            versionedIt([{ contractType: "ExpiringMultiParty", contractVersion: "1.2.2" }])(
              "Return SettleExpiredPosition Events",
              async function() {
                await client.clearState();

                // State is empty before update()
                assert.deepStrictEqual([], client.getAllSettleExpiredPositionEvents());

                // Expire contract at settlement price of 0.2.
                await timer.setCurrentTime(expirationTime.toString());
                // Make the contract creator the admin to enable emergencyshutdown in tests.
                await finder.changeImplementationAddress(
                  utf8ToHex(interfaceName.FinancialContractsAdmin),
                  tokenSponsor
                );

                await financialContract.expire();
                await mockOracle.pushPrice(utf8ToHex(identifier), expirationTime.toString(), convertPrice("0.2"));
                const txObject = await financialContract.settleExpired({ from: sponsor1 });

                await client.update();

                // Compare with expected processed event objects.
                assert.deepStrictEqual(
                  [
                    {
                      transactionHash: txObject.tx,
                      blockNumber: txObject.receipt.blockNumber,
                      caller: sponsor1,
                      collateralReturned: convertCollateral("10"), // Sponsor should get back all collateral in position because they still hold all tokens
                      tokensBurned: convertSynthetic("50")
                    }
                  ],
                  client.getAllSettleExpiredPositionEvents()
                );

                // Correctly adds only new events after last query.
                const txObject2 = await financialContract.settleExpired({ from: sponsor2 });
                await client.clearState();
                await client.update();
                assert.deepStrictEqual(
                  [
                    {
                      transactionHash: txObject2.tx,
                      blockNumber: txObject2.receipt.blockNumber,
                      caller: sponsor2,
                      collateralReturned: convertCollateral("100"), // Sponsor should get back all collateral in position because they still hold all tokens
                      tokensBurned: convertSynthetic("45")
                    }
                  ],
                  client.getAllSettleExpiredPositionEvents()
                );
              }
            );

            versionedIt([{ contractType: "any", contractVersion: "any" }])(
              "Starting client at an offset block number",
              async function() {
                // Init the Financial Contract event client with an offset block number. If the current block number is used then all log events
                // generated before the creation of the client should not be included. Rather, only subsequent logs should be reported.

                // Create liquidation (in the past)
                await financialContract.createLiquidation(
                  sponsor1,
                  { rawValue: "0" },
                  { rawValue: convertPrice("99999") },
                  { rawValue: convertSynthetic("100") },
                  unreachableDeadline,
                  { from: liquidator }
                );

                // Start the liquidator bot from current time stamp (liquidation in the past)
                const currentBlockNumber = await web3.eth.getBlockNumber();
                const offSetClient = new FinancialContractEventClient(
                  dummyLogger,
                  financialContract.abi,
                  web3,
                  financialContract.address,
                  currentBlockNumber + 1, // Start the bot one block after the liquidation event
                  null, // ending block number
                  contractVersion.contractType,
                  contractVersion.contractVersion
                );
                const currentTimestamp = (await web3.eth.getBlock("latest")).timestamp;
                await advanceBlockAndSetTime(web3, currentTimestamp + 1);
                await advanceBlockAndSetTime(web3, currentTimestamp + 2);
                await advanceBlockAndSetTime(web3, currentTimestamp + 3);

                await offSetClient.update();

                assert.deepStrictEqual([], offSetClient.getAllLiquidationEvents()); // Created liquidation should not be captured
                assert.deepStrictEqual([], offSetClient.getAllDisputeEvents());
                assert.deepStrictEqual([], offSetClient.getAllDisputeSettlementEvents());
              }
            );
          });
        }
      });
    });
  }
});

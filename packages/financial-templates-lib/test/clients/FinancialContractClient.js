const { toWei, toBN, utf8ToHex, padRight } = web3.utils;
const { parseFixed } = require("@ethersproject/bignumber");
const winston = require("winston");

const {
  interfaceName,
  MAX_UINT_VAL,
  runTestForVersion,
  createConstructorParamsForContractVersion,
  TESTED_CONTRACT_VERSIONS,
  TEST_DECIMAL_COMBOS,
} = require("@uma/common");
const { getTruffleContract } = require("@uma/core");

// Script to test
const { FinancialContractClient } = require("../../src/clients/FinancialContractClient");

const startTime = "15798990420";
const zeroAddress = "0x0000000000000000000000000000000000000000";
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
let multicallContract;

// Js Objects, clients and helpers
let client;
let convertDecimals;
let dummyLogger;

// Perpetual
let configStore;
let optimisticOracle;
let fundingRateIdentifier;

// Helper functions
const updateAndVerify = async (client, expectedSponsors, expectedPositions) => {
  await client.update();
  assert.deepStrictEqual(client.getAllSponsors().sort(), expectedSponsors.sort());
  assert.deepStrictEqual(client.getAllPositions().sort(), expectedPositions.sort());
};

// Set the funding rate and advances time by 10k seconds.
const _setFundingRateAndAdvanceTime = async (fundingRate) => {
  const currentTime = (await financialContract.getCurrentTime()).toNumber();
  await financialContract.proposeFundingRate({ rawValue: fundingRate }, currentTime);
  await financialContract.setCurrentTime(currentTime + 10000);
};

// If the current version being executed is part of the `supportedVersions` array then return `it` to run the test.
// Else, do nothing. Can be used exactly in place of a normal `it` to parameterize contract types and versions supported
// for a given test.eg: versionedIt([{ contractType: "Perpetual", contractVersion: "latest" }])("test name", async function () { assert.isTrue(true) })
// Note that a second param can be provided to make the test an `it.only` thereby ONLY running that single test, on
// the provided version. This is very useful for debugging and writing single unit tests without having ro run all tests.
const versionedIt = function (supportedVersions, shouldBeItOnly = false) {
  if (shouldBeItOnly)
    return runTestForVersion(supportedVersions, TESTED_CONTRACT_VERSIONS, iterationTestVersion) ? it.only : () => {};
  return runTestForVersion(supportedVersions, TESTED_CONTRACT_VERSIONS, iterationTestVersion) ? it : () => {};
};

const Convert = (decimals) => (number) => parseFixed(number.toString(), decimals).toString();

contract("FinancialContractClient.js", function (accounts) {
  const sponsor1 = accounts[0];
  const sponsor2 = accounts[1];

  TESTED_CONTRACT_VERSIONS.forEach(function (contractVersion) {
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
    const ConfigStore = getTruffleContract("ConfigStore", web3, contractVersion.contractVersion);
    const OptimisticOracle = getTruffleContract("OptimisticOracle", web3, contractVersion.contractVersion);
    const MulticallMock = getTruffleContract("MulticallMock", web3);

    for (let testConfig of TEST_DECIMAL_COMBOS) {
      describe(`${testConfig.collateralDecimals} collateral, ${testConfig.syntheticDecimals} synthetic & ${testConfig.priceFeedDecimals} pricefeed decimals, on for smart contract version ${contractVersion.contractType} @ ${contractVersion.contractVersion}`, function () {
        before(async function () {
          identifier = `${testConfig.tokenName}TEST`;
          fundingRateIdentifier = `${testConfig.tokenName}_FUNDING_IDENTIFIER`;
          convertDecimals = Convert(testConfig.collateralDecimals);
          collateralToken = await Token.new(
            testConfig.tokenSymbol + "Token", // Construct the token name.
            testConfig.tokenSymbol,
            testConfig.collateralDecimals,
            {
              from: sponsor1,
            }
          );
          syntheticToken = await SyntheticToken.new("Test Synthetic Token", "SYNTH", testConfig.syntheticDecimals, {
            from: sponsor1,
          });
          await collateralToken.addMember(1, sponsor1, { from: sponsor1 });
          await collateralToken.mint(sponsor1, convertDecimals("1000000000"), { from: sponsor1 });
          await collateralToken.mint(sponsor2, convertDecimals("1000000000"), { from: sponsor1 });

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

          mockOracle = await MockOracle.new(finder.address, timer.address);
          await finder.changeImplementationAddress(utf8ToHex(interfaceName.Oracle), mockOracle.address);

          multicallContract = await MulticallMock.new();
        });

        beforeEach(async function () {
          await timer.setCurrentTime(startTime - 1);

          // If we are testing a perpetual then we need to also deploy a config store, an optimistic oracle and set the funding rate identifier.
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
            await finder.changeImplementationAddress(
              utf8ToHex(interfaceName.OptimisticOracle),
              optimisticOracle.address
            );
          }

          constructorParams = await createConstructorParamsForContractVersion(
            contractVersion,
            {
              convertDecimals,
              finder,
              collateralToken,
              syntheticToken,
              identifier,
              fundingRateIdentifier,
              timer,
              store,
              configStore: configStore || {}, // if the contract type is not a perp this will be null.
            },
            { collateralRequirement: { rawValue: toWei("1.5") } } // these tests assume a CR of 1.5, not the 1.2 default.
          );

          financialContract = await FinancialContract.new(constructorParams);
          await syntheticToken.addMinter(financialContract.address);
          await syntheticToken.addBurner(financialContract.address);

          await collateralToken.approve(financialContract.address, convertDecimals("1000000"), { from: sponsor1 });
          await collateralToken.approve(financialContract.address, convertDecimals("1000000"), { from: sponsor2 });
          await syntheticToken.approve(financialContract.address, convertDecimals("100000000"), { from: sponsor1 });
          await syntheticToken.approve(financialContract.address, convertDecimals("100000000"), { from: sponsor2 });

          // If we are testing a perpetual then we need to apply the initial funding rate to start the timer.
          await financialContract.setCurrentTime(startTime);

          // The FinancialContractClient does not emit any info `level` events.  Therefore no need to test Winston outputs.
          // DummyLogger will not print anything to console as only capture `info` level events.
          dummyLogger = winston.createLogger({
            level: "info",
            transports: [new winston.transports.Console()],
          });

          client = new FinancialContractClient(
            dummyLogger,
            financialContract.abi,
            web3,
            financialContract.address,
            multicallContract.address,
            testConfig.collateralDecimals,
            testConfig.syntheticDecimals,
            testConfig.priceFeedDecimals,
            contractVersion.contractType // either ExpiringMultiParty OR Perpetual depending on the test
          );
        });
        versionedIt([{ contractType: "any", contractVersion: "any" }])("Returns all positions", async function () {
          // Create a position and check that it is detected correctly from the client.
          await financialContract.create(
            { rawValue: convertDecimals("10") },
            { rawValue: convertDecimals("50") },
            { from: sponsor1 }
          );
          await updateAndVerify(
            client,
            [sponsor1], // expected sponsor
            [
              {
                sponsor: sponsor1,
                adjustedTokens: convertDecimals("50"),
                numTokens: convertDecimals("50"),
                amountCollateral: convertDecimals("10"),
                hasPendingWithdrawal: false,
                withdrawalRequestPassTimestamp: "0",
                withdrawalRequestAmount: "0",
              },
            ] // expected position
          );

          // Calling create again from the same sponsor should add additional collateral & debt.
          await financialContract.create(
            { rawValue: convertDecimals("10") },
            { rawValue: convertDecimals("50") },
            { from: sponsor1 }
          );
          await updateAndVerify(
            client,
            [sponsor1],
            [
              {
                sponsor: sponsor1,
                adjustedTokens: convertDecimals("100"),
                numTokens: convertDecimals("100"),
                amountCollateral: convertDecimals("20"),
                hasPendingWithdrawal: false,
                withdrawalRequestPassTimestamp: "0",
                withdrawalRequestAmount: "0",
              },
            ]
          );

          // Calling create from a new address will create a new position and this should be added the the client.
          await financialContract.create(
            { rawValue: convertDecimals("100") },
            { rawValue: convertDecimals("45") },
            { from: sponsor2 }
          );
          await updateAndVerify(
            client,
            [sponsor1, sponsor2],
            [
              {
                sponsor: sponsor1,
                adjustedTokens: convertDecimals("100"),
                numTokens: convertDecimals("100"),
                amountCollateral: convertDecimals("20"),
                hasPendingWithdrawal: false,
                withdrawalRequestPassTimestamp: "0",
                withdrawalRequestAmount: "0",
              },
              {
                sponsor: sponsor2,
                adjustedTokens: convertDecimals("45"),
                numTokens: convertDecimals("45"),
                amountCollateral: convertDecimals("100"),
                hasPendingWithdrawal: false,
                withdrawalRequestPassTimestamp: "0",
                withdrawalRequestAmount: "0",
              },
            ]
          );

          // If a position is liquidated it should be removed from the list of positions and added to the undisputed liquidations.
          const { liquidationId } = await financialContract.createLiquidation.call(
            sponsor2,
            { rawValue: "0" },
            { rawValue: toWei("99999") },
            { rawValue: toWei("100") },
            unreachableDeadline,
            { from: sponsor1 }
          );
          await financialContract.createLiquidation(
            sponsor2,
            { rawValue: "0" },
            { rawValue: toWei("99999") },
            { rawValue: toWei("100") },
            unreachableDeadline,
            { from: sponsor1 }
          );

          await updateAndVerify(
            client,
            [sponsor1],
            [
              {
                sponsor: sponsor1,
                adjustedTokens: convertDecimals("100"),
                numTokens: convertDecimals("100"),
                amountCollateral: convertDecimals("20"),
                hasPendingWithdrawal: false,
                withdrawalRequestPassTimestamp: "0",
                withdrawalRequestAmount: "0",
              },
            ]
          );
          const expectedLiquidations = [
            {
              sponsor: sponsor2,
              id: liquidationId.toString(),
              numTokens: convertDecimals("45"),
              liquidatedCollateral: convertDecimals("100"),
              lockedCollateral: convertDecimals("100"),
              liquidationTime: (await financialContract.getCurrentTime()).toString(),
              state: "1",
              liquidator: sponsor1,
              disputer: zeroAddress,
            },
          ];
          assert.deepStrictEqual(expectedLiquidations.sort(), client.getUndisputedLiquidations().sort());

          // Pending withdrawals state should be correctly identified.
          await financialContract.requestWithdrawal(
            {
              rawValue: convertDecimals("10"),
            },
            {
              from: sponsor1,
            }
          );
          await client.update();

          await updateAndVerify(
            client,
            [sponsor1],
            [
              {
                sponsor: sponsor1,
                adjustedTokens: convertDecimals("100"),
                numTokens: convertDecimals("100"),
                amountCollateral: convertDecimals("20"),
                hasPendingWithdrawal: true,
                withdrawalRequestPassTimestamp: (await financialContract.getCurrentTime())
                  .add(await financialContract.withdrawalLiveness())
                  .toString(),
                withdrawalRequestAmount: convertDecimals("10"),
              },
            ]
          );

          // Remove the pending withdrawal and ensure it is removed from the client.
          await financialContract.cancelWithdrawal({
            from: sponsor1,
          });
          await client.update();
          await updateAndVerify(
            client,
            [sponsor1],
            [
              {
                sponsor: sponsor1,
                adjustedTokens: convertDecimals("100"),
                numTokens: convertDecimals("100"),
                amountCollateral: convertDecimals("20"),
                hasPendingWithdrawal: false,
                withdrawalRequestPassTimestamp: "0",
                withdrawalRequestAmount: "0",
              },
            ]
          );

          // Correctly returns sponsors who create, redeem.
          await financialContract.create(
            { rawValue: convertDecimals("100") },
            { rawValue: convertDecimals("45") },
            { from: sponsor2 }
          );
          await financialContract.redeem({ rawValue: convertDecimals("45") }, { from: sponsor2 });
          // as created and redeemed sponsor should not show up in table as they are no longer an active sponsor.

          await updateAndVerify(
            client,
            [sponsor1],
            [
              {
                sponsor: sponsor1,
                adjustedTokens: convertDecimals("100"),
                numTokens: convertDecimals("100"),
                amountCollateral: convertDecimals("20"),
                hasPendingWithdrawal: false,
                withdrawalRequestPassTimestamp: "0",
                withdrawalRequestAmount: "0",
              },
            ]
          );
          // If sponsor, creates, redeemes and then creates again they should now appear in the table.
          await financialContract.create(
            { rawValue: convertDecimals("100") },
            { rawValue: convertDecimals("45") },
            { from: sponsor2 }
          );
          await financialContract.redeem({ rawValue: convertDecimals("45") }, { from: sponsor2 });
          await financialContract.create(
            { rawValue: convertDecimals("100") },
            { rawValue: convertDecimals("45") },
            { from: sponsor2 }
          );
          await financialContract.redeem({ rawValue: convertDecimals("45") }, { from: sponsor2 });
          await financialContract.create(
            { rawValue: convertDecimals("100") },
            { rawValue: convertDecimals("45") },
            { from: sponsor2 }
          );

          await updateAndVerify(
            client,
            [sponsor1, sponsor2],
            [
              {
                sponsor: sponsor1,
                adjustedTokens: convertDecimals("100"),
                numTokens: convertDecimals("100"),
                amountCollateral: convertDecimals("20"),
                hasPendingWithdrawal: false,
                withdrawalRequestPassTimestamp: "0",
                withdrawalRequestAmount: "0",
              },
              {
                sponsor: sponsor2,
                adjustedTokens: convertDecimals("45"),
                numTokens: convertDecimals("45"),
                amountCollateral: convertDecimals("100"),
                hasPendingWithdrawal: false,
                withdrawalRequestPassTimestamp: "0",
                withdrawalRequestAmount: "0",
              },
            ]
          );
        });

        versionedIt([{ contractType: "any", contractVersion: "any" }])(
          "Returns undercollateralized positions",
          async function () {
            await financialContract.create(
              { rawValue: convertDecimals("150") },
              { rawValue: convertDecimals("100") },
              { from: sponsor1 }
            );
            await financialContract.create(
              { rawValue: convertDecimals("1500") },
              { rawValue: convertDecimals("100") },
              { from: sponsor2 }
            );

            await client.update();
            // At 150% collateralization requirement, the position is just collateralized enough at a token price of 1.
            assert.deepStrictEqual([], client.getUnderCollateralizedPositions(toWei("1")));
            // Undercollateralized at a price just above 1.
            assert.deepStrictEqual(
              [
                {
                  sponsor: sponsor1,
                  adjustedTokens: convertDecimals("100"),
                  numTokens: convertDecimals("100"),
                  amountCollateral: convertDecimals("150"),
                  hasPendingWithdrawal: false,
                  withdrawalRequestPassTimestamp: "0",
                  withdrawalRequestAmount: "0",
                },
              ],
              client.getUnderCollateralizedPositions(toWei("1.00000001"))
            );

            // After submitting a withdraw request that brings the position below the CR ratio the client should detect this.
            // Withdrawing just 1 wei of collateral will place the position below the CR ratio.
            await financialContract.requestWithdrawal({ rawValue: convertDecimals("1") }, { from: sponsor1 });

            await client.update();
            // Update client to get withdrawal information.
            const currentTime = Number(await financialContract.getCurrentTime());
            assert.deepStrictEqual(
              [
                {
                  sponsor: sponsor1,
                  adjustedTokens: convertDecimals("100"),
                  numTokens: convertDecimals("100"),
                  amountCollateral: convertDecimals("150"),
                  hasPendingWithdrawal: true,
                  withdrawalRequestPassTimestamp: (currentTime + 1000).toString(),
                  withdrawalRequestAmount: convertDecimals("1"),
                },
              ],
              client.getUnderCollateralizedPositions(toWei("1"))
            );
          }
        );

        versionedIt([{ contractType: "any", contractVersion: "any" }])(
          "Returns undisputed liquidations",
          async function () {
            const liquidator = sponsor2;

            await financialContract.create(
              { rawValue: convertDecimals("150") },
              { rawValue: convertDecimals("100") },
              { from: sponsor1 }
            );
            await syntheticToken.transfer(liquidator, convertDecimals("100"), {
              from: sponsor1,
            });

            // Create a new liquidation for account[0]'s position.
            const { liquidationId } = await financialContract.createLiquidation.call(
              sponsor1,
              { rawValue: "0" },
              { rawValue: toWei("9999999") },
              { rawValue: toWei("100") },
              unreachableDeadline,
              {
                from: liquidator,
              }
            );
            await financialContract.createLiquidation(
              sponsor1,
              { rawValue: "0" },
              { rawValue: toWei("9999999") },
              { rawValue: toWei("100") },
              unreachableDeadline,
              { from: liquidator }
            );
            await client.update();

            const liquidations = client.getUndisputedLiquidations();
            // Disputable if the disputer believes the price was `1`, and not disputable if they believe the price was just
            // above `1`.
            assert.isTrue(client.isDisputable(liquidations[0], toWei("1")));
            assert.isFalse(client.isDisputable(liquidations[0], toWei("1.00000001")));

            // Dispute the liquidation and make sure it no longer shows up in the list.
            // We need to advance the Oracle time forward to make `requestPrice` work.
            await mockOracle.setCurrentTime(Number(await financialContract.getCurrentTime()) + 1);
            await financialContract.dispute(liquidationId.toString(), sponsor1, {
              from: sponsor1,
            });
            await client.update();

            // The disputed liquidation should no longer show up as undisputed.
            assert.deepStrictEqual([], client.getUndisputedLiquidations().sort());
          }
        );

        versionedIt([{ contractType: "any", contractVersion: "any" }])(
          "Returns expired liquidations",
          async function () {
            const liquidator = sponsor2;

            await financialContract.create(
              { rawValue: convertDecimals("150") },
              { rawValue: convertDecimals("100") },
              { from: sponsor1 }
            );
            await syntheticToken.transfer(liquidator, convertDecimals("100"), {
              from: sponsor1,
            });
            await financialContract.requestWithdrawal(
              {
                rawValue: convertDecimals("10"),
              },
              {
                from: sponsor1,
              }
            );

            // Create a new liquidation for account[0]'s position.
            await financialContract.createLiquidation.call(
              sponsor1,
              { rawValue: "0" },
              { rawValue: toWei("9999999") },
              { rawValue: toWei("100") },
              unreachableDeadline,
              {
                from: liquidator,
              }
            );
            await financialContract.createLiquidation(
              sponsor1,
              { rawValue: "0" },
              { rawValue: toWei("9999999") },
              { rawValue: toWei("100") },
              unreachableDeadline,
              {
                from: liquidator,
              }
            );
            await client.update();

            const liquidations = client.getUndisputedLiquidations();
            const liquidationTime = liquidations[0].liquidationTime;
            assert.deepStrictEqual(
              [
                {
                  sponsor: sponsor1,
                  id: "0",
                  state: "1",
                  liquidationTime: liquidationTime,
                  numTokens: convertDecimals("100"),
                  liquidatedCollateral: convertDecimals("140"),
                  // This should `lockedCollateral` reduced by requested withdrawal amount
                  lockedCollateral: convertDecimals("150"),
                  liquidator: liquidator,
                  disputer: zeroAddress,
                },
              ],
              liquidations
            );
            assert.deepStrictEqual([], client.getExpiredLiquidations().sort());

            // Move Financial Contract time to the liquidation's expiry.
            const liquidationLiveness = 1000;
            await financialContract.setCurrentTime(Number(liquidationTime) + liquidationLiveness);
            await client.update();

            // The liquidation is registered by the Financial Contract client as expired.
            assert.deepStrictEqual([], client.getUndisputedLiquidations().sort());
            const expiredLiquidations = client.getExpiredLiquidations();
            assert.deepStrictEqual(
              [
                {
                  sponsor: sponsor1,
                  id: "0",
                  state: "1",
                  liquidationTime: liquidationTime,
                  numTokens: convertDecimals("100"),
                  liquidatedCollateral: convertDecimals("140"),
                  lockedCollateral: convertDecimals("150"),
                  liquidator: liquidator,
                  disputer: zeroAddress,
                },
              ],
              expiredLiquidations
            );

            // Withdraw from the expired liquidation and check that the liquidation is deleted.
            await financialContract.withdrawLiquidation("0", sponsor1, {
              from: liquidator,
            });
            await client.update();
            assert.deepStrictEqual([], client.getExpiredLiquidations().sort());
          }
        );

        versionedIt([{ contractType: "any", contractVersion: "any" }])(
          "Returns disputed liquidations",
          async function () {
            const liquidator = sponsor2;

            await financialContract.create(
              { rawValue: convertDecimals("150") },
              { rawValue: convertDecimals("100") },
              {
                from: sponsor1,
              }
            );
            await syntheticToken.transfer(liquidator, convertDecimals("100"), {
              from: sponsor1,
            });

            // Create a new liquidation for account[0]'s position.
            const { liquidationId } = await financialContract.createLiquidation.call(
              sponsor1,
              { rawValue: "0" },
              {
                rawValue: toWei("9999999"),
              },
              { rawValue: toWei("100") },
              unreachableDeadline,
              { from: liquidator }
            );
            await financialContract.createLiquidation(
              sponsor1,
              { rawValue: "0" },
              { rawValue: toWei("9999999") },
              { rawValue: toWei("100") },
              unreachableDeadline,
              { from: liquidator }
            );
            await client.update();
            const liquidations = client.getUndisputedLiquidations();
            const liquidationTime = liquidations[0].liquidationTime;

            // There should be no disputed liquidations initially.
            assert.deepStrictEqual([], client.getDisputedLiquidations().sort());

            // Dispute the liquidation and make sure it no longer shows up in the list.
            // We need to advance the Oracle time forward to make `requestPrice` work.
            await mockOracle.setCurrentTime(Number(await financialContract.getCurrentTime()) + 1);
            await financialContract.dispute(liquidationId.toString(), sponsor1, {
              from: sponsor1,
            });
            await client.update();

            // The disputed liquidation should no longer show up as undisputed.
            assert.deepStrictEqual(
              [
                {
                  sponsor: sponsor1,
                  id: "0",
                  state: "2",
                  liquidationTime: liquidationTime,
                  numTokens: convertDecimals("100"),
                  liquidatedCollateral: convertDecimals("150"),
                  lockedCollateral: convertDecimals("150"),
                  liquidator: liquidator,
                  disputer: sponsor1,
                },
              ],
              client.getDisputedLiquidations().sort()
            );
            assert.deepStrictEqual([], client.getUndisputedLiquidations().sort());

            // Force a price such that the dispute fails, and then
            // withdraw from the unsuccessfully disputed liquidation and check that the liquidation is deleted.
            const disputePrice = toWei("1.6");
            await mockOracle.pushPrice(utf8ToHex(identifier), liquidationTime, disputePrice);
            await financialContract.withdrawLiquidation("0", sponsor1, {
              from: liquidator,
            });
            await client.update();
            assert.deepStrictEqual([], client.getDisputedLiquidations().sort());
          }
        );

        versionedIt([{ contractType: "ExpiringMultiParty", contractVersion: "2.0.1" }])(
          "Client correctly defaults to ExpiringMultiParty to enable backward compatibility",
          async function () {
            // The constructor of the Financial Contract client does not contain any type.
            // It should therefore default to the Financial Contract which ensures that packages that are yet to update.
            client = new FinancialContractClient(
              dummyLogger,
              financialContract.abi,
              web3,
              financialContract.address,
              multicallContract.address,
              testConfig.collateralDecimals,
              testConfig.syntheticDecimals,
              testConfig.priceFeedDecimals
            );
            assert.equal(client.getContractType(), "ExpiringMultiParty");
          }
        );
        versionedIt([{ contractType: "ExpiringMultiParty", contractVersion: "2.0.1" }])(
          "Correctly rejects invalid contract types",
          async function () {
            let didThrow = false;
            try {
              client = new FinancialContractClient(
                dummyLogger,
                financialContract.abi,
                web3,
                financialContract.address,
                multicallContract.address,
                testConfig.collateralDecimals,
                testConfig.syntheticDecimals,
                testConfig.priceFeedDecimals,
                "ExpiringMultiPartyV2" // some contract name that does not exist
              );
            } catch (error) {
              didThrow = true;
            }
            assert.isTrue(didThrow);
            didThrow = false;
            try {
              client = new FinancialContractClient(
                dummyLogger,
                financialContract.abi,
                web3,
                financialContract.address,
                multicallContract.address,
                testConfig.collateralDecimals,
                testConfig.syntheticDecimals,
                testConfig.priceFeedDecimals,
                null // some contract name that does not exist
              );
            } catch (error) {
              didThrow = true;
            }
            assert.isTrue(didThrow);
          }
        );
        versionedIt([{ contractType: "Perpetual", contractVersion: "2.0.1" }])(
          "Fetches funding rate from the perpetual contract and correctly applies it to token debt",
          async function () {
            // Create a position and check that it is detected correctly from the client.
            await financialContract.create(
              { rawValue: convertDecimals("10") },
              { rawValue: convertDecimals("50") },
              { from: sponsor1 }
            );
            await updateAndVerify(
              client,
              [sponsor1], // expected sponsor
              [
                {
                  sponsor: sponsor1,
                  adjustedTokens: convertDecimals("50"),
                  numTokens: convertDecimals("50"),
                  amountCollateral: convertDecimals("10"),
                  hasPendingWithdrawal: false,
                  withdrawalRequestPassTimestamp: "0",
                  withdrawalRequestAmount: "0",
                },
              ] // expected position
            );

            // Set a funding rate
            await _setFundingRateAndAdvanceTime(toWei("0.000005"));

            // funding rate change is not detected until the client is updated.
            assert.equal(client.getLatestCumulativeFundingRateMultiplier(), toWei("1"));

            // After updating the client the pending funding rate should be detected.
            await client.update();
            assert.equal(client.getLatestCumulativeFundingRateMultiplier(), toWei("1.05"));

            // But, the on-chain state has not changed! This is possible because the client
            // uses the Multicall contract to simulate how `applyFundingRate()` would
            // affect `fundingRate()`.
            const onchainFundingRate = await financialContract.fundingRate();
            assert.equal(onchainFundingRate.cumulativeMultiplier.rawValue, toWei("1"));

            // Correctly scales sponsors token debt by the funding rate
            await updateAndVerify(
              client,
              [sponsor1],
              [
                {
                  sponsor: sponsor1,
                  numTokens: convertDecimals("50"),
                  adjustedTokens: toBN(convertDecimals("50"))
                    .mul(toBN(toWei("1.05")))
                    .div(toBN(toWei("1")))
                    .toString(), // the funding rate should be applied to the num of tokens
                  amountCollateral: convertDecimals("10"),
                  hasPendingWithdrawal: false,
                  withdrawalRequestPassTimestamp: "0",
                  withdrawalRequestAmount: "0",
                },
              ]
            );
          }
        );
        versionedIt([{ contractType: "Perpetual", contractVersion: "2.0.1" }])(
          "Correctly applies funding rate to token debt. Liquidatable and disputable position are updated accordingly",
          async function () {
            await financialContract.create(
              { rawValue: convertDecimals("150") },
              { rawValue: convertDecimals("100") },
              { from: sponsor1 }
            );
            await financialContract.create(
              { rawValue: convertDecimals("175") },
              { rawValue: convertDecimals("100") },
              { from: sponsor2 }
            );

            await client.update();
            // At 150% collateralization requirement, the position is just collateralized enough at a token price of 1.
            // At any positive funding rate value the first position should become undercollateralied.
            assert.deepStrictEqual([], client.getUnderCollateralizedPositions(toWei("1")));
            // Undercollateralized at a price just above 1.
            assert.deepStrictEqual(
              [
                {
                  sponsor: sponsor1,
                  adjustedTokens: convertDecimals("100"),
                  numTokens: convertDecimals("100"),
                  amountCollateral: convertDecimals("150"),
                  hasPendingWithdrawal: false,
                  withdrawalRequestPassTimestamp: "0",
                  withdrawalRequestAmount: "0",
                },
              ],
              client.getUnderCollateralizedPositions(toWei("1.00000001"))
            );

            // Or, undercollateralized at a price of 1 with a small funding rate applied. Funding rate of 0.000001 applied
            // over 10k seconds resulting in 0.01 cumulative multiplier. At a price of 1 this works out to a CR of:
            // 150 / (100 * 1.01 * 1) = 1.485, which is less than the CR requirement of 1.5
            await _setFundingRateAndAdvanceTime(toWei("0.000001"));
            // Should not need to call `applyFundingRate()` in order for client to detect publishable
            // funding rate proposals.
            await client.update();

            assert.deepStrictEqual(
              [
                {
                  sponsor: sponsor1,
                  adjustedTokens: toBN(convertDecimals("100"))
                    .mul(toBN(toWei("1.01")))
                    .div(toBN(toWei("1")))
                    .toString(), // the funding rate should be applied to the num of tokens
                  numTokens: convertDecimals("100"),
                  amountCollateral: convertDecimals("150"),
                  hasPendingWithdrawal: false,
                  withdrawalRequestPassTimestamp: "0",
                  withdrawalRequestAmount: "0",
                },
              ],
              client.getUnderCollateralizedPositions(toWei("1"))
            );

            // Now liquidate the position, advance some time so the current funding rate changes, and check that the
            // client's stored liquidation state has the correct funding-rate adjusted amount of tokens outstanding for
            // the liquidation time, not the current time.
            await financialContract.createLiquidation(
              sponsor1,
              { rawValue: "0" },
              { rawValue: toWei("9999999") },
              // Note: Liquidates the full position of 100 tokens
              { rawValue: toWei("100") },
              unreachableDeadline,
              { from: sponsor2 }
            );
            const currentTime = (await financialContract.getCurrentTime()).toNumber();
            // Note: Advance < liquidationLiveness amount of time so that liquidation still appears under
            // undisputedLiquidations struct:
            await financialContract.setCurrentTime(currentTime + 999);
            await financialContract.applyFundingRate();
            const currentFundingRateData = await financialContract.fundingRate();
            // Here we show that current funding rate multiplier has increased:
            assert.isTrue(toBN(currentFundingRateData.cumulativeMultiplier.rawValue).gt(toWei("1.01")));
            await client.update();
            assert.deepStrictEqual(
              [
                {
                  sponsor: sponsor1,
                  id: "0",
                  state: "1",
                  liquidationTime: currentTime.toString(),
                  // Here the `numTokens` should adjust for the CFRM at the time of liquidation, not the current one!
                  numTokens: convertDecimals("101"),
                  liquidatedCollateral: convertDecimals("150"),
                  lockedCollateral: convertDecimals("150"),
                  liquidator: sponsor2,
                  disputer: zeroAddress,
                },
              ],
              client.getUndisputedLiquidations()
            );
          }
        );
      });
    }
  });
});

const { toWei, toBN, utf8ToHex, padRight } = web3.utils;
const { parseFixed } = require("@ethersproject/bignumber");
const winston = require("winston");

const { interfaceName, MAX_UINT_VAL, ZERO_ADDRESS } = require("@uma/common");
const { getTruffleContract } = require("@uma/core");

// Script to test
const { ExpiringMultiPartyClient } = require("../../src/clients/ExpiringMultiPartyClient");

// Run the tests against 3 different kinds of token/synth decimal combinations:
// 1) matching 18 & 18 for collateral for most token types with normal tokens.
// 2) non-matching 8 collateral & 18 synthetic for legacy UMA synthetics.
// 3) matching 8 collateral & 8 synthetic for current UMA synthetics.
const configs = [
  { tokenSymbol: "WETH", collateralDecimals: 18, syntheticDecimals: 18, priceFeedDecimals: 18 },
  { tokenSymbol: "BTC", collateralDecimals: 8, syntheticDecimals: 18, priceFeedDecimals: 8 },
  { tokenSymbol: "BTC", collateralDecimals: 8, syntheticDecimals: 8, priceFeedDecimals: 18 }
];

// These unit tests are re-run against the array of contract types and versions below. unit tests can choose which version
// they support using the `versionedIt` syntax. Additional versions can be added, once an UMA release has been done.
const SUPPORTED_CONTRACT_VERSIONS = ["ExpiringMultiParty-1.2.2", "ExpiringMultiParty-latest", "Perpetual-latest"];

const startTime = "15798990420";
const zeroAddress = "0x0000000000000000000000000000000000000000";
const unreachableDeadline = MAX_UINT_VAL;

// Common contract objects.
let collateralToken;
let syntheticToken;
let emp;
let mockOracle;
let identifierWhitelist;
let identifier;
let finder;
let store;
let timer;
let collateralWhitelist;
let constructorParams;
let currentTestIterationVersion;

// Js Objects, clients and helpers
let client;
let convertCollateral;
let convertSynthetic;
let convertPrice;
let dummyLogger;

// Perpetual
let configStore;
let optimisticOracle;
let fundingRateIdentifier;

// Helper functions
// TODO figure out the best pattern to refactor these into a library to make them re-usable in other tests.
const updateAndVerify = async (client, expectedSponsors, expectedPositions) => {
  await client.update();
  assert.deepStrictEqual(client.getAllSponsors().sort(), expectedSponsors.sort());
  assert.deepStrictEqual(client.getAllPositions().sort(), expectedPositions.sort());
};

// Set the funding rate and advances time by 10k seconds.
const _setFundingRateAndAdvanceTime = async fundingRate => {
  const currentTime = (await emp.getCurrentTime()).toNumber();
  await emp.proposeFundingRate({ rawValue: fundingRate }, currentTime);
  await emp.setCurrentTime(currentTime + 10000);
};

// If the current version being executed is part of the `supportedVersions` array then return `it` to run the test.
// Else, do nothing. Can be used exactly in place of a normal `it` to parameterize contract types and versions supported
// for a given test.eg: versionedIt(["Perpetual-latest"])("test name", async function () { assert.isTrue(true) })
// Note that a second param can be provided to make the test an `it.only` thereby ONLY running that single test, on
// the provided version. This is very useful for debugging and writing single unit tests without having ro run all tests.
const versionedIt = function(supportedVersions, shouldBeItOnly = false) {
  if (shouldBeItOnly) return runTestForContractVersion(supportedVersions) ? it.only : () => {};
  return runTestForContractVersion(supportedVersions) ? it : () => {};
};

const runTestForContractVersion = function(supportedVersions) {
  // Validate that the array of supportedVersions provided is in the SUPPORTED_CONTRACT_VERSIONS OR is any.
  if ([...SUPPORTED_CONTRACT_VERSIONS, "any"].filter(value => supportedVersions.includes(value)).length == 0) {
    throw new Error(
      `Contract versioned specified ${supportedVersions} is not part of the supported contracts for this test suit`
    );
  }
  // Return if the `currentTestIterationVersion` is part of the supported versions includes any. Returning true
  // means that test will be run. Else, if returned false, the test will be skipped.
  return supportedVersions.includes(currentTestIterationVersion) || supportedVersions.includes("any");
};

const _createConstructorParamsForContractVersion = async function(contractVersion, contractType) {
  let constructorParams = {
    expirationTimestamp: (await timer.getCurrentTime()).toNumber() + 100000,
    withdrawalLiveness: "1000",
    collateralAddress: collateralToken.address,
    tokenAddress: syntheticToken.address,
    finderAddress: finder.address,
    priceFeedIdentifier: padRight(utf8ToHex(identifier), 64),
    liquidationLiveness: "1000",
    collateralRequirement: { rawValue: toWei("1.5") },
    disputeBondPercentage: { rawValue: toWei("0.1") },
    sponsorDisputeRewardPercentage: { rawValue: toWei("0.1") },
    disputerDisputeRewardPercentage: { rawValue: toWei("0.1") },
    minSponsorTokens: { rawValue: convertSynthetic("5") },
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

    fundingRateIdentifier = web3.utils.utf8ToHex("TEST_FUNDING_IDENTIFIER");
    await identifierWhitelist.addSupportedIdentifier(fundingRateIdentifier);
    constructorParams.fundingRateIdentifier = fundingRateIdentifier;
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

const Convert = decimals => number => parseFixed(number.toString(), decimals).toString();

contract("ExpiringMultiPartyClient.js", function(accounts) {
  const sponsor1 = accounts[0];
  const sponsor2 = accounts[1];

  SUPPORTED_CONTRACT_VERSIONS.forEach(function(contractVersion) {
    // Store the currentVersionTested, type and version being tested
    currentTestIterationVersion = contractVersion;
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
    const Store = getTruffleContract("Store", web3, currentVersionTested);

    for (let testConfig of configs) {
      describe(`${testConfig.collateralDecimals} collateral, ${testConfig.syntheticDecimals} synthetic & ${testConfig.priceFeedDecimals} pricefeed decimals, on for smart contract version ${contractVersion}`, function() {
        before(async function() {
          identifier = `${testConfig.tokenName}TEST`;
          convertCollateral = Convert(testConfig.collateralDecimals);
          convertSynthetic = Convert(testConfig.syntheticDecimals);
          convertPrice = Convert(testConfig.priceFeedDecimals);
          collateralToken = await Token.new(
            testConfig.tokenSymbol + "Token", // Construct the token name.
            testConfig.tokenSymbol,
            testConfig.collateralDecimals,
            {
              from: sponsor1
            }
          );
          syntheticToken = await SyntheticToken.new("Test Synthetic Token", "SYNTH", testConfig.syntheticDecimals, {
            from: sponsor1
          });
          await collateralToken.addMember(1, sponsor1, { from: sponsor1 });
          await collateralToken.mint(sponsor1, convertSynthetic("1000000000"), { from: sponsor1 });
          await collateralToken.mint(sponsor2, convertSynthetic("1000000000"), { from: sponsor1 });

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
        });

        beforeEach(async function() {
          await timer.setCurrentTime(startTime - 1);
          constructorParams = await _createConstructorParamsForContractVersion(currentVersionTested, currentTypeTested);

          emp = await financialContractInstance.new(constructorParams);
          await syntheticToken.addMinter(emp.address);
          await syntheticToken.addBurner(emp.address);

          await collateralToken.approve(emp.address, convertCollateral("1000000"), { from: sponsor1 });
          await collateralToken.approve(emp.address, convertCollateral("1000000"), { from: sponsor2 });
          await syntheticToken.approve(emp.address, convertSynthetic("100000000"), { from: sponsor1 });
          await syntheticToken.approve(emp.address, convertSynthetic("100000000"), { from: sponsor2 });

          // If we are testing a perpetual then we need to apply the initial funding rate to start the timer.
          await emp.setCurrentTime(startTime);
          if (currentTypeTested == "Perpetual") await emp.applyFundingRate();

          // The ExpiringMultiPartyClient does not emit any info `level` events.  Therefore no need to test Winston outputs.
          // DummyLogger will not print anything to console as only capture `info` level events.
          dummyLogger = winston.createLogger({
            level: "info",
            transports: [new winston.transports.Console()]
          });

          client = new ExpiringMultiPartyClient(
            dummyLogger,
            financialContractInstance.abi,
            web3,
            emp.address,
            testConfig.collateralDecimals,
            testConfig.syntheticDecimals,
            testConfig.priceFeedDecimals,
            currentTypeTested // either ExpiringMultiParty OR Perpetual depending on the test
          );
        });
        versionedIt(["any"])("Returns all positions", async function() {
          // Create a position and check that it is detected correctly from the client.
          await emp.create(
            { rawValue: convertCollateral("10") },
            { rawValue: convertSynthetic("50") },
            { from: sponsor1 }
          );
          await updateAndVerify(
            client,
            [sponsor1], // expected sponsor
            [
              {
                sponsor: sponsor1,
                numTokens: convertSynthetic("50"),
                amountCollateral: convertCollateral("10"),
                hasPendingWithdrawal: false,
                withdrawalRequestPassTimestamp: "0",
                withdrawalRequestAmount: "0"
              }
            ] // expected position
          );

          // Calling create again from the same sponsor should add additional collateral & debt.
          await emp.create(
            { rawValue: convertCollateral("10") },
            { rawValue: convertSynthetic("50") },
            { from: sponsor1 }
          );
          await updateAndVerify(
            client,
            [sponsor1],
            [
              {
                sponsor: sponsor1,
                numTokens: convertSynthetic("100"),
                amountCollateral: convertCollateral("20"),
                hasPendingWithdrawal: false,
                withdrawalRequestPassTimestamp: "0",
                withdrawalRequestAmount: "0"
              }
            ]
          );

          // Calling create from a new address will create a new position and this should be added the the client.
          await emp.create(
            { rawValue: convertCollateral("100") },
            { rawValue: convertSynthetic("45") },
            { from: sponsor2 }
          );
          await updateAndVerify(
            client,
            [sponsor1, sponsor2],
            [
              {
                sponsor: sponsor1,
                numTokens: convertSynthetic("100"),
                amountCollateral: convertCollateral("20"),
                hasPendingWithdrawal: false,
                withdrawalRequestPassTimestamp: "0",
                withdrawalRequestAmount: "0"
              },
              {
                sponsor: sponsor2,
                numTokens: convertSynthetic("45"),
                amountCollateral: convertCollateral("100"),
                hasPendingWithdrawal: false,
                withdrawalRequestPassTimestamp: "0",
                withdrawalRequestAmount: "0"
              }
            ]
          );

          // If a position is liquidated it should be removed from the list of positions and added to the undisputed liquidations.
          const { liquidationId } = await emp.createLiquidation.call(
            sponsor2,
            { rawValue: "0" },
            { rawValue: toWei("99999") },
            { rawValue: toWei("100") },
            unreachableDeadline,
            { from: sponsor1 }
          );
          await emp.createLiquidation(
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
                numTokens: convertSynthetic("100"),
                amountCollateral: convertCollateral("20"),
                hasPendingWithdrawal: false,
                withdrawalRequestPassTimestamp: "0",
                withdrawalRequestAmount: "0"
              }
            ]
          );
          const expectedLiquidations = [
            {
              sponsor: sponsor2,
              id: liquidationId.toString(),
              numTokens: convertSynthetic("45"),
              liquidatedCollateral: convertCollateral("100"),
              lockedCollateral: convertCollateral("100"),
              liquidationTime: (await emp.getCurrentTime()).toString(),
              state: "1",
              liquidator: sponsor1,
              disputer: zeroAddress
            }
          ];
          assert.deepStrictEqual(expectedLiquidations.sort(), client.getUndisputedLiquidations().sort());

          // Pending withdrawals state should be correctly identified.
          await emp.requestWithdrawal(
            {
              rawValue: convertCollateral("10")
            },
            {
              from: sponsor1
            }
          );
          await client.update();

          await updateAndVerify(
            client,
            [sponsor1],
            [
              {
                sponsor: sponsor1,
                numTokens: convertSynthetic("100"),
                amountCollateral: convertCollateral("20"),
                hasPendingWithdrawal: true,
                withdrawalRequestPassTimestamp: (await emp.getCurrentTime())
                  .add(await emp.withdrawalLiveness())
                  .toString(),
                withdrawalRequestAmount: convertCollateral("10")
              }
            ]
          );

          // Remove the pending withdrawal and ensure it is removed from the client.
          await emp.cancelWithdrawal({
            from: sponsor1
          });
          await client.update();
          await updateAndVerify(
            client,
            [sponsor1],
            [
              {
                sponsor: sponsor1,
                numTokens: convertSynthetic("100"),
                amountCollateral: convertCollateral("20"),
                hasPendingWithdrawal: false,
                withdrawalRequestPassTimestamp: "0",
                withdrawalRequestAmount: "0"
              }
            ]
          );

          // Correctly returns sponsors who create, redeem.
          await emp.create(
            { rawValue: convertCollateral("100") },
            { rawValue: convertSynthetic("45") },
            { from: sponsor2 }
          );
          await emp.redeem({ rawValue: convertSynthetic("45") }, { from: sponsor2 });
          // as created and redeemed sponsor should not show up in table as they are no longer an active sponsor.

          await updateAndVerify(
            client,
            [sponsor1],
            [
              {
                sponsor: sponsor1,
                numTokens: convertSynthetic("100"),
                amountCollateral: convertCollateral("20"),
                hasPendingWithdrawal: false,
                withdrawalRequestPassTimestamp: "0",
                withdrawalRequestAmount: "0"
              }
            ]
          );
          // If sponsor, creates, redeemes and then creates again they should now appear in the table.
          await emp.create(
            { rawValue: convertCollateral("100") },
            { rawValue: convertSynthetic("45") },
            { from: sponsor2 }
          );
          await emp.redeem({ rawValue: convertSynthetic("45") }, { from: sponsor2 });
          await emp.create(
            { rawValue: convertCollateral("100") },
            { rawValue: convertSynthetic("45") },
            { from: sponsor2 }
          );
          await emp.redeem({ rawValue: convertSynthetic("45") }, { from: sponsor2 });
          await emp.create(
            { rawValue: convertCollateral("100") },
            { rawValue: convertSynthetic("45") },
            { from: sponsor2 }
          );

          await updateAndVerify(
            client,
            [sponsor1, sponsor2],
            [
              {
                sponsor: sponsor1,
                numTokens: convertSynthetic("100"),
                amountCollateral: convertCollateral("20"),
                hasPendingWithdrawal: false,
                withdrawalRequestPassTimestamp: "0",
                withdrawalRequestAmount: "0"
              },
              {
                sponsor: sponsor2,
                numTokens: convertSynthetic("45"),
                amountCollateral: convertCollateral("100"),
                hasPendingWithdrawal: false,
                withdrawalRequestPassTimestamp: "0",
                withdrawalRequestAmount: "0"
              }
            ]
          );
        });

        versionedIt(["any"])("Returns undercollateralized positions", async function() {
          await emp.create(
            { rawValue: convertCollateral("150") },
            { rawValue: convertSynthetic("100") },
            { from: sponsor1 }
          );
          await emp.create(
            { rawValue: convertCollateral("1500") },
            { rawValue: convertSynthetic("100") },
            { from: sponsor2 }
          );

          await client.update();
          // At 150% collateralization requirement, the position is just collateralized enough at a token price of 1.
          assert.deepStrictEqual([], client.getUnderCollateralizedPositions(convertPrice("1")));
          // Undercollateralized at a price just above 1.
          assert.deepStrictEqual(
            [
              {
                sponsor: sponsor1,
                numTokens: convertSynthetic("100"),
                amountCollateral: convertCollateral("150"),
                hasPendingWithdrawal: false,
                withdrawalRequestPassTimestamp: "0",
                withdrawalRequestAmount: "0"
              }
            ],
            client.getUnderCollateralizedPositions(convertPrice("1.00000001"))
          );

          // After submitting a withdraw request that brings the position below the CR ratio the client should detect this.
          // Withdrawing just 1 wei of collateral will place the position below the CR ratio.
          await emp.requestWithdrawal({ rawValue: convertCollateral("1") }, { from: sponsor1 });

          await client.update();
          // Update client to get withdrawal information.
          const currentTime = Number(await emp.getCurrentTime());
          assert.deepStrictEqual(
            [
              {
                sponsor: sponsor1,
                numTokens: convertSynthetic("100"),
                amountCollateral: convertCollateral("150"),
                hasPendingWithdrawal: true,
                withdrawalRequestPassTimestamp: (currentTime + 1000).toString(),
                withdrawalRequestAmount: convertCollateral("1")
              }
            ],
            client.getUnderCollateralizedPositions(convertPrice("1"))
          );
        });

        versionedIt(["any"])("Returns undisputed liquidations", async function() {
          const liquidator = sponsor2;

          await emp.create(
            { rawValue: convertCollateral("150") },
            { rawValue: convertSynthetic("100") },
            { from: sponsor1 }
          );
          await syntheticToken.transfer(liquidator, convertSynthetic("100"), {
            from: sponsor1
          });

          // Create a new liquidation for account[0]'s position.
          const { liquidationId } = await emp.createLiquidation.call(
            sponsor1,
            { rawValue: "0" },
            { rawValue: toWei("9999999") },
            { rawValue: toWei("100") },
            unreachableDeadline,
            {
              from: liquidator
            }
          );
          await emp.createLiquidation(
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
          assert.isTrue(client.isDisputable(liquidations[0], convertPrice("1")));
          assert.isFalse(client.isDisputable(liquidations[0], convertPrice("1.00000001")));

          // Dispute the liquidation and make sure it no longer shows up in the list.
          // We need to advance the Oracle time forward to make `requestPrice` work.
          await mockOracle.setCurrentTime(Number(await emp.getCurrentTime()) + 1);
          await emp.dispute(liquidationId.toString(), sponsor1, {
            from: sponsor1
          });
          await client.update();

          // The disputed liquidation should no longer show up as undisputed.
          assert.deepStrictEqual([], client.getUndisputedLiquidations().sort());
        });

        versionedIt(["any"])("Returns expired liquidations", async function() {
          const liquidator = sponsor2;

          await emp.create(
            { rawValue: convertCollateral("150") },
            { rawValue: convertSynthetic("100") },
            { from: sponsor1 }
          );
          await syntheticToken.transfer(liquidator, convertSynthetic("100"), {
            from: sponsor1
          });
          await emp.requestWithdrawal(
            {
              rawValue: convertCollateral("10")
            },
            {
              from: sponsor1
            }
          );

          // Create a new liquidation for account[0]'s position.
          await emp.createLiquidation.call(
            sponsor1,
            { rawValue: "0" },
            { rawValue: toWei("9999999") },
            { rawValue: toWei("100") },
            unreachableDeadline,
            {
              from: liquidator
            }
          );
          await emp.createLiquidation(
            sponsor1,
            { rawValue: "0" },
            { rawValue: toWei("9999999") },
            { rawValue: toWei("100") },
            unreachableDeadline,
            {
              from: liquidator
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
                numTokens: convertSynthetic("100"),
                liquidatedCollateral: convertCollateral("140"), // This should `lockedCollateral` reduced by requested withdrawal amount
                lockedCollateral: convertCollateral("150"),
                liquidator: liquidator,
                disputer: zeroAddress
              }
            ],
            liquidations
          );
          assert.deepStrictEqual([], client.getExpiredLiquidations().sort());

          // Move EMP time to the liquidation's expiry.
          const liquidationLiveness = 1000;
          await emp.setCurrentTime(Number(liquidationTime) + liquidationLiveness);
          await client.update();

          // The liquidation is registered by the EMP client as expired.
          assert.deepStrictEqual([], client.getUndisputedLiquidations().sort());
          const expiredLiquidations = client.getExpiredLiquidations();
          assert.deepStrictEqual(
            [
              {
                sponsor: sponsor1,
                id: "0",
                state: "1",
                liquidationTime: liquidationTime,
                numTokens: convertSynthetic("100"),
                liquidatedCollateral: convertCollateral("140"),
                lockedCollateral: convertCollateral("150"),
                liquidator: liquidator,
                disputer: zeroAddress
              }
            ],
            expiredLiquidations
          );

          // Withdraw from the expired liquidation and check that the liquidation is deleted.
          await emp.withdrawLiquidation("0", sponsor1, {
            from: liquidator
          });
          await client.update();
          assert.deepStrictEqual([], client.getExpiredLiquidations().sort());
        });

        versionedIt(["any"])("Returns disputed liquidations", async function() {
          const liquidator = sponsor2;

          await emp.create(
            { rawValue: convertCollateral("150") },
            { rawValue: convertSynthetic("100") },
            {
              from: sponsor1
            }
          );
          await syntheticToken.transfer(liquidator, convertSynthetic("100"), {
            from: sponsor1
          });

          // Create a new liquidation for account[0]'s position.
          const { liquidationId } = await emp.createLiquidation.call(
            sponsor1,
            { rawValue: "0" },
            {
              rawValue: toWei("9999999")
            },
            { rawValue: toWei("100") },
            unreachableDeadline,
            { from: liquidator }
          );
          await emp.createLiquidation(
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
          await mockOracle.setCurrentTime(Number(await emp.getCurrentTime()) + 1);
          await emp.dispute(liquidationId.toString(), sponsor1, {
            from: sponsor1
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
                numTokens: convertSynthetic("100"),
                liquidatedCollateral: convertCollateral("150"),
                lockedCollateral: convertCollateral("150"),
                liquidator: liquidator,
                disputer: sponsor1
              }
            ],
            client.getDisputedLiquidations().sort()
          );
          assert.deepStrictEqual([], client.getUndisputedLiquidations().sort());

          // Force a price such that the dispute fails, and then
          // withdraw from the unsuccessfully disputed liquidation and check that the liquidation is deleted.
          const disputePrice = convertPrice("1.6");
          await mockOracle.pushPrice(utf8ToHex(identifier), liquidationTime, disputePrice);
          await emp.withdrawLiquidation("0", sponsor1, {
            from: liquidator
          });
          await client.update();
          assert.deepStrictEqual([], client.getDisputedLiquidations().sort());
        });

        versionedIt(["ExpiringMultiParty-latest"])(
          "Client correctly defaults to ExpiringMultiParty to enable backward compatibility",
          async function() {
            // The constructor of the EMP client does not contain any type. It should therefore default to the EMP which
            // ensures that packages that are yet to update.
            client = new ExpiringMultiPartyClient(
              dummyLogger,
              financialContractInstance.abi,
              web3,
              emp.address,
              testConfig.collateralDecimals,
              testConfig.syntheticDecimals,
              testConfig.priceFeedDecimals
            );
            assert.equal(client.getContractType(), "ExpiringMultiParty");
          }
        );
        versionedIt(["ExpiringMultiParty-latest"])("Correctly rejects invalid contract types", async function() {
          let didThrow = false;
          try {
            client = new ExpiringMultiPartyClient(
              dummyLogger,
              financialContractInstance.abi,
              web3,
              emp.address,
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
            client = new ExpiringMultiPartyClient(
              dummyLogger,
              financialContractInstance.abi,
              web3,
              emp.address,
              testConfig.collateralDecimals,
              testConfig.syntheticDecimals,
              testConfig.priceFeedDecimals,
              null // some contract name that does not exist
            );
          } catch (error) {
            didThrow = true;
          }
          assert.isTrue(didThrow);
        });
        versionedIt(["Perpetual-latest"])(
          "Fetches funding rate from the perpetual contract and correctly applies it to token debt",
          async function() {
            // Create a position and check that it is detected correctly from the client.
            await emp.create(
              { rawValue: convertCollateral("10") },
              { rawValue: convertSynthetic("50") },
              { from: sponsor1 }
            );
            await updateAndVerify(
              client,
              [sponsor1], // expected sponsor
              [
                {
                  sponsor: sponsor1,
                  numTokens: convertSynthetic("50"),
                  amountCollateral: convertCollateral("10"),
                  hasPendingWithdrawal: false,
                  withdrawalRequestPassTimestamp: "0",
                  withdrawalRequestAmount: "0"
                }
              ] // expected position
            );

            // Set a funding rate
            await _setFundingRateAndAdvanceTime(toWei("0.000005"));
            await emp.applyFundingRate();

            // funding rate should be set within contract.
            assert.equal((await emp.fundingRate()).cumulativeMultiplier.toString(), toWei("1.05"));

            // funding rate is not applied until the client is updated.
            assert.equal(client.getLatestCumulativeFundingRateMultiplier(), toWei("1"));

            // After updating the client the funding rate is applied.
            await client.update();
            assert.equal(client.getLatestCumulativeFundingRateMultiplier(), toWei("1.05"));

            // after advancing time with the same funding rate the client value should not change
            await _setFundingRateAndAdvanceTime(toWei("0"));
            await emp.applyFundingRate();
            assert.equal(client.getLatestCumulativeFundingRateMultiplier().toString(), toWei("1.05"));

            // Correctly scales sponsors token debt by the funding rate
            await updateAndVerify(
              client,
              [sponsor1],
              [
                {
                  sponsor: sponsor1,
                  numTokens: toBN(convertSynthetic("50"))
                    .mul(toBN(toWei("1.05")))
                    .div(toBN(toWei("1")))
                    .toString(), // the funding rate should be applied to the num of tokens
                  amountCollateral: convertCollateral("10"),
                  hasPendingWithdrawal: false,
                  withdrawalRequestPassTimestamp: "0",
                  withdrawalRequestAmount: "0"
                }
              ]
            );
          }
        );
        versionedIt(["Perpetual-latest"])(
          "Correctly applies funding rate to token debt. Liquidatable and disputable position are updated accordingly",
          async function() {
            await emp.create(
              { rawValue: convertCollateral("150") },
              { rawValue: convertSynthetic("100") },
              { from: sponsor1 }
            );
            await emp.create(
              { rawValue: convertCollateral("175") },
              { rawValue: convertSynthetic("100") },
              { from: sponsor2 }
            );

            await client.update();
            // At 150% collateralization requirement, the position is just collateralized enough at a token price of 1.
            // At any positive funding rate value the first position should become undercollateralied.
            assert.deepStrictEqual([], client.getUnderCollateralizedPositions(convertPrice("1")));
            // Undercollateralized at a price just above 1.
            assert.deepStrictEqual(
              [
                {
                  sponsor: sponsor1,
                  numTokens: convertSynthetic("100"),
                  amountCollateral: convertCollateral("150"),
                  hasPendingWithdrawal: false,
                  withdrawalRequestPassTimestamp: "0",
                  withdrawalRequestAmount: "0"
                }
              ],
              client.getUnderCollateralizedPositions(convertPrice("1.00000001"))
            );

            // Or, undercollateralized at a price of 1 with a small funding rate applied. Funding rate of 0.000001 applied
            // over 10k seconds resulting in 0.01 cumulative multiplier. At a price of 1 this works out to a CR of:
            // 150 / (100 * 1.01 * 1) = 1.485, which is less than the CR requirement of 1.5
            await _setFundingRateAndAdvanceTime(toWei("0.000001"));
            await emp.applyFundingRate();
            await client.update();

            assert.deepStrictEqual(
              [
                {
                  sponsor: sponsor1,
                  numTokens: toBN(convertSynthetic("100"))
                    .mul(toBN(toWei("1.01")))
                    .div(toBN(toWei("1")))
                    .toString(), // the funding rate should be applied to the num of tokens
                  amountCollateral: convertCollateral("150"),
                  hasPendingWithdrawal: false,
                  withdrawalRequestPassTimestamp: "0",
                  withdrawalRequestAmount: "0"
                }
              ],
              client.getUnderCollateralizedPositions(convertPrice("1"))
            );
          }
        );
      });
    }
  });
});

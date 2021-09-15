const { web3, getContract } = require("hardhat");
const { assert } = require("chai");
const { toWei, utf8ToHex, padRight } = web3.utils;
const winston = require("winston");

const {
  interfaceName,
  parseFixed,
  MAX_UINT_VAL,
  advanceBlockAndSetTime,
  runTestForVersion,
  createConstructorParamsForContractVersion,
  getContractsNodePackageAliasForVerion,
  TESTED_CONTRACT_VERSIONS,
  TEST_DECIMAL_COMBOS,
} = require("@uma/common");

// Script to test
const { FinancialContractEventClient } = require("../../dist/clients/FinancialContractEventClient");

const startTime = "15798990420";
const unreachableDeadline = MAX_UINT_VAL;
const optimisticOracleLiveness = 7200;

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
let convertDecimals;
let dummyLogger;
let expirationTime;
let accounts;

// Perpetual
let configStore;
let optimisticOracle;
let fundingRateIdentifier;

// Track new sponsor positions created in the `beforeEach` block so that we can test event querying for NewSponsor events.
let newSponsorTxObj1;
let newSponsorTxObj2;
let newSponsorTxObj3;

const Convert = (decimals) => (number) => parseFixed(number.toString(), decimals).toString();

// If the current version being executed is part of the `supportedVersions` array then return `it` to run the test.
// Else, do nothing. Can be used exactly in place of a normal `it` to parameterize contract types and versions supported
// for a given test.eg: versionedIt([{ contractType: "any", contractVersion: "any" }])("test name", async function () { assert.isTrue(true) })
// Note that a second param can be provided to make the test an `it.only` thereby ONLY running that single test, on
// the provided version. This is very useful for debugging and writing single unit tests without having ro run all tests.
const versionedIt = function (supportedVersions, shouldBeItOnly = false) {
  if (shouldBeItOnly)
    return runTestForVersion(supportedVersions, TESTED_CONTRACT_VERSIONS, iterationTestVersion) ? it.only : () => {};
  return runTestForVersion(supportedVersions, TESTED_CONTRACT_VERSIONS, iterationTestVersion) ? it : () => {};
};

const objectsInArrayInclude = (subset, superset) => {
  assert.equal(superset.length, subset.length);
  for (let i = 0; i < superset.length; i++) assert.deepInclude(superset[i], subset[i]);
};

describe("FinancialContractEventClient.js", function () {
  let tokenSponsor, liquidator, sponsor1, sponsor2, sponsor3;
  before(async function () {
    accounts = await web3.eth.getAccounts();
    [tokenSponsor, liquidator, sponsor1, sponsor2, sponsor3] = accounts;
  });

  for (let tokenConfig of TEST_DECIMAL_COMBOS) {
    describe(`${tokenConfig.collateralDecimals} decimals`, function () {
      TESTED_CONTRACT_VERSIONS.forEach(function (contractVersion) {
        // Store the contractVersion.contractVersion, type and version being tested
        iterationTestVersion = contractVersion;

        const { getAbi, getBytecode } = require(getContractsNodePackageAliasForVerion(contractVersion.contractVersion));

        const createContract = (name) => {
          const abi = getAbi(name);
          const bytecode = getBytecode(name);
          return getContract(name, { abi, bytecode });
        };

        // Import the tested versions of contracts. note that financialContract is either an ExpiringMultiParty or a
        // Perpetual depending on the current iteration version.
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

        for (let testConfig of TEST_DECIMAL_COMBOS) {
          describe(`${testConfig.collateralDecimals} collateral, ${testConfig.syntheticDecimals} synthetic & ${testConfig.priceFeedDecimals} pricefeed decimals, for smart contract version ${contractVersion.contractType} @ ${contractVersion.contractVersion}`, function () {
            before(async function () {
              identifier = `${testConfig.tokenName}TEST`;
              fundingRateIdentifier = `${testConfig.tokenName}_FUNDING`;
              convertDecimals = Convert(testConfig.collateralDecimals);
              collateralToken = await Token.new(
                testConfig.tokenSymbol + " Token", // Construct the token name.,
                testConfig.tokenSymbol,
                tokenConfig.collateralDecimals
              ).send({ from: tokenSponsor });
              await collateralToken.methods.addMember(1, tokenSponsor).send({ from: tokenSponsor });
              await collateralToken.methods.mint(liquidator, convertDecimals("100000")).send({ from: tokenSponsor });
              await collateralToken.methods.mint(sponsor1, convertDecimals("100000")).send({ from: tokenSponsor });
              await collateralToken.methods.mint(sponsor2, convertDecimals("100000")).send({ from: tokenSponsor });
              await collateralToken.methods.mint(sponsor3, convertDecimals("100000")).send({ from: tokenSponsor });

              identifierWhitelist = await IdentifierWhitelist.new().send({ from: accounts[0] });
              await identifierWhitelist.methods
                .addSupportedIdentifier(utf8ToHex(identifier))
                .send({ from: accounts[0] });
              finder = await Finder.new().send({ from: accounts[0] });
              timer = await Timer.new().send({ from: accounts[0] });

              store = await Store.new({ rawValue: "0" }, { rawValue: "0" }, timer.options.address).send({
                from: accounts[0],
              });
              await finder.methods
                .changeImplementationAddress(utf8ToHex(interfaceName.Store), store.options.address)
                .send({ from: accounts[0] });

              collateralWhitelist = await AddressWhitelist.new().send({ from: accounts[0] });
              await finder.methods
                .changeImplementationAddress(
                  web3.utils.utf8ToHex(interfaceName.CollateralWhitelist),
                  collateralWhitelist.options.address
                )
                .send({ from: accounts[0] });
              await collateralWhitelist.methods
                .addToWhitelist(collateralToken.options.address)
                .send({ from: accounts[0] });

              await finder.methods
                .changeImplementationAddress(
                  utf8ToHex(interfaceName.IdentifierWhitelist),
                  identifierWhitelist.options.address
                )
                .send({ from: accounts[0] });
            });

            beforeEach(async function () {
              mockOracle = await MockOracle.new(finder.options.address, timer.options.address).send({
                from: accounts[0],
              });
              await finder.methods
                .changeImplementationAddress(utf8ToHex(interfaceName.Oracle), mockOracle.options.address)
                .send({ from: accounts[0] });

              await timer.methods.setCurrentTime(startTime - 1).send({ from: accounts[0] });
              const currentTime = await mockOracle.methods.getCurrentTime().call();
              expirationTime = parseInt(currentTime) + 100; // 100 seconds in the future

              // Create a new synthetic token
              syntheticToken = await SyntheticToken.new(
                "Test Synthetic Token",
                "SYNTH",
                tokenConfig.syntheticDecimals
              ).send({ from: tokenSponsor });

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
                  timer.options.address
                ).send({ from: accounts[0] });

                await identifierWhitelist.methods
                  .addSupportedIdentifier(padRight(utf8ToHex(fundingRateIdentifier)))
                  .send({ from: accounts[0] });
                optimisticOracle = await OptimisticOracle.new(
                  optimisticOracleLiveness,
                  finder.options.address,
                  timer.options.address
                ).send({ from: accounts[0] });
                await finder.methods
                  .changeImplementationAddress(
                    utf8ToHex(interfaceName.OptimisticOracle),
                    optimisticOracle.options.address
                  )
                  .send({ from: accounts[0] });
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
                {
                  minSponsorTokens: { rawValue: convertDecimals("1") },
                  collateralRequirement: { rawValue: toWei("1.5") }, // these tests assume a CR of 1.5, not the 1.2 default.
                  expirationTimestamp: expirationTime.toString(),
                }
              );

              financialContract = await FinancialContract.new(constructorParams).send({ from: accounts[0] });

              await syntheticToken.methods.addMinter(financialContract.options.address).send({ from: accounts[0] });
              await syntheticToken.methods.addBurner(financialContract.options.address).send({ from: accounts[0] });

              // The FinancialContractEventClient does not emit any info level events. Therefore no need to test Winston outputs.
              dummyLogger = winston.createLogger({ level: "info", transports: [new winston.transports.Console()] });

              // If we are testing a perpetual then we need to apply the initial funding rate to start the timer.methods.
              await financialContract.methods.setCurrentTime(startTime).send({ from: accounts[0] });
              if (contractVersion.contractType == "Perpetual")
                await financialContract.methods.applyFundingRate().send({ from: accounts[0] });

              client = new FinancialContractEventClient(
                dummyLogger,
                FinancialContract.abi,
                web3,
                financialContract.options.address,
                0, // startingBlockNumber
                null, // endingBlockNumber
                contractVersion.contractType,
                contractVersion.contractVersion
              );
              await collateralToken.methods
                .approve(financialContract.options.address, convertDecimals("1000000"))
                .send({ from: sponsor1 });
              await collateralToken.methods
                .approve(financialContract.options.address, convertDecimals("1000000"))
                .send({ from: sponsor2 });
              await collateralToken.methods
                .approve(financialContract.options.address, convertDecimals("1000000"))
                .send({ from: sponsor3 });

              syntheticToken = await Token.at(await financialContract.methods.tokenCurrency().call());
              await syntheticToken.methods
                .approve(financialContract.options.address, convertDecimals("100000000"))
                .send({ from: sponsor1 });
              await syntheticToken.methods
                .approve(financialContract.options.address, convertDecimals("100000000"))
                .send({ from: sponsor2 });

              // Create two positions
              newSponsorTxObj1 = await financialContract.methods
                .create({ rawValue: convertDecimals("10") }, { rawValue: convertDecimals("50") })
                .send({ from: sponsor1 });
              newSponsorTxObj2 = await financialContract.methods
                .create({ rawValue: convertDecimals("100") }, { rawValue: convertDecimals("45") })
                .send({ from: sponsor2 });

              // Seed the liquidator position
              await collateralToken.methods
                .approve(financialContract.options.address, convertDecimals("1000000"))
                .send({ from: liquidator });
              await syntheticToken.methods
                .approve(financialContract.options.address, convertDecimals("100000000"))
                .send({ from: liquidator });
              newSponsorTxObj3 = await financialContract.methods
                .create({ rawValue: convertDecimals("500") }, { rawValue: convertDecimals("200") })
                .send({ from: liquidator });
            });

            versionedIt([{ contractType: "any", contractVersion: "any" }])(
              "Return NewSponsor Events",
              async function () {
                // Update the client and check it has the new sponsor event stored correctly
                await client.clearState();

                // State is empty before update().
                objectsInArrayInclude([], client.getAllNewSponsorEvents());

                await client.update();

                // Compare with expected processed event objects
                objectsInArrayInclude(
                  [
                    {
                      transactionHash: newSponsorTxObj1.transactionHash,
                      blockNumber: newSponsorTxObj1.blockNumber,
                      sponsor: sponsor1,
                      collateralAmount: convertDecimals("10"),
                      tokenAmount: convertDecimals("50"),
                    },
                    {
                      transactionHash: newSponsorTxObj2.transactionHash,
                      blockNumber: newSponsorTxObj2.blockNumber,
                      sponsor: sponsor2,
                      collateralAmount: convertDecimals("100"),
                      tokenAmount: convertDecimals("45"),
                    },
                    {
                      transactionHash: newSponsorTxObj3.transactionHash,
                      blockNumber: newSponsorTxObj3.blockNumber,
                      sponsor: liquidator,
                      collateralAmount: convertDecimals("500"),
                      tokenAmount: convertDecimals("200"),
                    },
                  ],
                  client.getAllNewSponsorEvents()
                );

                // Correctly adds only new events after last query
                const newSponsorTxObj4 = await financialContract.methods
                  .create({ rawValue: convertDecimals("10") }, { rawValue: convertDecimals("1") })
                  .send({ from: sponsor3 });
                await client.clearState();
                await client.update();

                objectsInArrayInclude(
                  [
                    {
                      transactionHash: newSponsorTxObj4.transactionHash,
                      blockNumber: newSponsorTxObj4.blockNumber,
                      sponsor: sponsor3,
                      collateralAmount: convertDecimals("10"),
                      tokenAmount: convertDecimals("1"),
                    },
                  ],
                  client.getAllNewSponsorEvents()
                );
              }
            );

            versionedIt([{ contractType: "any", contractVersion: "any" }])("Return Create Events", async function () {
              // Update the client and check it has the new sponsor event stored correctly
              await client.clearState();

              // State is empty before update().
              objectsInArrayInclude([], client.getAllCreateEvents());

              await client.update();

              // Compare with expected processed event objects
              objectsInArrayInclude(
                [
                  {
                    transactionHash: newSponsorTxObj1.transactionHash,
                    blockNumber: newSponsorTxObj1.blockNumber,
                    sponsor: sponsor1,
                    collateralAmount: convertDecimals("10"),
                    tokenAmount: convertDecimals("50"),
                  },
                  {
                    transactionHash: newSponsorTxObj2.transactionHash,
                    blockNumber: newSponsorTxObj2.blockNumber,
                    sponsor: sponsor2,
                    collateralAmount: convertDecimals("100"),
                    tokenAmount: convertDecimals("45"),
                  },
                  {
                    transactionHash: newSponsorTxObj3.transactionHash,
                    blockNumber: newSponsorTxObj3.blockNumber,
                    sponsor: liquidator,
                    collateralAmount: convertDecimals("500"),
                    tokenAmount: convertDecimals("200"),
                  },
                ],
                client.getAllCreateEvents()
              );

              // Correctly adds only new events after last query
              const newSponsorTxObj4 = await financialContract.methods
                .create({ rawValue: convertDecimals("10") }, { rawValue: convertDecimals("1") })
                .send({ from: sponsor3 });
              await client.clearState();
              await client.update();

              objectsInArrayInclude(
                [
                  {
                    transactionHash: newSponsorTxObj4.transactionHash,
                    blockNumber: newSponsorTxObj4.blockNumber,
                    sponsor: sponsor3,
                    collateralAmount: convertDecimals("10"),
                    tokenAmount: convertDecimals("1"),
                  },
                ],
                client.getAllCreateEvents()
              );
            });

            versionedIt([{ contractType: "any", contractVersion: "any" }])("Return Deposit Events", async function () {
              // Update the client and check it has the new sponsor event stored correctly
              await client.clearState();

              // State is empty before update().
              objectsInArrayInclude([], client.getAllDepositEvents());

              const depositTxObj1 = await financialContract.methods
                .deposit({ rawValue: convertDecimals("5") })
                .send({ from: sponsor1 });

              await client.update();

              // Compare with expected processed event objects
              objectsInArrayInclude(
                [
                  {
                    transactionHash: depositTxObj1.transactionHash,
                    blockNumber: depositTxObj1.blockNumber,
                    sponsor: sponsor1,
                    collateralAmount: convertDecimals("5"),
                  },
                ],
                client.getAllDepositEvents()
              );

              // Correctly adds only new events after last query
              const depositTxObj2 = await financialContract.methods
                .deposit({ rawValue: convertDecimals("3") })
                .send({ from: sponsor2 });
              await client.clearState();
              await client.update();

              objectsInArrayInclude(
                [
                  {
                    transactionHash: depositTxObj2.transactionHash,
                    blockNumber: depositTxObj2.blockNumber,
                    sponsor: sponsor2,
                    collateralAmount: convertDecimals("3"),
                  },
                ],
                client.getAllDepositEvents()
              );
            });

            versionedIt([{ contractType: "any", contractVersion: "any" }])("Return Withdraw Events", async function () {
              // Update the client and check it has the new sponsor event stored correctly
              await client.clearState();

              // State is empty before update().
              objectsInArrayInclude([], client.getAllWithdrawEvents());

              // GCR is ~2.0, so sponsor2 and liquidator should be able to withdraw small amounts while keeping their CR above GCR.
              const withdrawTxObj1 = await financialContract.methods
                .withdraw({ rawValue: convertDecimals("1") })
                .send({ from: liquidator });

              await client.update();

              // Compare with expected processed event objects
              objectsInArrayInclude(
                [
                  {
                    transactionHash: withdrawTxObj1.transactionHash,
                    blockNumber: withdrawTxObj1.blockNumber,
                    sponsor: liquidator,
                    collateralAmount: convertDecimals("1"),
                  },
                ],
                client.getAllWithdrawEvents()
              );

              // Correctly adds only new events after last query
              const withdrawTxObj2 = await financialContract.methods
                .withdraw({ rawValue: convertDecimals("2") })
                .send({ from: sponsor2 });
              await client.clearState();
              await client.update();

              objectsInArrayInclude(
                [
                  {
                    transactionHash: withdrawTxObj2.transactionHash,
                    blockNumber: withdrawTxObj2.blockNumber,
                    sponsor: sponsor2,
                    collateralAmount: convertDecimals("2"),
                  },
                ],
                client.getAllWithdrawEvents()
              );
            });

            versionedIt([{ contractType: "any", contractVersion: "any" }])("Return Redeem Events", async function () {
              // Update the client and check it has the new sponsor event stored correctly
              await client.clearState();

              // State is empty before update().
              objectsInArrayInclude([], client.getAllRedeemEvents());

              // Redeem from liquidator who has many more than the min token amount
              const redeemTxObj1 = await financialContract.methods
                .redeem({ rawValue: convertDecimals("1") })
                .send({ from: liquidator });

              await client.update();

              // Compare with expected processed event objects
              objectsInArrayInclude(
                [
                  {
                    transactionHash: redeemTxObj1.transactionHash,
                    blockNumber: redeemTxObj1.blockNumber,
                    sponsor: liquidator,
                    collateralAmount: convertDecimals("2.5"),
                    tokenAmount: convertDecimals("1"),
                  },
                ],
                client.getAllRedeemEvents()
              );

              // Correctly adds only new events after last query
              const redeemTxObj2 = await financialContract.methods
                .redeem({ rawValue: convertDecimals("1") })
                .send({ from: sponsor1 });
              await client.clearState();
              await client.update();

              objectsInArrayInclude(
                [
                  {
                    transactionHash: redeemTxObj2.transactionHash,
                    blockNumber: redeemTxObj2.blockNumber,
                    sponsor: sponsor1,
                    collateralAmount: convertDecimals("0.2"),
                    tokenAmount: convertDecimals("1"),
                  },
                ],
                client.getAllRedeemEvents()
              );
            });

            versionedIt([{ contractType: "any", contractVersion: "any" }])(
              "Return RegularFee Events",
              async function () {
                await client.clearState();

                // State is empty before update()
                objectsInArrayInclude([], client.getAllRegularFeeEvents());

                // Set fees to 1% per second and advance 1 second.
                await store.methods
                  .setFixedOracleFeePerSecondPerPfc({ rawValue: toWei("0.01") })
                  .send({ from: accounts[0] });
                await timer.methods
                  .setCurrentTime(parseInt(await store.methods.getCurrentTime().call()) + 1)
                  .send({ from: accounts[0] });
                const regularFeeTxObj1 = await financialContract.methods.payRegularFees().send({ from: accounts[0] });

                await client.update();

                // Compare with expected processed event objects.
                // The starting collateral is 610 so 6.1 are paid in fees.
                objectsInArrayInclude(
                  [
                    {
                      transactionHash: regularFeeTxObj1.transactionHash,
                      blockNumber: regularFeeTxObj1.blockNumber,
                      regularFee: convertDecimals("6.1"),
                      lateFee: convertDecimals("0"),
                    },
                  ],
                  client.getAllRegularFeeEvents()
                );

                // Correctly adds only new events after last query.
                // 1% of (610-6.1) = 603.9 is 6.039
                await timer.methods
                  .setCurrentTime(parseInt(await timer.methods.getCurrentTime().call()) + 1)
                  .send({ from: accounts[0] });
                const regularFeeTxObj2 = await financialContract.methods.payRegularFees().send({ from: accounts[0] });
                await client.clearState();
                await client.update();

                objectsInArrayInclude(
                  [
                    {
                      transactionHash: regularFeeTxObj2.transactionHash,
                      blockNumber: regularFeeTxObj2.blockNumber,
                      regularFee: convertDecimals("6.039"),
                      lateFee: convertDecimals("0"),
                    },
                  ],
                  client.getAllRegularFeeEvents()
                );

                // Reset fees
                await store.methods.setFixedOracleFeePerSecondPerPfc({ rawValue: "0" }).send({ from: accounts[0] });
              }
            );

            versionedIt([{ contractType: "any", contractVersion: "any" }])(
              "Return Liquidation Events",
              async function () {
                // Create liquidation to liquidate sponsor2 from sponsor1
                const txObject1 = await financialContract.methods
                  .createLiquidation(
                    sponsor1,
                    { rawValue: "0" },
                    { rawValue: toWei("99999") },
                    { rawValue: convertDecimals("100") },
                    unreachableDeadline
                  )
                  .send({ from: liquidator });

                // Update the client and check it has the liquidation event stored correctly
                await client.clearState();

                // State is empty before update().
                objectsInArrayInclude([], client.getAllLiquidationEvents());

                await client.update();

                // Compare with expected processed event object
                objectsInArrayInclude(
                  [
                    {
                      transactionHash: txObject1.transactionHash,
                      blockNumber: txObject1.blockNumber,
                      sponsor: sponsor1,
                      liquidator: liquidator,
                      liquidationId: "0",
                      tokensOutstanding: convertDecimals("50"),
                      lockedCollateral: convertDecimals("10"),
                      liquidatedCollateral: convertDecimals("10"),
                    },
                  ],
                  client.getAllLiquidationEvents()
                );

                // Correctly adds a second event after creating a new liquidation
                const txObject2 = await financialContract.methods
                  .createLiquidation(
                    sponsor2,
                    { rawValue: "0" },
                    { rawValue: toWei("99999") },
                    { rawValue: convertDecimals("100") },
                    unreachableDeadline
                  )
                  .send({ from: liquidator });
                await client.clearState();
                await client.update();
                objectsInArrayInclude(
                  [
                    {
                      transactionHash: txObject2.transactionHash,
                      blockNumber: txObject2.blockNumber,
                      sponsor: sponsor2,
                      liquidator: liquidator,
                      liquidationId: "0",
                      tokensOutstanding: convertDecimals("45"),
                      lockedCollateral: convertDecimals("100"),
                      liquidatedCollateral: convertDecimals("100"),
                    },
                  ],
                  client.getAllLiquidationEvents()
                );
              }
            );

            versionedIt([{ contractType: "any", contractVersion: "any" }])("Return Dispute Events", async function () {
              // Create liquidation to liquidate sponsor2 from sponsor1
              await financialContract.methods
                .createLiquidation(
                  sponsor1,
                  { rawValue: "0" },
                  { rawValue: toWei("99999") },
                  { rawValue: convertDecimals("100") },
                  unreachableDeadline
                )
                .send({ from: liquidator });

              const txObject = await financialContract.methods.dispute("0", sponsor1).send({ from: sponsor2 });

              // Update the client and check it has the dispute event stored correctly
              await client.clearState();

              // State is empty before update().
              objectsInArrayInclude([], client.getAllDisputeEvents());

              await client.update();

              // Compare with expected processed event object
              objectsInArrayInclude(
                [
                  {
                    transactionHash: txObject.transactionHash,
                    blockNumber: txObject.blockNumber,
                    sponsor: sponsor1,
                    liquidator: liquidator,
                    disputer: sponsor2,
                    liquidationId: "0",
                    disputeBondAmount: convertDecimals("1"), // 10% of the liquidated position's collateral.
                  },
                ],
                client.getAllDisputeEvents()
              );
            });

            versionedIt([{ contractType: "any", contractVersion: "any" }])(
              "Return Dispute Settlement Events",
              async function () {
                // Create liquidation to liquidate sponsor2 from sponsor1
                const liquidationTime = parseInt(await financialContract.methods.getCurrentTime().call());
                await financialContract.methods
                  .createLiquidation(
                    sponsor1,
                    { rawValue: "0" },
                    { rawValue: toWei("99999") },
                    { rawValue: convertDecimals("100") },
                    unreachableDeadline
                  )
                  .send({ from: liquidator });

                // Dispute the position from the second sponsor
                await financialContract.methods.dispute("0", sponsor1).send({ from: sponsor2 });

                // Advance time and settle
                const timeAfterLiquidationLiveness = liquidationTime + 10;
                await mockOracle.methods
                  .setCurrentTime(timeAfterLiquidationLiveness.toString())
                  .send({ from: accounts[0] });
                await financialContract.methods
                  .setCurrentTime(timeAfterLiquidationLiveness.toString())
                  .send({ from: accounts[0] });

                // Force a price such that the dispute fails, and then withdraw from the unsuccessfully
                // disputed liquidation.
                const disputePrice = toWei("1.6");
                await mockOracle.methods
                  .pushPrice(utf8ToHex(identifier), liquidationTime, disputePrice)
                  .send({ from: accounts[0] });

                const txObject = await financialContract.methods
                  .withdrawLiquidation("0", sponsor1)
                  .send({ from: liquidator });
                await client.clearState();

                // State is empty before update().
                objectsInArrayInclude([], client.getAllDisputeSettlementEvents());

                // Update the client and check it has the dispute event stored correctly
                await client.update();

                // Compare with expected processed event object
                objectsInArrayInclude(
                  [
                    {
                      transactionHash: txObject.transactionHash,
                      blockNumber: txObject.blockNumber,
                      caller: liquidator,
                      sponsor: sponsor1,
                      liquidator: liquidator,
                      disputer: sponsor2,
                      liquidationId: "0",
                      disputeSucceeded: false, // Settlement price makes liquidation valid
                    },
                  ],
                  client.getAllDisputeSettlementEvents()
                );
              }
            );

            versionedIt([{ contractType: "any", contractVersion: "any" }])(
              "Return Liquidation Withdrawn Events",
              async function () {
                // Create liquidation to liquidate sponsor1
                const liquidationTime = parseInt(await financialContract.methods.getCurrentTime().call());
                await financialContract.methods
                  .createLiquidation(
                    sponsor1,
                    { rawValue: "0" },
                    { rawValue: toWei("99999") },
                    { rawValue: convertDecimals("100") },
                    unreachableDeadline
                  )
                  .send({ from: liquidator });

                // Dispute the position from the second sponsor
                await financialContract.methods.dispute("0", sponsor1).send({ from: sponsor2 });

                // Advance time and settle
                const timeAfterLiquidationLiveness = liquidationTime + 10;
                await mockOracle.methods
                  .setCurrentTime(timeAfterLiquidationLiveness.toString())
                  .send({ from: accounts[0] });
                await financialContract.methods
                  .setCurrentTime(timeAfterLiquidationLiveness.toString())
                  .send({ from: accounts[0] });

                // Force a price such that the dispute succeeds, and then withdraw from the successfully
                // disputed liquidation.
                const disputePrice = toWei("0.1");
                await mockOracle.methods
                  .pushPrice(utf8ToHex(identifier), liquidationTime, disputePrice)
                  .send({ from: accounts[0] });

                const txObject = await financialContract.methods
                  .withdrawLiquidation("0", sponsor1)
                  .send({ from: liquidator });
                await client.clearState();

                // State is empty before update().
                objectsInArrayInclude([], client.getAllLiquidationWithdrawnEvents());

                // Update the client and check it has the liquidation withdrawn event stored correctly
                await client.update();

                // Compare with expected processed event object
                objectsInArrayInclude(
                  [
                    {
                      transactionHash: txObject.transactionHash,
                      blockNumber: txObject.blockNumber,
                      caller: liquidator,
                      withdrawalAmount: convertDecimals("4"), // On successful disputes, liquidator gets TRV - dispute rewards. TRV = (50 * 0.1 = 5), and rewards = (TRV * 0.1 = 5 * 0.1 = 0.5).
                      liquidationStatus: "3", // Settlement price makes dispute successful
                    },
                  ],
                  client.getAllLiquidationWithdrawnEvents()
                );
              }
            );

            versionedIt([{ contractType: "Perpetual", contractVersion: "2.0.1" }])(
              "Return FundingRateUpdated Events",
              async function () {
                await client.clearState();

                // State is empty before update()
                objectsInArrayInclude([], client.getAllFundingRateUpdatedEvents());

                // Propose new funding rate.
                const proposeAndPublishNewRate = async (newRateWei) => {
                  // Advance time forward by 1 to guarantee that proposal time > last update time.
                  let currentTime = await timer.methods.getCurrentTime().call();
                  await timer.methods.setCurrentTime(parseInt(currentTime) + 1).send({ from: accounts[0] });
                  let proposalTime = parseInt(currentTime) + 1;
                  await financialContract.methods
                    .proposeFundingRate({ rawValue: newRateWei }, proposalTime)
                    .send({ from: accounts[0] });
                  // Advance timer far enough such that funding rate proposal can be published,
                  // and publish it.
                  const proposalExpiry = proposalTime + optimisticOracleLiveness;
                  await timer.methods.setCurrentTime(proposalExpiry).send({ from: accounts[0] });
                  return {
                    txObject: await financialContract.methods.applyFundingRate().send({ from: accounts[0] }),
                    proposalTime,
                  };
                };
                const { txObject, proposalTime } = await proposeAndPublishNewRate(toWei("-0.00001"));

                await client.update();

                // Compare with expected processed event objects.
                objectsInArrayInclude(
                  [
                    {
                      transactionHash: txObject.transactionHash,
                      blockNumber: txObject.blockNumber,
                      newFundingRate: toWei("-0.00001"),
                      updateTime: proposalTime.toString(),
                      reward: "0",
                    },
                  ],
                  client.getAllFundingRateUpdatedEvents()
                );

                // Correctly adds only new events after last query.
                const { txObject: txObject2, proposalTime: proposalTime2 } = await proposeAndPublishNewRate(
                  toWei("0.00001")
                );
                await client.clearState();
                await client.update();
                objectsInArrayInclude(
                  [
                    {
                      transactionHash: txObject2.transactionHash,
                      blockNumber: txObject2.blockNumber,
                      newFundingRate: toWei("0.00001"),
                      updateTime: proposalTime2.toString(),
                      reward: "0",
                    },
                  ],
                  client.getAllFundingRateUpdatedEvents()
                );
              }
            );

            versionedIt([{ contractType: "any", contractVersion: "any" }])(
              "Starting client at an offset block number",
              async function () {
                // Init the Financial Contract event client with an offset block number. If the current block number is used then all log events
                // generated before the creation of the client should not be included. Rather, only subsequent logs should be reported.

                // Create liquidation (in the past)
                await financialContract.methods
                  .createLiquidation(
                    sponsor1,
                    { rawValue: "0" },
                    { rawValue: toWei("99999") },
                    { rawValue: convertDecimals("100") },
                    unreachableDeadline
                  )
                  .send({ from: liquidator });

                // Start the liquidator bot from current time stamp (liquidation in the past)
                const currentBlockNumber = await web3.eth.getBlockNumber();
                const offSetClient = new FinancialContractEventClient(
                  dummyLogger,
                  FinancialContract.abi,
                  web3,
                  financialContract.options.address,
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

                objectsInArrayInclude([], offSetClient.getAllLiquidationEvents()); // Created liquidation should not be captured
                objectsInArrayInclude([], offSetClient.getAllDisputeEvents());
                objectsInArrayInclude([], offSetClient.getAllDisputeSettlementEvents());
              }
            );
          });
        }
      });
    });
  }
});

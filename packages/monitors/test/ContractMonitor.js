const { toWei, hexToUtf8, utf8ToHex, padRight } = web3.utils;
const winston = require("winston");
const sinon = require("sinon");
const {
  interfaceName,
  MAX_UINT_VAL,
  parseFixed,
  runTestForVersion,
  createConstructorParamsForContractVersion,
  TESTED_CONTRACT_VERSIONS
} = require("@uma/common");
const { getTruffleContract } = require("@uma/core");

// Helpers and custom winston transport module to monitor winston log outputs
const {
  FinancialContractEventClient,
  PriceFeedMock,
  SpyTransport,
  lastSpyLogIncludes
} = require("@uma/financial-templates-lib");

// Script to test
const { ContractMonitor } = require("../src/ContractMonitor");

// Run the tests against 3 different kinds of token/synth decimal combinations:
// 1) matching 18 & 18 for collateral for most token types with normal tokens.
// 2) non-matching 8 collateral & 18 synthetic for legacy UMA synthetics.
// 3) matching 8 collateral & 8 synthetic for current UMA synthetics.
const configs = [
  { tokenSymbol: "WETH", collateralDecimals: 18, syntheticDecimals: 18, priceFeedDecimals: 18 },
  { tokenSymbol: "Legacy BTC", collateralDecimals: 8, syntheticDecimals: 18, priceFeedDecimals: 8 },
  { tokenSymbol: "BTC", collateralDecimals: 8, syntheticDecimals: 8, priceFeedDecimals: 18 }
];

let iterationTestVersion; // store the test version between tests that is currently being tested.
const startTime = "15798990420";

// Contracts
let collateralToken;
let financialContract;
let syntheticToken;
let mockOracle;
let identifierWhitelist;
let finder;
let store;
let timer;
let fundingRateIdentifier;
let optimisticOracle;
let configStore;
let collateralWhitelist;

// Test object for Financial Contract event client
let eventClient;

// Price feed mock
let priceFeedMock;
let spyLogger;
let spy;
let financialContractProps;
let monitorConfig;

// re-used variables
let identifier;
let contractMonitor;

// Keep track of new sponsor transactions for testing `checkForNewSponsors` method.
let newSponsorTxn;

let convertCollateral;
let convertSynthetic;
let convertPrice;

const unreachableDeadline = MAX_UINT_VAL;

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

const Convert = decimals => number => parseFixed(number.toString(), decimals).toString();

contract("ContractMonitor.js", function(accounts) {
  const tokenSponsor = accounts[0];
  const liquidator = accounts[1];
  const disputer = accounts[2];
  const sponsor1 = accounts[3];
  const sponsor2 = accounts[4];
  const sponsor3 = accounts[5];

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
          identifier = `${testConfig.tokenSymbol}TEST`;
          fundingRateIdentifier = `${testConfig.tokenName}_FUNDING_IDENTIFIER`;
          convertCollateral = Convert(testConfig.collateralDecimals);
          convertSynthetic = Convert(testConfig.syntheticDecimals);
          convertPrice = Convert(testConfig.priceFeedDecimals);
          collateralToken = await Token.new(
            testConfig.tokenSymbol + " Token",
            testConfig.tokenSymbol,
            testConfig.collateralDecimals,
            { from: tokenSponsor }
          );

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

          await identifierWhitelist.addSupportedIdentifier(utf8ToHex(identifier));

          // Create a mockOracle and finder. Register the mockOracle with the finder.
          mockOracle = await MockOracle.new(finder.address, timer.address);
          const mockOracleInterfaceName = utf8ToHex(interfaceName.Oracle);
          await finder.changeImplementationAddress(mockOracleInterfaceName, mockOracle.address);

          collateralWhitelist = await AddressWhitelist.new();
          await finder.changeImplementationAddress(
            utf8ToHex(interfaceName.CollateralWhitelist),
            collateralWhitelist.address
          );
          await collateralWhitelist.addToWhitelist(collateralToken.address);
        });

        beforeEach(async function() {
          await timer.setCurrentTime(startTime - 1);
          const currentTime = await mockOracle.getCurrentTime.call();

          await timer.setCurrentTime(currentTime.toString());

          // Create a new synthetic token
          syntheticToken = await SyntheticToken.new("Test Synthetic Token", "SYNTH", testConfig.syntheticDecimals, {
            from: tokenSponsor
          });

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

          const constructorParams = await createConstructorParamsForContractVersion(
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
            { minSponsorTokens: { rawValue: convertSynthetic("1") }, collateralRequirement: { rawValue: toWei("1.5") } }
          );

          // Deploy a new expiring multi party OR perpetual, depending on the test version.
          financialContract = await FinancialContract.new(constructorParams);

          // If we are testing a perpetual then we need to apply the initial funding rate to start the timer.
          await financialContract.setCurrentTime(startTime);
          if (contractVersion.contractType == "Perpetual") await financialContract.applyFundingRate();

          // Create a sinon spy and give it to the SpyTransport as the winston logger. Use this to check all winston
          // logs the correct text based on interactions with the financialContract. Note that only `info` level messages are captured.
          spy = sinon.spy();
          spyLogger = winston.createLogger({
            level: "info",
            transports: [new SpyTransport({ level: "info" }, { spy })]
          });

          await syntheticToken.addMinter(financialContract.address);
          await syntheticToken.addBurner(financialContract.address);
          eventClient = new FinancialContractEventClient(
            spyLogger,
            FinancialContract.abi,
            web3,
            financialContract.address,
            0, // startingBlockNumber
            null, // endingBlockNumber
            contractVersion.contractType
          );
          priceFeedMock = new PriceFeedMock();

          // Define a configuration object. In this config only monitor one liquidator and one disputer.
          monitorConfig = { monitoredLiquidators: [liquidator], monitoredDisputers: [disputer] };

          syntheticToken = await Token.at(await financialContract.tokenCurrency());

          financialContractProps = {
            collateralSymbol: await collateralToken.symbol(),
            collateralDecimals: testConfig.collateralDecimals,
            syntheticDecimals: testConfig.syntheticDecimals,
            priceFeedDecimals: testConfig.priceFeedDecimals,
            syntheticSymbol: await syntheticToken.symbol(),
            priceIdentifier: hexToUtf8(await financialContract.priceIdentifier()),
            networkId: await web3.eth.net.getId()
          };

          contractMonitor = new ContractMonitor({
            logger: spyLogger,
            financialContractEventClient: eventClient,
            priceFeed: priceFeedMock,
            monitorConfig,
            financialContractProps,
            votingContract: mockOracle
          });

          await collateralToken.addMember(1, tokenSponsor, {
            from: tokenSponsor
          });

          //   Bulk mint and approve for all wallets
          for (let i = 1; i < 6; i++) {
            await collateralToken.mint(accounts[i], convertCollateral("100000000"), {
              from: tokenSponsor
            });
            await collateralToken.approve(financialContract.address, convertSynthetic("100000000"), {
              from: accounts[i]
            });
            await syntheticToken.approve(financialContract.address, convertSynthetic("100000000"), {
              from: accounts[i]
            });
          }

          // Create positions for the sponsors, liquidator and disputer
          await financialContract.create(
            { rawValue: convertCollateral("150") },
            { rawValue: convertSynthetic("50") },
            { from: sponsor1 }
          );
          await financialContract.create(
            { rawValue: convertCollateral("175") },
            { rawValue: convertSynthetic("45") },
            { from: sponsor2 }
          );
          newSponsorTxn = await financialContract.create(
            { rawValue: convertCollateral("1500") },
            { rawValue: convertSynthetic("400") },
            { from: liquidator }
          );
        });

        versionedIt([{ contractType: "any", contractVersion: "any" }])(
          "Winston correctly emits new sponsor message",
          async function() {
            // Update the eventClient and check it has the new sponsor event stored correctly
            await eventClient.update();

            // Check for new sponsor events
            await contractMonitor.checkForNewSponsors();

            // Ensure that the spy correctly captured the new sponsor events key information.
            // Should contain etherscan addresses for the sponsor and transaction
            assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/address/${liquidator}`));
            assert.isTrue(lastSpyLogIncludes(spy, "(Monitored liquidator or disputer bot)")); // The address that initiated the liquidation is a monitored address
            assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/tx/${newSponsorTxn.tx}`));

            // should contain the correct position information.
            assert.isTrue(lastSpyLogIncludes(spy, "400.00")); // New tokens created
            assert.isTrue(lastSpyLogIncludes(spy, "1,500.00")); // Collateral amount

            // Create another position
            const txObject1 = await financialContract.create(
              { rawValue: convertCollateral("10") },
              { rawValue: convertSynthetic("1.5") },
              { from: sponsor3 } // not a monitored address
            );

            await eventClient.update();

            // check for new sponsor events and check the winston messages sent to the spy
            await contractMonitor.checkForNewSponsors();
            assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/address/${sponsor3}`));
            assert.isFalse(lastSpyLogIncludes(spy, "(Monitored liquidator or disputer bot bot)"));
            assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/tx/${txObject1.tx}`));
            assert.isTrue(lastSpyLogIncludes(spy, "1.50")); // New tokens created
            assert.isTrue(lastSpyLogIncludes(spy, "10.00")); // Collateral amount
          }
        );
        versionedIt([{ contractType: "any", contractVersion: "any" }])(
          "Winston correctly emits liquidation message",
          async function() {
            // Request a withdrawal from sponsor1 to check if monitor correctly differentiates between liquidated and locked collateral
            await financialContract.requestWithdrawal({ rawValue: convertCollateral("10") }, { from: sponsor1 });

            // Create liquidation to liquidate sponsor2 from sponsor1
            const txObject1 = await financialContract.createLiquidation(
              sponsor1,
              { rawValue: "0" },
              { rawValue: convertPrice("99999") },
              { rawValue: convertSynthetic("100") },
              unreachableDeadline,
              { from: liquidator }
            );

            // Update the eventClient and check it has the liquidation event stored correctly
            await eventClient.update();
            priceFeedMock.setHistoricalPrice(convertPrice("1"));

            // Liquidations before pricefeed's lookback window (lastUpdateTime - lookback) are not considered:
            const earliestLiquidationTime = Number(
              (await web3.eth.getBlock(eventClient.getAllLiquidationEvents()[0].blockNumber)).timestamp
            );
            priceFeedMock.setLastUpdateTime(earliestLiquidationTime + 2);
            priceFeedMock.setLookback(1);

            // Check for liquidation events
            await contractMonitor.checkForNewLiquidations();
            assert.equal(spy.getCalls().length, 0);

            // Check for liquidation events which should now be captured since the lookback now covers the liquidation time.
            // Note that we need to reset the internal `lastLiquidationBlockNumber` value so that we can "re-query" these events:
            contractMonitor.lastLiquidationBlockNumber = 0;
            priceFeedMock.setLookback(2);
            await contractMonitor.checkForNewLiquidations();

            // Ensure that the spy correctly captured the liquidation events key information.
            // Should contain etherscan addresses for the liquidator, sponsor and transaction
            assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/address/${liquidator}`));
            assert.isTrue(lastSpyLogIncludes(spy, "(Monitored liquidator bot)")); // The address that initiated the liquidation is a monitored address
            assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/address/${sponsor1}`));
            assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/tx/${txObject1.tx}`));

            // should contain the correct position information. Collateralization ratio for sponsor with 140 collateral and 50
            // debt with a price feed of 1 should give 140/(50 * 1) = 280%
            assert.isTrue(lastSpyLogIncludes(spy, "280.00%")); // expected collateralization ratio of 280%
            assert.isTrue(lastSpyLogIncludes(spy, "140.00")); // liquidated collateral amount of 150 - 10
            assert.isTrue(lastSpyLogIncludes(spy, "150.00")); // locked collateral amount of 150
            assert.isTrue(lastSpyLogIncludes(spy, "50.00")); // tokens liquidated
            assert.isTrue(lastSpyLogIncludes(spy, "150.00%")); // cr requirement %
            assert.isTrue(lastSpyLogIncludes(spy, "1.00")); // estimated price at liquidation time
            assert.isTrue(lastSpyLogIncludes(spy, "1.86")); // maximum price for liquidation to be disputable
            assert.isTrue(lastSpyLogIncludes(spy, "SYNTH")); // should contain token symbol

            // Liquidate another position and ensure the Contract monitor emits the correct params
            const txObject2 = await financialContract.createLiquidation(
              sponsor2,
              { rawValue: "0" },
              { rawValue: convertPrice("99999") },
              { rawValue: convertSynthetic("100") },
              unreachableDeadline,
              { from: sponsor1 } // not the monitored liquidator address
            );

            await eventClient.update();

            // check for new liquidations and check the winston messages sent to the spy
            await contractMonitor.checkForNewLiquidations();
            assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/address/${sponsor1}`)); // liquidator in txObject2
            assert.isFalse(lastSpyLogIncludes(spy, "(Monitored liquidator bot)")); // not called from a monitored address
            assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/address/${sponsor2}`)); // token sponsor
            assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/tx/${txObject2.tx}`));
            assert.isTrue(lastSpyLogIncludes(spy, "388.88%")); // expected collateralization ratio: 175 / (45 * 1) = 388.88%
            assert.isTrue(lastSpyLogIncludes(spy, "175.00")); // liquidated & locked collateral: 175
            assert.isTrue(lastSpyLogIncludes(spy, "45.00")); // tokens liquidated
            assert.isTrue(lastSpyLogIncludes(spy, "150.00%")); // cr requirement %
            assert.isTrue(lastSpyLogIncludes(spy, "1.00")); // estimated price at liquidation time
            assert.isTrue(lastSpyLogIncludes(spy, "2.59")); // maximum price for liquidation to be disputable
            assert.isTrue(lastSpyLogIncludes(spy, "SYNTH")); // should contain token symbol
          }
        );
        versionedIt([{ contractType: "any", contractVersion: "any" }])(
          "Winston correctly emits dispute events",
          async function() {
            // Create liquidation to dispute.
            await financialContract.createLiquidation(
              sponsor1,
              { rawValue: "0" },
              { rawValue: convertPrice("99999") },
              { rawValue: convertSynthetic("100") },
              unreachableDeadline,
              { from: liquidator }
            );

            const txObject1 = await financialContract.dispute("0", sponsor1, {
              from: disputer
            });

            // Update the eventClient and check it has the dispute event stored correctly
            await eventClient.clearState();
            await eventClient.update();
            priceFeedMock.setHistoricalPrice(convertPrice("1"));

            await contractMonitor.checkForNewDisputeEvents();

            assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/address/${disputer}`)); // disputer address
            assert.isTrue(lastSpyLogIncludes(spy, "(Monitored dispute bot)")); // disputer is monitored
            assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/address/${liquidator}`)); // liquidator address
            assert.isTrue(lastSpyLogIncludes(spy, "(Monitored liquidator bot)")); // liquidator is monitored
            assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/tx/${txObject1.tx}`));
            assert.isTrue(lastSpyLogIncludes(spy, "15.00")); // dispute bond of 10% of sponsor 1's 150 collateral => 15

            // Create a second liquidation to dispute from a non-monitored account.
            await financialContract.createLiquidation(
              sponsor2,
              { rawValue: "0" },
              { rawValue: convertPrice("99999") },
              { rawValue: convertSynthetic("100") },
              unreachableDeadline,
              { from: sponsor1 }
            );

            // the disputer is also not monitored
            const txObject2 = await financialContract.dispute("0", sponsor2, {
              from: sponsor2
            });

            // Update the eventClient and check it has the dispute event stored correctly
            await eventClient.clearState();
            await eventClient.update();

            await contractMonitor.checkForNewDisputeEvents();

            assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/address/${sponsor2}`)); // disputer address
            assert.isFalse(lastSpyLogIncludes(spy, "(Monitored dispute bot)")); // disputer is not monitored
            assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/address/${sponsor1}`)); // liquidator address
            assert.isFalse(lastSpyLogIncludes(spy, "(Monitored liquidator bot)")); // liquidator is not monitored
            assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/tx/${txObject2.tx}`));
            assert.isTrue(lastSpyLogIncludes(spy, "17.50")); // dispute bond of 10% of sponsor 2's 175 collateral => 17.50
          }
        );
        versionedIt([{ contractType: "any", contractVersion: "any" }])(
          "Return Dispute Settlement Events",
          async function() {
            // Create liquidation to liquidate sponsor1 from liquidator
            let liquidationTime = (await financialContract.getCurrentTime()).toNumber();
            await financialContract.createLiquidation(
              sponsor1,
              { rawValue: "0" },
              { rawValue: convertPrice("99999") },
              { rawValue: convertSynthetic("100") },
              unreachableDeadline,
              { from: liquidator }
            );

            // Dispute the position from the disputer
            await financialContract.dispute("0", sponsor1, {
              from: disputer
            });

            // Push a price such that the dispute fails and ensure the resolution reports correctly. Sponsor1 has 50 units of
            // debt and 150 units of collateral. price of 2.5: 150 / (50 * 2.5) = 120% => undercollateralized
            let disputePrice = convertPrice("2.5");
            await mockOracle.pushPrice(utf8ToHex(identifier), liquidationTime, disputePrice);

            // Withdraw from liquidation to settle the dispute event.
            const txObject1 = await financialContract.withdrawLiquidation("0", sponsor1, { from: liquidator });
            await eventClient.clearState();

            // Even though the dispute settlement has occurred on-chain, because we haven't updated the event client yet,
            // the contract monitor should not report it and should skip it silently.
            const existingCallsCount = spy.getCalls().length;
            await contractMonitor.checkForNewDisputeSettlementEvents();
            assert.equal(existingCallsCount, spy.getCalls().length);

            // Update the eventClient and check it has the dispute event stored correctly
            await eventClient.update();
            priceFeedMock.setHistoricalPrice(convertPrice("1"));

            await contractMonitor.checkForNewDisputeSettlementEvents();

            assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/address/${liquidator}`));
            assert.isTrue(lastSpyLogIncludes(spy, "(Monitored liquidator bot)"));
            assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/address/${disputer}`));
            assert.isTrue(lastSpyLogIncludes(spy, "(Monitored dispute bot)"));
            assert.isTrue(lastSpyLogIncludes(spy, "failed")); // the disputed was not successful based on settlement price
            assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/tx/${txObject1.tx}`));

            // Advance time so that price request is for a different timestamp.
            const nextLiquidationTimestamp = liquidationTime + 1;
            await financialContract.setCurrentTime(nextLiquidationTimestamp.toString());

            // Create a second liquidation from a non-monitored address (sponsor1).
            liquidationTime = (await financialContract.getCurrentTime()).toNumber();
            await financialContract.createLiquidation(
              sponsor2,
              { rawValue: "0" },
              { rawValue: convertPrice("99999") },
              { rawValue: convertSynthetic("100") },
              unreachableDeadline,
              { from: sponsor1 }
            );

            // Dispute the liquidator from a non-monitor address (sponsor2)
            await financialContract.dispute("0", sponsor2, {
              from: sponsor2
            });

            // Push a price such that the dispute succeeds and ensure the resolution reports correctly. Sponsor2 has 45 units of
            // debt and 175 units of collateral. price of 2.0: 175 / (45 * 2) = 194% => sufficiently collateralized
            disputePrice = convertCollateral("2.0");
            await mockOracle.pushPrice(utf8ToHex(identifier), liquidationTime, disputePrice);

            // Withdraw from liquidation to settle the dispute event.
            const txObject2 = await financialContract.withdrawLiquidation("0", sponsor2, { from: sponsor2 });
            await eventClient.clearState();

            // Update the eventClient and check it has the dispute event stored correctly
            await eventClient.update();

            await contractMonitor.checkForNewDisputeSettlementEvents();

            assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/address/${sponsor1}`)); // liquidator address
            assert.isFalse(lastSpyLogIncludes(spy, "(Monitored liquidator bot)")); // This liquidator is not monitored
            assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/address/${sponsor2}`)); // disputer address
            assert.isFalse(lastSpyLogIncludes(spy, "(Monitored dispute bot)")); // This disputer is not monitored
            assert.isTrue(lastSpyLogIncludes(spy, "succeeded")); // the disputed was successful based on settlement price
            assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/tx/${txObject2.tx}`));
          }
        );
        versionedIt([{ contractType: "any", contractVersion: "any" }])(
          "Cannot set invalid config or financialContractProps",
          async function() {
            let errorThrown1;
            try {
              // Create an invalid config. A valid config expects two arrays of addresses.
              const invalidConfig1 = { monitoredLiquidators: liquidator, monitoredDisputers: [disputer] };
              contractMonitor = new ContractMonitor({
                logger: spyLogger,
                financialContractEventClient: eventClient,
                priceFeed: priceFeedMock,
                monitorConfig: invalidConfig1,
                financialContractProps
              });
              errorThrown1 = false;
            } catch (err) {
              errorThrown1 = true;
            }
            assert.isTrue(errorThrown1);

            let errorThrown2;
            try {
              // Create an invalid config. A valid config expects two arrays of addresses.
              const invalidConfig2 = { monitoredLiquidators: "NOT AN ADDRESS" };
              contractMonitor = new ContractMonitor({
                logger: spyLogger,
                financialContractEventClient: eventClient,
                priceFeed: priceFeedMock,
                monitorConfig: invalidConfig2,
                financialContractProps
              });
              errorThrown2 = false;
            } catch (err) {
              errorThrown2 = true;
            }
            assert.isTrue(errorThrown2);

            let errorThrown3;
            try {
              // Create an invalid financialContractProps. This includes missing values or wrong type asignment.

              financialContractProps.collateralDecimals = null; // set a variable that must be a number to null
              contractMonitor = new ContractMonitor({
                logger: spyLogger,
                financialContractEventClient: eventClient,
                priceFeed: priceFeedMock,
                monitorConfig, // valid config
                financialContractProps
              });
              errorThrown3 = false;
            } catch (err) {
              errorThrown3 = true;
            }
            assert.isTrue(errorThrown3);
          }
        );

        versionedIt([{ contractType: "any", contractVersion: "any" }])(
          "Can correctly create contract monitor with no config provided",
          async function() {
            let errorThrown;
            try {
              // Create an invalid config. A valid config expects two arrays of addresses.
              const emptyConfig = {};
              contractMonitor = new ContractMonitor({
                logger: spyLogger,
                financialContractEventClient: eventClient,
                priceFeed: priceFeedMock,
                monitorConfig: emptyConfig,
                financialContractProps
              });
              await contractMonitor.checkForNewSponsors();
              await contractMonitor.checkForNewLiquidations();
              await contractMonitor.checkForNewDisputeEvents();
              await contractMonitor.checkForNewDisputeSettlementEvents();
              errorThrown = false;
            } catch (err) {
              errorThrown = true;
            }
            assert.isFalse(errorThrown);
          }
        );
      });
    }
  });
});

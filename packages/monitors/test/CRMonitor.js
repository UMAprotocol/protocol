const { toWei, hexToUtf8, utf8ToHex, padRight } = web3.utils;
const winston = require("winston");
const sinon = require("sinon");
const {
  interfaceName,
  parseFixed,
  runTestForVersion,
  createConstructorParamsForContractVersion,
  TESTED_CONTRACT_VERSIONS
} = require("@uma/common");
const { getTruffleContract } = require("@uma/core");

// Script to test
const { CRMonitor } = require("../src/CRMonitor");

// Helpers and custom winston transport module to monitor winston log outputs
const {
  FinancialContractClient,
  PriceFeedMock,
  SpyTransport,
  lastSpyLogIncludes,
  lastSpyLogLevel
} = require("@uma/financial-templates-lib");

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
let optimisticOracle;
let configStore;
let collateralWhitelist;

// Price feed mock
let priceFeedMock;
let spyLogger;
let spy;
let financialContractProps;
let monitorConfig;

// re-used variables
let identifier;
let fundingRateIdentifier;
let currentTime;
let financialContractClient;
let crMonitor;

let convertCollateral;
let convertSynthetic;
let convertPrice;

// Set the funding rate and advances time by 10k seconds.
const _setFundingRateAndAdvanceTime = async fundingRate => {
  currentTime = (await financialContract.getCurrentTime()).toNumber();
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

const Convert = decimals => number => parseFixed(number.toString(), decimals).toString();

contract("CRMonitor.js", function(accounts) {
  const tokenSponsor = accounts[0];
  const monitoredTrader = accounts[1];
  const monitoredSponsor = accounts[2];

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
          await identifierWhitelist.addSupportedIdentifier(utf8ToHex(testConfig.tokenSymbol + " Identifier"));

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
          currentTime = await mockOracle.getCurrentTime.call();

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
            {
              minSponsorTokens: { rawValue: convertSynthetic("1") },
              collateralRequirement: { rawValue: toWei("1.5") },
              withdrawalLiveness: "10",
              liquidationLiveness: "10"
            }
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
            transports: [new SpyTransport({ level: "info" }, { spy: spy })]
          });

          await syntheticToken.addMinter(financialContract.address);
          await syntheticToken.addBurner(financialContract.address);
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
          priceFeedMock = new PriceFeedMock();

          monitorConfig = {
            walletsToMonitor: [
              {
                name: "Monitored trader wallet",
                address: monitoredTrader,
                crAlert: 2.0 // if the collateralization ratio of this wallet drops below 200% send an alert
              },
              {
                name: "Monitored sponsor wallet",
                address: monitoredSponsor,
                crAlert: 1.5 // if the collateralization ratio of this wallet drops below 150% send an alert
              }
            ]
          };
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

          crMonitor = new CRMonitor({
            logger: spyLogger,
            financialContractClient: financialContractClient,
            priceFeed: priceFeedMock,
            monitorConfig,
            financialContractProps
          });

          await collateralToken.addMember(1, tokenSponsor, {
            from: tokenSponsor
          });

          //   Bulk mint and approve for all wallets
          for (let i = 1; i < 3; i++) {
            await collateralToken.mint(accounts[i], convertCollateral("100000000"), { from: tokenSponsor });
            await collateralToken.approve(financialContract.address, convertCollateral("100000000"), {
              from: accounts[i]
            });
            await syntheticToken.approve(financialContract.address, convertSynthetic("100000000"), {
              from: accounts[i]
            });
          }

          // Create positions for the monitoredTrader and monitoredSponsor accounts
          await financialContract.create(
            { rawValue: convertCollateral("250") },
            { rawValue: convertSynthetic("100") },
            { from: monitoredTrader }
          );
          await financialContract.create(
            { rawValue: convertCollateral("300") },
            { rawValue: convertSynthetic("100") },
            { from: monitoredSponsor }
          );
        });

        versionedIt([{ contractType: "any", contractVersion: "any" }])(
          "Winston correctly emits collateralization ratio message",
          async function() {
            // No messages created if safely above the CR threshold
            await financialContractClient.update();
            priceFeedMock.setCurrentPrice(convertPrice("1"));
            await crMonitor.checkWalletCrRatio();
            assert.equal(spy.callCount, 0);

            // Emits a message if below the CR threshold. At a price of 1.3 only the monitoredTrader should be undercollateralized
            // with a CR of 250 / (100 * 1.3) =1.923 which is below this addresses threshold of 200 and should emit a message.
            await financialContractClient.update();
            priceFeedMock.setCurrentPrice(convertPrice("1.3"));
            await crMonitor.checkWalletCrRatio();
            assert.equal(spy.callCount, 1);
            assert.isTrue(lastSpyLogIncludes(spy, "Collateralization ratio alert"));
            assert.isTrue(lastSpyLogIncludes(spy, "Monitored trader wallet")); // Monitored wallet name from `monitorConfig`
            assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/address/${monitoredTrader}`)); // liquidator address
            assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/address/${monitoredTrader}`)); // liquidator address
            assert.isTrue(lastSpyLogIncludes(spy, "192.30%")); // calculated CR ratio for this position
            assert.isTrue(lastSpyLogIncludes(spy, "200%")); // calculated CR ratio threshold for this address
            assert.isTrue(lastSpyLogIncludes(spy, "1.30")); // Current price of the identifer
            assert.isTrue(lastSpyLogIncludes(spy, hexToUtf8(await financialContract.priceIdentifier()))); // Synthetic identifier
            assert.isTrue(lastSpyLogIncludes(spy, "150.00%")); // Collateralization requirement
            assert.isTrue(lastSpyLogIncludes(spy, "1.66")); // Liquidation price
            assert.equal(lastSpyLogLevel(spy), "warn");

            // The message should be sent every time the bot is polled and there is a crossing of the threshold line. At a price
            // of 1.2 monitoredTrader's CR = 250/(100*1.2) = 2.083 and monitoredSponsor's CR = 300/(100*1.2) = 2.5 which places
            // both monitored wallets above their thresholds. As a result no new message should be sent.
            await financialContractClient.update();
            priceFeedMock.setCurrentPrice(convertPrice("1.2"));
            await crMonitor.checkWalletCrRatio();
            assert.equal(spy.callCount, 1); // no new message.

            // Crossing the price threshold for both sponsors should emit exactly 2 new messages. At a price of 2.1
            // monitoredTrader's CR = 250/(100*2.1) = 1.1904 and monitoredSponsor's CR = 300/(100*2.1) = 1.42857. At these CRs
            // Both bots are below their thresholds
            await financialContractClient.update();
            priceFeedMock.setCurrentPrice(convertPrice("2.1"));
            await crMonitor.checkWalletCrRatio();
            assert.equal(spy.callCount, 3); // two new messages

            // A second check below this threshold should again trigger messages for both sponsors.
            await financialContractClient.update();
            priceFeedMock.setCurrentPrice(convertPrice("2.1"));
            await crMonitor.checkWalletCrRatio();
            assert.equal(spy.callCount, 5);

            // Reset the price to over collateralized state for both accounts by moving the price into the lower value. This
            // should not emit any events as both correctly collateralized.
            await financialContractClient.update();
            priceFeedMock.setCurrentPrice(convertPrice("1"));
            await crMonitor.checkWalletCrRatio();
            assert.equal(spy.callCount, 5);

            // In addition to the price moving of the synthetic, adding/removing collateral or creating/redeeming debt can also
            // impact a positions collateralization ratio. If monitoredTrader was to withdraw some collateral after waiting the
            // withdrawal liveness they can place their position's collateralization under the threshold. Say monitoredTrader
            // withdraws 75 units of collateral. Given price is 1 unit of synthetic for each unit of debt. This would place
            // their position at a collateralization ratio of 175/(100*1)=1.75. monitoredSponsor is at 300/(100*1)=3.00.
            await financialContract.requestWithdrawal({ rawValue: convertCollateral("75") }, { from: monitoredTrader });

            // The wallet CR should reflect the requested withdrawal amount.
            await financialContractClient.update();
            await crMonitor.checkWalletCrRatio();
            await crMonitor.checkWalletCrRatio();
            assert.equal(spy.callCount, 7); // a new message is sent.
            assert.isTrue(lastSpyLogIncludes(spy, "Monitored trader wallet")); // Monitored wallet name from `MonitorConfig`
            assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/address/${monitoredTrader}`)); // liquidator address
            assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/address/${monitoredTrader}`)); // liquidator address
            assert.isTrue(lastSpyLogIncludes(spy, "175.00%")); // calculated CR ratio for this position
            assert.isTrue(lastSpyLogIncludes(spy, "200%")); // calculated CR ratio threshold for this address
            assert.isTrue(lastSpyLogIncludes(spy, "1.00")); // Current price of the identifer
            assert.isTrue(lastSpyLogIncludes(spy, hexToUtf8(await financialContract.priceIdentifier()))); // Synthetic identifier

            // Advance time after withdrawal liveness. Check that CR detected is the same post withdrawal execution
            currentTime = await timer.getCurrentTime.call();
            await timer.setCurrentTime(currentTime.toNumber() + 11);
            await financialContract.withdrawPassedRequest({ from: monitoredTrader });

            await financialContractClient.update();
            await crMonitor.checkWalletCrRatio();
            assert.equal(spy.callCount, 8); // a new message is sent.
            assert.isTrue(lastSpyLogIncludes(spy, "Monitored trader wallet")); // Monitored wallet name from `MonitorConfig`
            assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/address/${monitoredTrader}`)); // liquidator address
            assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/address/${monitoredTrader}`)); // liquidator address
            assert.isTrue(lastSpyLogIncludes(spy, "175.00%")); // calculated CR ratio for this position
            assert.isTrue(lastSpyLogIncludes(spy, "200%")); // calculated CR ratio threshold for this address
            assert.isTrue(lastSpyLogIncludes(spy, "1.00")); // Current price of the identifer
            assert.isTrue(lastSpyLogIncludes(spy, hexToUtf8(await financialContract.priceIdentifier()))); // Synthetic identifier
          }
        );
        versionedIt([{ contractType: "Perpetual", contractVersion: "latest" }])(
          "Winston correctly emits collateralization ratio message considering perpetual funding rates",
          async function() {
            // No messages created if safely above the CR threshold
            await financialContractClient.update();
            priceFeedMock.setCurrentPrice(convertPrice("1"));
            await crMonitor.checkWalletCrRatio();
            assert.equal(spy.callCount, 0);

            // Emits a message if below the CR threshold. Introduce some funding rate multiplier to test the monitors ability
            // the adjust alerts based on this input. Setting the funding rate multiplier to 1.1, results in modifying
            // sponsor's debt. This becomes 100*1.1 = 110. Also, let's set the price to 1.1
            // The sponsor CR is now 250 / (100 * 1.1 * 1.1) = 2.066
            await _setFundingRateAndAdvanceTime(toWei("0.00001"));
            await financialContract.applyFundingRate();
            assert.equal((await financialContract.fundingRate()).cumulativeMultiplier.toString(), toWei("1.1"));
            await financialContractClient.update();
            priceFeedMock.setCurrentPrice(convertPrice("1.1"));
            await crMonitor.checkWalletCrRatio();
            assert.equal(spy.callCount, 0);

            // Next, further add additional funding rate to push the sponsors position below the expected CR. Lets say
            // another 0.05 is added onto the funding rate. The cumlative rate will become 1.1 * (1 + 0.000005 * 10000) = 1.155.
            // This will place the sponsors CR at 250 / (100 * 1.155 * 1.1) = 1.9677 which is below the 2 alerting threshold.
            await _setFundingRateAndAdvanceTime(toWei("0.000005"));
            await financialContract.applyFundingRate();
            assert.equal((await financialContract.fundingRate()).cumulativeMultiplier.toString(), toWei("1.155"));
            await financialContractClient.update();
            await crMonitor.checkWalletCrRatio();
            assert.equal(spy.callCount, 1);
            assert.isTrue(lastSpyLogIncludes(spy, "Collateralization ratio alert"));
            assert.isTrue(lastSpyLogIncludes(spy, "Monitored trader wallet")); // Monitored wallet name from `monitorConfig`
            assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/address/${monitoredTrader}`)); // liquidator address
            assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/address/${monitoredTrader}`)); // liquidator address
            assert.isTrue(lastSpyLogIncludes(spy, "196.77%")); // calculated CR ratio for this position
            assert.isTrue(lastSpyLogIncludes(spy, "200%")); // calculated CR ratio threshold for this address
            assert.isTrue(lastSpyLogIncludes(spy, "1.10")); // Current price of the identifer
            assert.isTrue(lastSpyLogIncludes(spy, hexToUtf8(await financialContract.priceIdentifier()))); // Synthetic identifier
            assert.isTrue(lastSpyLogIncludes(spy, "150.00%")); // Collateralization requirement
            assert.isTrue(lastSpyLogIncludes(spy, "1.44")); // Liquidation price
            assert.isTrue(lastSpyLogIncludes(spy, "cumulative funding rate multiplier is 1.15")); // correctly reports funding rate multiplier.
            assert.equal(lastSpyLogLevel(spy), "warn");
          }
        );
        versionedIt([{ contractType: "any", contractVersion: "any" }])("Cannot set invalid config", async function() {
          let errorThrown1;
          try {
            // Create an invalid config. A valid config expects an array of objects with keys in the object of `name` `address`
            // and `crAlert`.
            const invalidMonitorConfig1 = {
              // Config missing `crAlert`.
              walletsToMonitor: [
                {
                  name: "Sponsor wallet",
                  address: tokenSponsor
                }
              ]
            };

            crMonitor = new CRMonitor({
              logger: spyLogger,
              financialContractClient: financialContractClient,
              priceFeed: priceFeedMock,
              monitorConfig: invalidMonitorConfig1,
              financialContractProps
            });
            errorThrown1 = false;
          } catch (err) {
            errorThrown1 = true;
          }
          assert.isTrue(errorThrown1);

          let errorThrown2;
          try {
            // Create an invalid config. A valid config expects an array of objects with keys in the object of `name` `address`
            // `collateralThreshold`, `etherThreshold`. The value of `address` must be of type address.
            const invalidMonitorConfig2 = {
              // Config has an invalid address for the monitored bot.
              walletsToMonitor: [
                {
                  name: "Sponsor wallet",
                  address: "INVALID_ADDRESS",
                  crAlert: 1.5
                }
              ]
            };

            crMonitor = new CRMonitor({
              logger: spyLogger,
              financialContractClient: financialContractClient,
              priceFeed: priceFeedMock,
              monitorConfig: invalidMonitorConfig2,
              financialContractProps
            });
            errorThrown2 = false;
          } catch (err) {
            errorThrown2 = true;
          }
          assert.isTrue(errorThrown2);
        });
        versionedIt([{ contractType: "any", contractVersion: "any" }])(
          "Can correctly CR Monitor and check wallet CR Ratios with no config provided",
          async function() {
            const emptyConfig = {};
            let errorThrown;
            try {
              crMonitor = new CRMonitor({
                logger: spyLogger,
                financialContractClient: financialContractClient,
                priceFeed: priceFeedMock,
                monitorConfig: emptyConfig,
                financialContractProps
              });
              await crMonitor.checkWalletCrRatio();
              errorThrown = false;
            } catch (err) {
              errorThrown = true;
            }
            assert.isFalse(errorThrown);
          }
        );
        versionedIt([{ contractType: "any", contractVersion: "any" }])(
          "Can override the synthetic-threshold log level",
          async function() {
            const alertOverrideConfig = { ...monitorConfig, logOverrides: { crThreshold: "error" } };
            crMonitor = new CRMonitor({
              logger: spyLogger,
              financialContractClient: financialContractClient,
              priceFeed: priceFeedMock,
              monitorConfig: alertOverrideConfig,
              financialContractProps
            });

            // Increase price to lower wallet CR below threshold
            await financialContractClient.update();
            priceFeedMock.setCurrentPrice(convertPrice("1.3"));
            await crMonitor.checkWalletCrRatio();
            assert.isTrue(lastSpyLogIncludes(spy, "Collateralization ratio alert"));
            assert.equal(lastSpyLogLevel(spy), "error");
          }
        );
      });
    }
  });
});

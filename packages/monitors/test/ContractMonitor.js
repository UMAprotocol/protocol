const { toWei, hexToUtf8, utf8ToHex, padRight } = web3.utils;
const winston = require("winston");
const sinon = require("sinon");
const { interfaceName, MAX_UINT_VAL, parseFixed, ZERO_ADDRESS } = require("@uma/common");

// Script to test
const { ContractMonitor } = require("../src/ContractMonitor");

// Helpers and custom winston transport module to monitor winston log outputs
const {
  ExpiringMultiPartyEventClient,
  PriceFeedMock,
  SpyTransport,
  lastSpyLogIncludes
} = require("@uma/financial-templates-lib");

// Truffle artifacts
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const Finder = artifacts.require("Finder");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const MockOracle = artifacts.require("MockOracle");
const SyntheticToken = artifacts.require("SyntheticToken");
const Token = artifacts.require("ExpandedERC20");
const Timer = artifacts.require("Timer");
const Store = artifacts.require("Store");

// Run the tests against 3 different kinds of token/synth decimal combinations:
// 1) matching 18 & 18 for collateral for most token types with normal tokens.
// 2) non-matching 8 collateral & 18 synthetic for legacy UMA synthetics.
// 3) matching 8 collateral & 8 synthetic for current UMA synthetics.
const configs = [
  { tokenSymbol: "WETH", collateralDecimals: 18, syntheticDecimals: 18, priceFeedDecimals: 18 },
  { tokenSymbol: "Legacy BTC", collateralDecimals: 8, syntheticDecimals: 18, priceFeedDecimals: 8 },
  { tokenSymbol: "BTC", collateralDecimals: 8, syntheticDecimals: 8, priceFeedDecimals: 18 }
];

const Convert = decimals => number => parseFixed(number.toString(), decimals).toString();

contract("ContractMonitor.js", function(accounts) {
  for (let testConfig of configs) {
    describe(`${testConfig.collateralDecimals} collateral, ${testConfig.syntheticDecimals} synthetic & ${testConfig.priceFeedDecimals} pricefeed decimals`, function() {
      const tokenSponsor = accounts[0];
      const liquidator = accounts[1];
      const disputer = accounts[2];
      const sponsor1 = accounts[3];
      const sponsor2 = accounts[4];
      const sponsor3 = accounts[5];

      const unreachableDeadline = MAX_UINT_VAL;

      // Contracts
      let collateralToken;
      let emp;
      let syntheticToken;
      let mockOracle;
      let identifierWhitelist;
      let finder;
      let store;
      let timer;

      // Test object for EMP event client
      let eventClient;

      // Price feed mock
      let priceFeedMock;
      let spyLogger;
      let spy;
      let empProps;
      let monitorConfig;

      // re-used variables
      let expirationTime;
      let constructorParams;
      let identifier;
      let contractMonitor;

      // Keep track of new sponsor transactions for testing `checkForNewSponsors` method.
      let newSponsorTxn;

      let convertCollateral;
      let convertSynthetic;
      let convertPrice;

      before(async function() {
        identifier = `${testConfig.tokenSymbol}TEST`;
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
      });

      beforeEach(async function() {
        const currentTime = await mockOracle.getCurrentTime.call();

        await timer.setCurrentTime(currentTime.toString());
        expirationTime = currentTime.toNumber() + 100; // 100 seconds in the future

        // Create a new synthetic token
        syntheticToken = await SyntheticToken.new("Test Synthetic Token", "SYNTH", testConfig.syntheticDecimals, {
          from: tokenSponsor
        });

        constructorParams = {
          isTest: true,
          expirationTimestamp: expirationTime.toString(),
          withdrawalLiveness: "1",
          collateralAddress: collateralToken.address,
          tokenAddress: syntheticToken.address,
          finderAddress: finder.address,
          timerAddress: timer.address,
          priceFeedIdentifier: padRight(utf8ToHex(identifier), 64),
          liquidationLiveness: "10",
          collateralRequirement: { rawValue: toWei("1.5") },
          disputeBondPct: { rawValue: toWei("0.1") },
          sponsorDisputeRewardPct: { rawValue: toWei("0.1") },
          disputerDisputeRewardPct: { rawValue: toWei("0.1") },
          minSponsorTokens: { rawValue: convertSynthetic("1") },
          excessTokenBeneficiary: store.address,
          financialProductLibraryAddress: ZERO_ADDRESS
        };

        // Create a sinon spy and give it to the SpyTransport as the winston logger. Use this to check all winston
        // logs the correct text based on interactions with the emp. Note that only `info` level messages are captured.

        spy = sinon.spy();
        spyLogger = winston.createLogger({
          level: "info",
          transports: [new SpyTransport({ level: "info" }, { spy })]
        });

        emp = await ExpiringMultiParty.new(constructorParams);
        await syntheticToken.addMinter(emp.address);
        await syntheticToken.addBurner(emp.address);
        eventClient = new ExpiringMultiPartyEventClient(spyLogger, ExpiringMultiParty.abi, web3, emp.address);
        priceFeedMock = new PriceFeedMock();

        // Define a configuration object. In this config only monitor one liquidator and one disputer.
        monitorConfig = { monitoredLiquidators: [liquidator], monitoredDisputers: [disputer] };

        syntheticToken = await Token.at(await emp.tokenCurrency());

        empProps = {
          collateralSymbol: await collateralToken.symbol(),
          collateralDecimals: testConfig.collateralDecimals,
          syntheticDecimals: testConfig.syntheticDecimals,
          priceFeedDecimals: testConfig.priceFeedDecimals,
          syntheticSymbol: await syntheticToken.symbol(),
          priceIdentifier: hexToUtf8(await emp.priceIdentifier()),
          networkId: await web3.eth.net.getId()
        };

        contractMonitor = new ContractMonitor({
          logger: spyLogger,
          expiringMultiPartyEventClient: eventClient,
          priceFeed: priceFeedMock,
          config: monitorConfig,
          empProps,
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
          await collateralToken.approve(emp.address, convertSynthetic("100000000"), {
            from: accounts[i]
          });
          await syntheticToken.approve(emp.address, convertSynthetic("100000000"), {
            from: accounts[i]
          });
        }

        // Create positions for the sponsors, liquidator and disputer
        await emp.create(
          { rawValue: convertCollateral("150") },
          { rawValue: convertSynthetic("50") },
          { from: sponsor1 }
        );
        await emp.create(
          { rawValue: convertCollateral("175") },
          { rawValue: convertSynthetic("45") },
          { from: sponsor2 }
        );
        newSponsorTxn = await emp.create(
          { rawValue: convertCollateral("1500") },
          { rawValue: convertSynthetic("400") },
          { from: liquidator }
        );
      });

      it("Winston correctly emits new sponsor message", async function() {
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
        const txObject1 = await emp.create(
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
      });
      it("Winston correctly emits liquidation message", async function() {
        // Request a withdrawal from sponsor1 to check if monitor correctly differentiates between liquidated and locked collateral
        await emp.requestWithdrawal({ rawValue: convertCollateral("10") }, { from: sponsor1 });

        // Create liquidation to liquidate sponsor2 from sponsor1
        const txObject1 = await emp.createLiquidation(
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
        const txObject2 = await emp.createLiquidation(
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
      });
      it("Winston correctly emits dispute events", async function() {
        // Create liquidation to dispute.
        await emp.createLiquidation(
          sponsor1,
          { rawValue: "0" },
          { rawValue: convertPrice("99999") },
          { rawValue: convertSynthetic("100") },
          unreachableDeadline,
          { from: liquidator }
        );

        const txObject1 = await emp.dispute("0", sponsor1, {
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
        await emp.createLiquidation(
          sponsor2,
          { rawValue: "0" },
          { rawValue: convertPrice("99999") },
          { rawValue: convertSynthetic("100") },
          unreachableDeadline,
          { from: sponsor1 }
        );

        // the disputer is also not monitored
        const txObject2 = await emp.dispute("0", sponsor2, {
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
      });
      it("Return Dispute Settlement Events", async function() {
        // Create liquidation to liquidate sponsor1 from liquidator
        let liquidationTime = (await emp.getCurrentTime()).toNumber();
        await emp.createLiquidation(
          sponsor1,
          { rawValue: "0" },
          { rawValue: convertPrice("99999") },
          { rawValue: convertSynthetic("100") },
          unreachableDeadline,
          { from: liquidator }
        );

        // Dispute the position from the disputer
        await emp.dispute("0", sponsor1, {
          from: disputer
        });

        // Push a price such that the dispute fails and ensure the resolution reports correctly. Sponsor1 has 50 units of
        // debt and 150 units of collateral. price of 2.5: 150 / (50 * 2.5) = 120% => undercollateralized
        let disputePrice = convertPrice("2.5");
        await mockOracle.pushPrice(utf8ToHex(identifier), liquidationTime, disputePrice);

        // Withdraw from liquidation to settle the dispute event.
        const txObject1 = await emp.withdrawLiquidation("0", sponsor1, { from: liquidator });
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
        await emp.setCurrentTime(nextLiquidationTimestamp.toString());

        // Create a second liquidation from a non-monitored address (sponsor1).
        liquidationTime = (await emp.getCurrentTime()).toNumber();
        await emp.createLiquidation(
          sponsor2,
          { rawValue: "0" },
          { rawValue: convertPrice("99999") },
          { rawValue: convertSynthetic("100") },
          unreachableDeadline,
          { from: sponsor1 }
        );

        // Dispute the liquidator from a non-monitor address (sponsor2)
        await emp.dispute("0", sponsor2, {
          from: sponsor2
        });

        // Push a price such that the dispute succeeds and ensure the resolution reports correctly. Sponsor2 has 45 units of
        // debt and 175 units of collateral. price of 2.0: 175 / (45 * 2) = 194% => sufficiently collateralized
        disputePrice = convertCollateral("2.0");
        await mockOracle.pushPrice(utf8ToHex(identifier), liquidationTime, disputePrice);

        // Withdraw from liquidation to settle the dispute event.
        const txObject2 = await emp.withdrawLiquidation("0", sponsor2, { from: sponsor2 });
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
      });
      it("Cannot set invalid config or empProps", async function() {
        let errorThrown1;
        try {
          // Create an invalid config. A valid config expects two arrays of addresses.
          const invalidConfig1 = { monitoredLiquidators: liquidator, monitoredDisputers: [disputer] };
          contractMonitor = new ContractMonitor({
            logger: spyLogger,
            expiringMultiPartyEventClient: eventClient,
            priceFeed: priceFeedMock,
            config: invalidConfig1,
            empProps
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
            expiringMultiPartyEventClient: eventClient,
            priceFeed: priceFeedMock,
            config: invalidConfig2,
            empProps
          });
          errorThrown2 = false;
        } catch (err) {
          errorThrown2 = true;
        }
        assert.isTrue(errorThrown2);

        let errorThrown3;
        try {
          // Create an invalid empProps. This includes missing values or wrong type asignment.

          empProps.collateralDecimals = null; // set a variable that must be a number to null
          contractMonitor = new ContractMonitor({
            logger: spyLogger,
            expiringMultiPartyEventClient: eventClient,
            priceFeed: priceFeedMock,
            config: monitorConfig, // valid config
            empProps
          });
          errorThrown3 = false;
        } catch (err) {
          errorThrown3 = true;
        }
        assert.isTrue(errorThrown3);
      });

      it("Can correctly create contract monitor with no config provided", async function() {
        let errorThrown;
        try {
          // Create an invalid config. A valid config expects two arrays of addresses.
          const emptyConfig = {};
          contractMonitor = new ContractMonitor({
            logger: spyLogger,
            expiringMultiPartyEventClient: eventClient,
            priceFeed: priceFeedMock,
            config: emptyConfig,
            empProps
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
      });
    });
  }
});

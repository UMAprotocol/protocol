const { toWei, toBN, hexToUtf8 } = web3.utils;
const winston = require("winston");
const sinon = require("sinon");
const { interfaceName } = require("../../core/utils/Constants.js");
const { MAX_UINT_VAL } = require("../../common/Constants.js");

// Script to test
const { ContractMonitor } = require("../ContractMonitor");

// Helper client script
const {
  ExpiringMultiPartyEventClient
} = require("../../financial-templates-lib/clients/ExpiringMultiPartyEventClient");

// Price feed mock
const { PriceFeedMock } = require("../../financial-templates-lib/test/price-feed/PriceFeedMock");

// Custom winston transport module to monitor winston log outputs
const { SpyTransport, lastSpyLogIncludes } = require("../../financial-templates-lib/logger/SpyTransport");

// Truffle artifacts
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const Finder = artifacts.require("Finder");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const MockOracle = artifacts.require("MockOracle");
const TokenFactory = artifacts.require("TokenFactory");
const Token = artifacts.require("ExpandedERC20");
const Timer = artifacts.require("Timer");

contract("ContractMonitor.js", function(accounts) {
  const tokenSponsor = accounts[0];
  const liquidator = accounts[1];
  const disputer = accounts[2];
  const sponsor1 = accounts[3];
  const sponsor2 = accounts[4];
  const sponsor3 = accounts[5];

  const zeroAddress = "0x0000000000000000000000000000000000000000";
  const unreachableDeadline = MAX_UINT_VAL;

  // Contracts
  let collateralToken;
  let collateralTokenSymbol;
  let emp;
  let syntheticToken;
  let mockOracle;
  let identifierWhitelist;

  // Test object for EMP event client
  let eventClient;

  // Price feed mock
  let priceFeedMock;

  // re-used variables
  let expirationTime;
  let constructorParams;

  // Keep track of new sponsor transactions for testing `checkForNewSponsors` method.
  let newSponsorTxn;

  const spy = sinon.spy();

  before(async function() {
    collateralToken = await Token.new("Dai Stable coin", "DAI", 18, { from: tokenSponsor });

    identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.addSupportedIdentifier(web3.utils.utf8ToHex("ETH/BTC"));

    // Create a mockOracle and finder. Register the mockOracle with the finder.
    finder = await Finder.deployed();
    mockOracle = await MockOracle.new(finder.address, Timer.address);
    const mockOracleInterfaceName = web3.utils.utf8ToHex(interfaceName.Oracle);
    await finder.changeImplementationAddress(mockOracleInterfaceName, mockOracle.address);
  });

  beforeEach(async function() {
    const currentTime = await mockOracle.getCurrentTime.call();
    const timer = await Timer.deployed();
    await timer.setCurrentTime(currentTime.toString());
    expirationTime = currentTime.toNumber() + 100; // 100 seconds in the future

    constructorParams = {
      isTest: true,
      expirationTimestamp: expirationTime.toString(),
      withdrawalLiveness: "1",
      collateralAddress: collateralToken.address,
      finderAddress: Finder.address,
      tokenFactoryAddress: TokenFactory.address,
      timerAddress: Timer.address,
      priceFeedIdentifier: web3.utils.utf8ToHex("ETH/BTC"),
      syntheticName: "Test UMA Token",
      syntheticSymbol: "ETHBTC",
      liquidationLiveness: "10",
      collateralRequirement: { rawValue: toWei("1.5") },
      disputeBondPct: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPct: { rawValue: toWei("0.1") },
      disputerDisputeRewardPct: { rawValue: toWei("0.1") },
      minSponsorTokens: { rawValue: toWei("1") }
    };

    // Create a sinon spy and give it to the SpyTransport as the winston logger. Use this to check all winston
    // logs the correct text based on interactions with the emp. Note that only `info` level messages are captured.
    const spyLogger = winston.createLogger({
      level: "info",
      transports: [new SpyTransport({ level: "info" }, { spy: spy })]
    });

    emp = await ExpiringMultiParty.new(constructorParams);
    eventClient = new ExpiringMultiPartyEventClient(spyLogger, ExpiringMultiParty.abi, web3, emp.address);
    priceFeedMock = new PriceFeedMock();

    // Define a configuration object. In this config only monitor one liquidator and one disputer.
    const contractMonitorConfig = { monitoredLiquidators: [liquidator], monitoredDisputers: [disputer] };

    syntheticToken = await Token.at(await emp.tokenCurrency());

    const empProps = {
      collateralCurrencySymbol: await collateralToken.symbol(),
      syntheticCurrencySymbol: await syntheticToken.symbol(),
      priceIdentifier: hexToUtf8(await emp.priceIdentifier()),
      networkId: await web3.eth.net.getId()
    };

    contractMonitor = new ContractMonitor(
      spyLogger,
      eventClient,
      contractMonitorConfig,
      priceFeedMock,
      empProps,
      mockOracle
    );

    await collateralToken.addMember(1, tokenSponsor, {
      from: tokenSponsor
    });

    //   Bulk mint and approve for all wallets
    for (let i = 1; i < 6; i++) {
      await collateralToken.mint(accounts[i], toWei("100000000"), {
        from: tokenSponsor
      });
      await collateralToken.approve(emp.address, toWei("100000000"), {
        from: accounts[i]
      });
      await syntheticToken.approve(emp.address, toWei("100000000"), {
        from: accounts[i]
      });
    }

    // Create positions for the sponsors, liquidator and disputer
    await emp.create({ rawValue: toWei("150") }, { rawValue: toWei("50") }, { from: sponsor1 });
    await emp.create({ rawValue: toWei("175") }, { rawValue: toWei("45") }, { from: sponsor2 });
    newSponsorTxn = await emp.create({ rawValue: toWei("1500") }, { rawValue: toWei("400") }, { from: liquidator });
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
      { rawValue: toWei("10") },
      { rawValue: toWei("1.5") },
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
    await emp.requestWithdrawal({ rawValue: toWei("10") }, { from: sponsor1 });

    // Create liquidation to liquidate sponsor2 from sponsor1
    const txObject1 = await emp.createLiquidation(
      sponsor1,
      { rawValue: "0" },
      { rawValue: toWei("99999") },
      { rawValue: toWei("100") },
      unreachableDeadline,
      { from: liquidator }
    );

    // Update the eventClient and check it has the liquidation event stored correctly
    await eventClient.update();
    priceFeedMock.setHistoricalPrice(toBN(toWei("1")));

    // Check for liquidation events
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
    assert.isTrue(lastSpyLogIncludes(spy, "ETHBTC")); // should contain token symbol

    // Liquidate another position and ensure the Contract monitor emits the correct params
    const txObject2 = await emp.createLiquidation(
      sponsor2,
      { rawValue: "0" },
      { rawValue: toWei("99999") },
      { rawValue: toWei("100") },
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
  });
  it("Winston correctly emits dispute events", async function() {
    // Create liquidation to dispute.
    await emp.createLiquidation(
      sponsor1,
      { rawValue: "0" },
      { rawValue: toWei("99999") },
      { rawValue: toWei("100") },
      unreachableDeadline,
      { from: liquidator }
    );

    const txObject1 = await emp.dispute("0", sponsor1, {
      from: disputer
    });

    // Update the eventClient and check it has the dispute event stored correctly
    await eventClient.clearState();
    await eventClient.update();
    priceFeedMock.setHistoricalPrice(toBN(toWei("1")));

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
      { rawValue: toWei("99999") },
      { rawValue: toWei("100") },
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
      { rawValue: toWei("99999") },
      { rawValue: toWei("100") },
      unreachableDeadline,
      { from: liquidator }
    );

    // Dispute the position from the disputer
    await emp.dispute("0", sponsor1, {
      from: disputer
    });

    // Push a price such that the dispute fails and ensure the resolution reports correctly. Sponsor1 has 50 units of
    // debt and 150 units of collateral. price of 2.5: 150 / (50 * 2.5) = 120% => undercollateralized
    let disputePrice = toWei("2.5");
    await mockOracle.pushPrice(web3.utils.utf8ToHex("ETH/BTC"), liquidationTime, disputePrice);

    // Withdraw from liquidation to settle the dispute event.
    const txObject1 = await emp.withdrawLiquidation("0", sponsor1, { from: liquidator });
    await eventClient.clearState();

    // Update the eventClient and check it has the dispute event stored correctly
    await eventClient.update();
    priceFeedMock.setHistoricalPrice(toBN(toWei("1")));

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
      { rawValue: toWei("99999") },
      { rawValue: toWei("100") },
      unreachableDeadline,
      { from: sponsor1 }
    );

    // Dispute the liquidator from a non-monitor address (sponsor2)
    await emp.dispute("0", sponsor2, {
      from: sponsor2
    });

    // Push a price such that the dispute succeeds and ensure the resolution reports correctly. Sponsor2 has 45 units of
    // debt and 175 units of collateral. price of 2.0: 175 / (45 * 2) = 194% => sufficiently collateralized
    disputePrice = toWei("2.0");
    await mockOracle.pushPrice(web3.utils.utf8ToHex("ETH/BTC"), liquidationTime, disputePrice);

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
});

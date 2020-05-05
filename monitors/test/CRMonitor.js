const { toWei } = web3.utils;
const winston = require("winston");
const sinon = require("sinon");
const { interfaceName } = require("../../core/utils/Constants.js");

// Script to test
const { CRMonitor } = require("../CRMonitor");

// Helper client script
const { ExpiringMultiPartyClient } = require("../../financial-templates-lib/ExpiringMultiPartyClient");

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

contract("CRMonitor.js", function(accounts) {
  const tokenSponsor = accounts[0];
  const monitoredTrader = accounts[1];
  const monitoredSponsor = accounts[2];

  // Contracts
  let collateralToken;
  let collateralTokenSymbol;
  let emp;
  let syntheticToken;
  let mockOracle;
  let identifierWhitelist;

  // Test object for EMP event client
  let eventClient;

  // re-used variables
  let expirationTime;
  let constructorParams;
  let currentTime;

  const spy = sinon.spy();

  before(async function() {
    collateralToken = await Token.new("Dai Stable coin", "Dai", 18, { from: tokenSponsor });

    identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.addSupportedIdentifier(web3.utils.utf8ToHex("UMATEST"));

    // Create a mockOracle and finder. Register the mockOracle with the finder.
    finder = await Finder.deployed();
    mockOracle = await MockOracle.new(finder.address, Timer.address);
    const mockOracleInterfaceName = web3.utils.utf8ToHex(interfaceName.Oracle);
    await finder.changeImplementationAddress(mockOracleInterfaceName, mockOracle.address);
  });

  beforeEach(async function() {
    currentTime = await mockOracle.getCurrentTime.call();
    timer = await Timer.deployed();
    await timer.setCurrentTime(currentTime.toString());
    expirationTime = currentTime.toNumber() + 100; // 100 seconds in the future

    constructorParams = {
      isTest: true,
      expirationTimestamp: expirationTime.toString(),
      withdrawalLiveness: "10",
      collateralAddress: collateralToken.address,
      finderAddress: Finder.address,
      tokenFactoryAddress: TokenFactory.address,
      timerAddress: Timer.address,
      priceFeedIdentifier: web3.utils.utf8ToHex("UMATEST"),
      syntheticName: "Test UMA Token",
      syntheticSymbol: "UMATEST",
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
    empClient = new ExpiringMultiPartyClient(ExpiringMultiParty.abi, web3, emp.address);

    const walletMonitorObject = [
      {
        name: "Monitored trader wallet",
        address: monitoredTrader,
        crAlert: 200 // if the collateralization ratio of this wallet drops below 200% send an alert
      },
      {
        name: "Monitored sponsor wallet",
        address: monitoredSponsor,
        crAlert: 150 // if the collateralization ratio of this wallet drops below 150% send an alert
      }
    ];

    crMonitor = new CRMonitor(spyLogger, empClient, walletMonitorObject);

    syntheticToken = await Token.at(await emp.tokenCurrency());

    await collateralToken.addMember(1, tokenSponsor, {
      from: tokenSponsor
    });

    //   Bulk mint and approve for all wallets
    for (let i = 1; i < 3; i++) {
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

    // Create positions for the monitoredTrader and monitoredSponsor accounts
    await emp.create({ rawValue: toWei("250") }, { rawValue: toWei("100") }, { from: monitoredTrader });
    await emp.create({ rawValue: toWei("300") }, { rawValue: toWei("100") }, { from: monitoredSponsor });
  });

  it("Winston correctly emits collateralization ratio message", async function() {
    // No messages created if safely above the CR threshold
    await empClient._update();
    await crMonitor.checkWalletCrRatio(time => toWei("1"));
    assert.equal(spy.callCount, 0);

    // Emits a message if below the CR threshold. At a price of 1.3 only the monitoredTrader should be undercollateralized
    // with a CR of 250 / (100 * 1.3) =1.923 which is below this addresses threshold of 200 and should emit a message.
    await empClient._update();
    await crMonitor.checkWalletCrRatio(time => toWei("1.3"));
    assert.equal(spy.callCount, 1);
    assert.isTrue(lastSpyLogIncludes(spy, "Collateralization ratio alert"));
    assert.isTrue(lastSpyLogIncludes(spy, "Monitored trader wallet")); // Monitored wallet name from `walletMonitorObject`
    assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/address/${monitoredTrader}`)); // liquidator address
    assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/address/${monitoredTrader}`)); // liquidator address

    // The message should be sent every time the bot is polled and there is a crossing of the threshold line. At a price
    // of 1.2 monitoredTrader's CR = 250/(100*1.2) = 2.083 and monitoredSponsor's CR = 300/(100*1.2) = 2.5 which places
    // both monitored wallets above their thresholds. As a result no new message should be sent.
    await empClient._update();
    await crMonitor.checkWalletCrRatio(time => toWei("1.2"));
    assert.equal(spy.callCount, 1); // no new message.

    // Crossing the price threshold for both sponsors should emit exactly 2 new messages. At a price of 2.1
    // monitoredTrader's CR = 250/(100*2.1) = 1.1904 and monitoredSponsor's CR = 300/(100*2.1) = 1.42857. At these CRs
    // Both bots are below their thresholds
    await empClient._update();
    await crMonitor.checkWalletCrRatio(time => toWei("2.1"));
    assert.equal(spy.callCount, 3); // two new messages

    // A second check below this threshold should again trigger messages for both sponsors.
    await empClient._update();
    await crMonitor.checkWalletCrRatio(time => toWei("2.1"));
    assert.equal(spy.callCount, 5);

    // Reset the price to over collateralized state for both accounts by moving the price into the lower value. This
    // should not emit any events as both correctly collateralized.
    await empClient._update();
    await crMonitor.checkWalletCrRatio(time => toWei("1"));
    assert.equal(spy.callCount, 5);

    // In addition to the price moving of the synthetic, adding/removing collateral or creating/redeeming debt can also impact
    // a positions collateralization ratio. If monitoredTrader was to withdraw some collateral after waiting the withdrawal liveness
    // they can place their position's collateralization under the threshold. Say monitoredTrader withdraws 75 units of collateral.
    // given price is 1 unit of synthetic for each unit of debt. This would place their position at a collateralization ratio of
    // 175/(100*1)=1.75. monitoredSponsor is at 300/(100*1)=3.00 which is well over collateralized.
    await emp.requestWithdrawal({ rawValue: toWei("75") }, { from: monitoredTrader });

    currentTime = await timer.getCurrentTime.call();
    // advance time after withdrawal liveness
    await timer.setCurrentTime(currentTime.toNumber() + 11);

    await emp.withdrawPassedRequest({ from: monitoredTrader });

    await empClient._update();
    await crMonitor.checkWalletCrRatio(time => toWei("1"));
    assert.equal(spy.callCount, 6); // a new message is sent.
  });
});

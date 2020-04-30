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
    const currentTime = await mockOracle.getCurrentTime.call();
    const timer = await Timer.deployed();
    await timer.setCurrentTime(currentTime.toString());
    expirationTime = currentTime.toNumber() + 100; // 100 seconds in the future

    constructorParams = {
      isTest: true,
      expirationTimestamp: expirationTime.toString(),
      withdrawalLiveness: "1000",
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

    crMonitor = new CRMonitor(spyLogger, empClient, accounts[0], walletMonitorObject);

    syntheticToken = await Token.at(await emp.tokenCurrency());

    await collateralToken.addMember(1, tokenSponsor, {
      from: tokenSponsor
    });

    //   Bulk mint and approve for all wallets
    for (let i = 1; i < 5; i++) {
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
    await emp.create({ rawValue: toWei("200") }, { rawValue: toWei("100") }, { from: monitoredTrader });
    await emp.create({ rawValue: toWei("300") }, { rawValue: toWei("100") }, { from: monitoredSponsor });
  });

  it("Winston correctly emits collateralization ratio message", async function() {
    // No messages created if safely above the CR threshold
    await empClient._update();
    await crMonitor.checkWalletCrRatio(time => toWei("1"));
    assert.equal(spy.callCount, 0);

    // Emits a message if below the CR threshold. At a price of 1.25 only the monitoredTrader should be undercollateralized
    // with a CR of 200 / (100 * 1.5) =1.66. this is below this addresses threshold of 200 and should emit an event.

    await empClient._update();
    await crMonitor.checkWalletCrRatio(time => toWei("1.25"));
    assert.equal(spy.callCount, 1);
    assert.isTrue(lastSpyLogIncludes(spy, "Collateralization ratio alert"));
    assert.isTrue(lastSpyLogIncludes(spy, "Monitored trader wallet")); // Monitored wallet name from `walletMonitorObject`
    assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/address/${monitoredTrader}`)); // liquidator address

    // The event should be sent exactly once if there is no crossing of the threshold line.
    await empClient._update();
    await crMonitor.checkWalletCrRatio(time => toWei("1.25"));
    assert.equal(spy.callCount, 1);
  });
});

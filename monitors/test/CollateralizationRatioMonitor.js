const { toWei, toBN } = web3.utils;
const winston = require("winston");
const sinon = require("sinon");
const { interfaceName } = require("../../core/utils/Constants.js");

// Script to test
const { BalanceMonitor } = require("../BalanceMonitor");

// Helper client script
const { ExpiringMultiPartyClient } = require("../../financial-templates-lib/ExpiringMultiPartyClient");

// Custom winston transport module to monitor winston log outputs
const { SpyTransport, lastSpyLogIncludes } = require("../../financial-templates-lib/logger/SpyTransport");

// Truffle artifacts
const Token = artifacts.require("ExpandedERC20");

contract("BalanceMonitor.js", function(accounts) {
  const tokenCreator = accounts[0];
  const liquidatorBot = accounts[1];
  const disputerBot = accounts[2];
  const umaSponsor = accounts[3];
  const umaTrading = accounts[4];

  // Test object for EMP event client
  let balanceMonitor;
  let ExpiringMultiPartyClient;
  let spy;

  beforeEach(async function() {
    // Create new tokens for every test to reset balances of all accounts
    collateralToken = await Token.new("Dai Stable coin", "DAI", 18, { from: tokenCreator });
    await collateralToken.addMember(1, tokenCreator, { from: tokenCreator });
    syntheticToken = await Token.new("Test UMA Token", "UMATEST", 18, { from: tokenCreator });
    await syntheticToken.addMember(1, tokenCreator, { from: tokenCreator });

    // Create a sinon spy and give it to the SpyTransport as the winston logger. Use this to check all winston
    // logs the correct text based on interactions with the emp. Note that only `info` level messages are captured.
    spy = sinon.spy(); // new spy per test to reset all counters and emited messages.
    const spyLogger = winston.createLogger({
      level: "info",
      transports: [new SpyTransport({ level: "info" }, { spy: spy })]
    });
    ExpiringMultiPartyClient = new ExpiringMultiPartyClient(
      spyLogger,
      Token.abi,
      web3,
      collateralToken.address,
      syntheticToken.address,
      10
    );

    // Create two wallet objects to monitor with different names and collateralization requirement alert thresholds.
    const walletMonitorObject = [
      {
        walletName: "UMA sponsor wallet",
        address: umaSponsor,
        crAlert: 150 // if the collateralization ratio of this wallet drops below 150% send an alert
      },
      {
        walletName: "UMA trading wallet",
        address: umaTrading,
        crAlert: 200 // if the collateralization ratio of this wallet drops below 200% send an alert
      }
    ];

    balanceMonitor = new BalanceMonitor(
      spyLogger,
      tokenBalanceClient,
      accounts[0],
      botMonitorObject,
      walletMonitorObject
    );

    // setup the positions to the initial happy state.

    // UMA sponsor should have enough collateral and tokens to start above the crAlert threshold of 150.
    await collateralToken.mint(umaSponsor, toWei("200"), { from: tokenCreator });
    await syntheticToken.mint(umaSponsor, toWei("100"), { from: tokenCreator });

    // UMA trading wallet should have enough collateral and tokens to start above the crAlert threshold of 200.
    await collateralToken.mint(umaTrading, toWei("300"), { from: tokenCreator });
    await syntheticToken.mint(umaTrading, toWei("100"), { from: tokenCreator });
  });

  it("Correctly emits messages on CR threshold", async function() {});
});

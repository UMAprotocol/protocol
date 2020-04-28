const { toWei } = web3.utils;
const winston = require("winston");
const sinon = require("sinon");
const { interfaceName } = require("../../core/utils/Constants.js");

// Script to test
const { BalanceMonitor } = require("../BalanceMonitor");

// Helper client script
const { TokenBalanceClient } = require("../../financial-templates-lib/TokenBalanceClient");

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
  let tokenBalanceClient;

  const spy = sinon.spy();

  before(async function() {
    collateralToken = await Token.new("Dai Stable coin", "Dai", 18, { from: tokenCreator });
    syntheticToken = await Token.new("Test UMA Token", "UMATEST", 18, { from: tokenCreator });
  });

  beforeEach(async function() {
    // Create a sinon spy and give it to the SpyTransport as the winston logger. Use this to check all winston
    // logs the correct text based on interactions with the emp. Note that only `info` level messages are captured.
    const spyLogger = winston.createLogger({
      level: "info",
      transports: [new SpyTransport({ level: "info" }, { spy: spy })]
    });
    tokenBalanceClient = new TokenBalanceClient(
      spyLogger,
      Token.abi,
      web3,
      collateralToken.address,
      syntheticToken.address,
      10
    );

    // Create two bot objects to monitor a liquidator bot with a lot of tokens and Eth and a disputer with less.
    const botMonitorObject = [
      {
        name: "UMA liquidator Bot",
        address: liquidatorBot,
        collateralThreshold: toWei("10000"),
        syntheticThreshold: toWei("10000"),
        etherThreshold: toWei("10")
      },
      {
        name: "UMA disputor Bot",
        address: disputerBot,
        collateralThreshold: toWei("500"),
        syntheticThreshold: toWei("100"),
        etherThreshold: toWei("1")
      }
    ];

    // Create two wallet objects to monitor with different names and collateralization requirement alert thresholds.
    const walletMonitorObject = [
      {
        walletName: "UMA sponsor wallet",
        address: umaSponsor,
        crAlert: 150
      },
      {
        walletName: "UMA trading wallet",
        address: umaTrading,
        crAlert: 200
      }
    ];

    balanceMonitor = new BalanceMonitor(
      spyLogger,
      tokenBalanceClient,
      accounts[0],
      botMonitorObject,
      walletMonitorObject
    );

    // setup the positions to the initial happy state
    // await collateralToken.mint(liquidatorBot, toWei("1234"), { from: tokenCreator });
  });

  it("Winston correctly emits messages on balance threshold alerts", async function() {
    // update the client
    tokenBalanceClient._update();
    await balanceMonitor.checkBotBalances();
  });
});

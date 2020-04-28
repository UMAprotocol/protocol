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
    await collateralToken.addMember(1, tokenCreator, { from: tokenCreator });
    syntheticToken = await Token.new("Test UMA Token", "UMATEST", 18, { from: tokenCreator });
    await syntheticToken.addMember(1, tokenCreator, { from: tokenCreator });
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
        name: "Liquidator bot",
        address: liquidatorBot,
        collateralThreshold: toWei("10000"), // 10,000.00 tokens of collateral
        syntheticThreshold: toWei("10000"), // 10,000.00 tokens of debt
        etherThreshold: toWei("10")
      },
      {
        name: "Disputer bot",
        address: disputerBot,
        collateralThreshold: toWei("500"), // 500.00 tokens of collateral
        syntheticThreshold: toWei("100"), // 100.00 tokens of debt
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

    // setup the positions to the initial happy state.
    // Liquidator threshold is 10000 for both collateral and synthetic so mint a bit more to start above this
    await collateralToken.mint(liquidatorBot, toWei("11000"), { from: tokenCreator });
    await syntheticToken.mint(liquidatorBot, toWei("11000"), { from: tokenCreator });

    // Disuptor threshold is 500 and 100 for collateral and synthetics. Again mint above.
    await collateralToken.mint(disputerBot, toWei("600"), { from: tokenCreator });
    await syntheticToken.mint(disputerBot, toWei("100"), { from: tokenCreator });

    // UMA sponsor should have enough collateral and tokens to start above the crAlert threshold of 150.
    await collateralToken.mint(umaSponsor, toWei("200"), { from: tokenCreator });
    await syntheticToken.mint(umaSponsor, toWei("100"), { from: tokenCreator });

    // UMA trading wallet should have enough collateral and tokens to start above the crAlert threshold of 200.
    await collateralToken.mint(umaSponsor, toWei("300"), { from: tokenCreator });
    await syntheticToken.mint(umaSponsor, toWei("100"), { from: tokenCreator });
  });

  it("Winston correctly emits messages on balance threshold alerts", async function() {
    // update the client.
    await tokenBalanceClient._update();
    await tokenBalanceClient._update();
    await balanceMonitor.checkBotBalances();

    // The spy should not have been called. All positions are correctly funded and collateralized.
    assert.equal(spy.callCount, 0);

    // Transfer some tokens away from one of the monitored addresses and check that the bot correctly reports this.
    // Transferring 2000 tokens from the liquidatorBot brings the balance to 9000. this is below the 10000 threshold.
    await collateralToken.transfer(tokenCreator, toWei("2000"), { from: liquidatorBot });
    await tokenBalanceClient._update();
    await balanceMonitor.checkBotBalances();

    // The spy should be called exactly once. The most recent message should inform of the correct monitored position,
    // it's expected balance and and it's actual balance.
    assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/address/${liquidatorBot}`)); // liquidator address
    assert.isTrue(lastSpyLogIncludes(spy, "collateral balance warning")); // we moved collateral. should emit accordingly.
    assert.isFalse(lastSpyLogIncludes(spy, "synthetic balance warning")); // Synthetic was not moved. should not emit.
    assert.isTrue(lastSpyLogIncludes(spy, "Liquidator bot")); // name of bot from bot object
    assert.isTrue(lastSpyLogIncludes(spy, "10,000.00")); // the correctly formatted number of threshold collateral
    assert.isTrue(lastSpyLogIncludes(spy, "9,000.00")); // the correctly formatted number of actual collateral

    //

    console.log(spy.callCount);
  });
});

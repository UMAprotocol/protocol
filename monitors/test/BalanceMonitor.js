const { toWei, toBN } = web3.utils;
const winston = require("winston");
const sinon = require("sinon");

// Script to test
const { BalanceMonitor } = require("../BalanceMonitor");

// Helper client script
const { TokenBalanceClient } = require("../../financial-templates-lib/clients/TokenBalanceClient");

// Custom winston transport module to monitor winston log outputs
const { SpyTransport, lastSpyLogIncludes } = require("../../financial-templates-lib/logger/SpyTransport");

// Truffle artifacts
const Token = artifacts.require("ExpandedERC20");

contract("BalanceMonitor.js", function(accounts) {
  const tokenCreator = accounts[0];
  const liquidatorBot = accounts[1];
  const disputerBot = accounts[2];

  // Test object for EMP event client
  let balanceMonitor;
  let tokenBalanceClient;
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
        collateralThreshold: toWei("10000"), // 10,000.00 tokens of collateral threshold
        syntheticThreshold: toWei("10000"), // 10,000.00 tokens of debt threshold
        etherThreshold: toWei("10")
      },
      {
        name: "Disputer bot",
        address: disputerBot,
        collateralThreshold: toWei("500"), // 500.00 tokens of collateral threshold
        syntheticThreshold: toWei("100"), // 100.00 tokens of debt threshold
        etherThreshold: toWei("1")
      }
    ];

    balanceMonitor = new BalanceMonitor(spyLogger, tokenBalanceClient, botMonitorObject);

    // setup the positions to the initial happy state.
    // Liquidator threshold is 10000 for both collateral and synthetic so mint a bit more to start above this
    await collateralToken.mint(liquidatorBot, toWei("11000"), { from: tokenCreator });
    await syntheticToken.mint(liquidatorBot, toWei("11000"), { from: tokenCreator });

    // Disputer threshold is 500 and 100 for collateral and synthetics. mint collateral above this and synthetic at this
    await collateralToken.mint(disputerBot, toWei("600"), { from: tokenCreator });
    await syntheticToken.mint(disputerBot, toWei("100"), { from: tokenCreator });
  });

  it("Correctly emits messages on balance threshold", async function() {
    // Update the client.
    await tokenBalanceClient.update();
    await tokenBalanceClient.update();
    await balanceMonitor.checkBotBalances();

    // The spy should not have been called. All positions are correctly funded and collateralized.
    assert.equal(spy.callCount, 0);

    // Transfer some tokens away from one of the monitored addresses and check that the bot correctly reports this.
    // Transferring 2000 tokens from the liquidatorBot brings its balance to 9000. this is below the 10000 threshold.
    await collateralToken.transfer(tokenCreator, toWei("2000"), { from: liquidatorBot });
    assert.equal((await collateralToken.balanceOf(liquidatorBot)).toString(), toWei("9000"));
    await tokenBalanceClient.update();
    await balanceMonitor.checkBotBalances();

    // The spy should be called exactly once. The most recent message should inform of the correct monitored position,
    // it's expected balance and and it's actual balance.
    assert.equal(spy.callCount, 1);
    assert.isTrue(lastSpyLogIncludes(spy, "Liquidator bot")); // name of bot from bot object
    assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/address/${liquidatorBot}`)); // liquidator address
    assert.isTrue(lastSpyLogIncludes(spy, "collateral balance warning")); // Tx moved collateral. should emit accordingly
    assert.isFalse(lastSpyLogIncludes(spy, "synthetic balance warning")); // Synthetic was not moved. should not emit
    assert.isTrue(lastSpyLogIncludes(spy, "10,000.00")); // Correctly formatted number of threshold collateral
    assert.isTrue(lastSpyLogIncludes(spy, "9,000.00")); // Correctly formatted number of actual collateral
    assert.isTrue(lastSpyLogIncludes(spy, "DAI")); // Message should include the collateral currency symbol

    // Querying the balance again should emit a second message as the balance is still below the threshold.
    await tokenBalanceClient.update();
    await balanceMonitor.checkBotBalances();
    assert.equal(spy.callCount, 2);

    // Likewise a further drop in collateral should emit a new message.
    await collateralToken.transfer(tokenCreator, toWei("2000"), { from: liquidatorBot });
    assert.equal((await collateralToken.balanceOf(liquidatorBot)).toString(), toWei("7000"));
    await tokenBalanceClient.update();
    await balanceMonitor.checkBotBalances();
    assert.equal(spy.callCount, 3);

    // Dropping the synthetic below the threshold of the disputer should fire a message. The disputerBot's threshold
    // is set to 100e18, with a balance of 100e18 so moving just 1 wei units of synthetic should trigger an alert.
    // The liquidator bot is still below its threshold we should expect two messages to fire (total calls should be 3 + 2).
    await syntheticToken.transfer(tokenCreator, "1", { from: disputerBot });
    assert.equal((await syntheticToken.balanceOf(disputerBot)).toString(), toBN(toWei("100")).sub(toBN("1")));

    await tokenBalanceClient.update();
    await balanceMonitor.checkBotBalances();
    assert.equal(spy.callCount, 5);
    assert.isTrue(lastSpyLogIncludes(spy, "Disputer bot")); // name of bot from bot object
    assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/address/${disputerBot}`)); // disputer address
    assert.isFalse(lastSpyLogIncludes(spy, "collateral balance warning")); // collateral was not moved. should not emit
    assert.isTrue(lastSpyLogIncludes(spy, "synthetic balance warning")); // Tx moved synthetic. should emit accordingly
    assert.isTrue(lastSpyLogIncludes(spy, "100.00")); // Correctly formatted number of threshold Synthetic
    assert.isTrue(lastSpyLogIncludes(spy, "99.99")); // Correctly formatted number of Synthetic
    assert.isTrue(lastSpyLogIncludes(spy, "UMATEST")); // Message should include the Synthetic currency symbol
  });
  it("Correctly emits messages on balance threshold", async function() {
    await tokenBalanceClient.update();
    await tokenBalanceClient.update();
    await balanceMonitor.checkBotBalances();

    // Test the ETH balance thresholding. Transfer enough Eth away from liquidatorBot should result in alert.
    const startLiquidatorBotETH = await web3.eth.getBalance(liquidatorBot);

    // Transfer the liquidator bot's eth balance - 5Eth such that irrespective of the value it ends with ~5 Eth (excluding gas cost).
    const amountToTransfer = toBN(startLiquidatorBotETH).sub(toBN(toWei("5")));
    await web3.eth.sendTransaction({
      from: liquidatorBot,
      to: tokenCreator,
      value: amountToTransfer.toString()
    });

    // After this transaction the liquidatorBot's ETH balance is below the threshold of 10Eth. The balance should be 5Eth,
    // minus the transaction fees. Thus strictly less than 5. This should emit an message.
    assert.isTrue(toBN(await web3.eth.getBalance(liquidatorBot)).lt(toBN(toWei("5"))));
    await tokenBalanceClient.update();
    await balanceMonitor.checkBotBalances();
    assert.equal(spy.callCount, 1);
    assert.isTrue(lastSpyLogIncludes(spy, "Liquidator bot")); // name of bot from bot object
    assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/address/${liquidatorBot}`)); // liquidator address
    assert.isTrue(lastSpyLogIncludes(spy, "Ether balance warning")); // Tx moved Ether. should emit accordingly
    assert.isFalse(lastSpyLogIncludes(spy, "synthetic balance warning")); // Synthetic was not moved. should not emit
    assert.isFalse(lastSpyLogIncludes(spy, "collateral balance warning")); // Collateral was not moved. should not emit
    assert.isTrue(lastSpyLogIncludes(spy, "10.00")); // Correctly formatted number of threshold collateral
    assert.isTrue(lastSpyLogIncludes(spy, "4.99")); // Correctly formatted number of actual number of Ether, rounded
    assert.isTrue(lastSpyLogIncludes(spy, "Ether")); // Message should include the collateral currency symbol

    // At the end of the test transfer back the eth to the liquidatorBot to clean up
    await web3.eth.sendTransaction({
      from: tokenCreator,
      to: liquidatorBot,
      value: amountToTransfer.toString()
    });
  });
  it("Correctly emit messages if balance moves above and below thresholds", async function() {
    // Update the client. No messages should be sent as above threshold values on all fronts.
    await tokenBalanceClient.update();
    await tokenBalanceClient.update();
    await balanceMonitor.checkBotBalances();
    assert.equal(spy.callCount, 0);

    // Transfer tokens away from the liquidator below the threshold should emit a message
    await collateralToken.transfer(tokenCreator, toWei("1001"), { from: liquidatorBot });
    assert.equal((await collateralToken.balanceOf(liquidatorBot)).toString(), toWei("9999"));
    await tokenBalanceClient.update();
    await balanceMonitor.checkBotBalances();
    assert.equal(spy.callCount, 1);
    assert.isTrue(lastSpyLogIncludes(spy, "Liquidator bot")); // name of bot from bot object
    assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/address/${liquidatorBot}`)); // liquidator address
    assert.isTrue(lastSpyLogIncludes(spy, "collateral balance warning")); // Tx moved collateral. should emit accordingly
    assert.isTrue(lastSpyLogIncludes(spy, "10,000.00")); // Correctly formatted number of threshold collateral
    assert.isTrue(lastSpyLogIncludes(spy, "9,999.00")); // Correctly formatted number of actual collateral
    assert.isTrue(lastSpyLogIncludes(spy, "DAI")); // Message should include the collateral currency symbol

    // Updating again should emit another message
    await tokenBalanceClient.update();
    await balanceMonitor.checkBotBalances();
    assert.equal(spy.callCount, 2);

    // Transferring tokens back to the bot such that it's balance is above the threshold, updating the client and
    // transferring tokens away again should initiate a new message.
    await collateralToken.transfer(liquidatorBot, toWei("11"), { from: tokenCreator });
    assert.equal((await collateralToken.balanceOf(liquidatorBot)).toString(), toWei("10010")); // balance above threshold
    await tokenBalanceClient.update();
    await balanceMonitor.checkBotBalances();
    assert.equal(spy.callCount, 2); // No new event as balance above threshold

    await collateralToken.transfer(tokenCreator, toWei("15"), { from: liquidatorBot });
    assert.equal((await collateralToken.balanceOf(liquidatorBot)).toString(), toWei("9995")); // balance below threshold

    await tokenBalanceClient.update();
    await balanceMonitor.checkBotBalances();
    assert.equal(spy.callCount, 3); // 1 new event as balance below threshold
    assert.isTrue(lastSpyLogIncludes(spy, "Liquidator bot")); // name of bot from bot object
    assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/address/${liquidatorBot}`)); // liquidator address
    assert.isTrue(lastSpyLogIncludes(spy, "collateral balance warning")); // Tx moved collateral. should emit accordingly
    assert.isTrue(lastSpyLogIncludes(spy, "10,000.00")); // Correctly formatted number of threshold collateral
    assert.isTrue(lastSpyLogIncludes(spy, "9,995.00")); // Correctly formatted number of actual collateral
    assert.isTrue(lastSpyLogIncludes(spy, "DAI")); // Message should include the collateral currency symbol
  });
});

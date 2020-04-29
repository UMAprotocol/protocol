const { toWei, toBN } = web3.utils;
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
    // Liquidator threshold is 10000 for both collateral and synthetic so mint a bit more to start above this
    await collateralToken.mint(liquidatorBot, toWei("11000"), { from: tokenCreator });
    await syntheticToken.mint(liquidatorBot, toWei("11000"), { from: tokenCreator });

    // Disputer threshold is 500 and 100 for collateral and synthetics. mint collateral above this and synthetic at this
    await collateralToken.mint(disputerBot, toWei("600"), { from: tokenCreator });
    await syntheticToken.mint(disputerBot, toWei("100"), { from: tokenCreator });

    // UMA sponsor should have enough collateral and tokens to start above the crAlert threshold of 150.
    await collateralToken.mint(umaSponsor, toWei("200"), { from: tokenCreator });
    await syntheticToken.mint(umaSponsor, toWei("100"), { from: tokenCreator });

    // UMA trading wallet should have enough collateral and tokens to start above the crAlert threshold of 200.
    await collateralToken.mint(umaSponsor, toWei("300"), { from: tokenCreator });
    await syntheticToken.mint(umaSponsor, toWei("100"), { from: tokenCreator });
  });

  it("Correctly emits messages on balance threshold", async function() {
    // Update the client.
    await tokenBalanceClient._update();
    await tokenBalanceClient._update();
    await balanceMonitor.checkBotBalances();

    // The spy should not have been called. All positions are correctly funded and collateralized.
    assert.equal(spy.callCount, 0);

    // Transfer some tokens away from one of the monitored addresses and check that the bot correctly reports this.
    // Transferring 2000 tokens from the liquidatorBot brings its balance to 9000. this is below the 10000 threshold.
    await collateralToken.transfer(tokenCreator, toWei("2000"), { from: liquidatorBot });
    assert.equal((await collateralToken.balanceOf(liquidatorBot)).toString(), toWei("9000"));
    await tokenBalanceClient._update();
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

    // Querying the balance again should not emit a second message as the balance is still below the threshold.
    await tokenBalanceClient._update();
    await balanceMonitor.checkBotBalances();
    assert.equal(spy.callCount, 1);

    // Likewise a further drop in collateral tokens should not emit a new message.
    await collateralToken.transfer(tokenCreator, toWei("2000"), { from: liquidatorBot });
    assert.equal((await collateralToken.balanceOf(liquidatorBot)).toString(), toWei("7000"));
    await tokenBalanceClient._update();
    await balanceMonitor.checkBotBalances();
    assert.equal(spy.callCount, 1);

    // Dropping the synthetic below the threshold of the disputer should fire a message. The disputerBot's threshold
    // is set to 100e18, with a balance of 100e18 so moving just 1 wei units of synthetic should trigger an alert.
    await syntheticToken.transfer(tokenCreator, "1", { from: disputerBot });
    assert.equal((await syntheticToken.balanceOf(disputerBot)).toString(), toBN(toWei("100")).sub(toBN("1")));

    await tokenBalanceClient._update();
    await balanceMonitor.checkBotBalances();
    assert.equal(spy.callCount, 2);
    assert.isTrue(lastSpyLogIncludes(spy, "Disputer bot")); // name of bot from bot object
    assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/address/${disputerBot}`)); // disputer address
    assert.isFalse(lastSpyLogIncludes(spy, "collateral balance warning")); // collateral was not moved. should not emit
    assert.isTrue(lastSpyLogIncludes(spy, "synthetic balance warning")); // Tx moved synthetic. should emit accordingly
    assert.isTrue(lastSpyLogIncludes(spy, "100.00")); // Correctly formatted number of threshold Synthetic
    assert.isTrue(lastSpyLogIncludes(spy, "99.99")); // Correctly formatted number of Synthetic
    assert.isTrue(lastSpyLogIncludes(spy, "UMATEST")); // Message should include the Synthetic currency symbol

    // Dropping the disputer's collateral balance below it's threshold should emit an message. Disputers threshold is
    // 500 and balance is dropped from 600 by 150 to 450
    await collateralToken.transfer(tokenCreator, toWei("150"), { from: disputerBot });
    assert.equal((await collateralToken.balanceOf(disputerBot)).toString(), toWei("450"));
    await tokenBalanceClient._update();
    await balanceMonitor.checkBotBalances();
    assert.equal(spy.callCount, 3);
    assert.isTrue(lastSpyLogIncludes(spy, "Disputer bot")); // name of bot from bot object
    assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/address/${disputerBot}`)); // disputer address
    assert.isTrue(lastSpyLogIncludes(spy, "collateral balance warning")); // Tx moved collateral. should include in message
    assert.isFalse(lastSpyLogIncludes(spy, "synthetic balance warning")); // synthetic was not moved. should not emit
    assert.isTrue(lastSpyLogIncludes(spy, "500.00")); // Correctly formatted number of threshold collateral
    assert.isTrue(lastSpyLogIncludes(spy, "450.00")); // Correctly formatted number of collateral for actual balance
    assert.isTrue(lastSpyLogIncludes(spy, "DAI")); // Message should include the Synthetic currency symbol

    // Lastly, test the ETH balance thresholding. Transfer enough Eth away from liquidatorBot should result in alert.
    const startLiquidatorBotETH = await web3.eth.getBalance(liquidatorBot);
    console.log("startLiquidatorBotETH", startLiquidatorBotETH);

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
    await tokenBalanceClient._update();
    await balanceMonitor.checkBotBalances();
    assert.equal(spy.callCount, 4);
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
    // Update the client.
    await tokenBalanceClient._update();
    await tokenBalanceClient._update();
    await balanceMonitor.checkBotBalances();
    assert.equal(spy.callCount, 0);
  });
});

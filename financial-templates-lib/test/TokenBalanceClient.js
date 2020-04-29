const { toWei } = web3.utils;
const winston = require("winston");

// Script to test
const { TokenBalanceClient } = require("../TokenBalanceClient");

// Truffle artifacts
const Token = artifacts.require("ExpandedERC20");

contract("BalanceMonitor.js", function(accounts) {
  const tokenCreator = accounts[0];
  const sponsor1 = accounts[1];
  const sponsor2 = accounts[2];
  const rando = accounts[3];

  // Test object for EMP event client
  let client;

  before(async function() {
    // The TokenBalance Client is independent of the EMP and simply needs two tokens to monitor.
    collateralToken = await Token.new("Dai Stable coin", "Dai", 18, { from: tokenCreator });
    await collateralToken.addMember(1, tokenCreator, { from: tokenCreator });
    syntheticToken = await Token.new("Test UMA Token", "UMATEST", 18, { from: tokenCreator });
    await syntheticToken.addMember(1, tokenCreator, { from: tokenCreator });
  });

  beforeEach(async function() {
    // The BalanceMonitor does not emit any info `level` events.  Therefore no need to test Winston outputs.
    // DummyLogger will not print anything to console as only capture `info` level events.
    const dummyLogger = winston.createLogger({
      level: "info",
      transports: [new winston.transports.Console()]
    });
    client = new TokenBalanceClient(dummyLogger, Token.abi, web3, collateralToken.address, syntheticToken.address, 10);
  });

  it("Returning token balances", async function() {
    // Should start at empty state (null) and the address should not be resolved.
    assert.equal(client.getCollateralBalance(sponsor1), null);
    assert.equal(client.getSyntheticBalance(sponsor1), null);
    assert.isFalse(client.resolvedAddressBalance(sponsor1));

    // After the second update the balances should update accordingly and should be resolved.
    await client._update();
    assert.equal(client.getCollateralBalance(sponsor1), 0);
    assert.equal(client.getSyntheticBalance(sponsor1), 0);
    assert.isTrue(client.resolvedAddressBalance(sponsor1));

    // After sending tokens to a wallet the client should update accordingly.
    await collateralToken.mint(sponsor1, toWei("1234"), { from: tokenCreator });
    await client._update();
    assert.equal(client.getCollateralBalance(sponsor1), toWei("1234"));
    assert.equal(client.getSyntheticBalance(sponsor1), 0);

    // Sending tokens to a wallet before they are search in the client should not load until queried.
    await syntheticToken.mint(sponsor2, toWei("5678"), { from: tokenCreator });
    await client._update();
    assert.equal(client.getCollateralBalance(sponsor2), null);
    assert.equal(client.getSyntheticBalance(sponsor2), null);
    assert.equal(client.getEtherBalance(sponsor2), null);
    assert.isFalse(client.resolvedAddressBalance(sponsor2));

    // After updating the client the balances should reflect accordingly.
    // After the second update the balances should update accordingly and should be resolved.
    await client._update();
    assert.equal(client.getCollateralBalance(sponsor2), 0);
    assert.equal(client.getSyntheticBalance(sponsor2), toWei("5678"));
    assert.equal(client.getEtherBalance(sponsor2), await web3.eth.getBalance(sponsor2));
    assert.isTrue(client.resolvedAddressBalance(sponsor2));

    // After multiple updates with no state changes the client should not update.
    await client._update();
    await client._update();
    await client._update();
    assert.equal(client.getCollateralBalance(sponsor1), toWei("1234"));
    assert.equal(client.getSyntheticBalance(sponsor1), 0);
    assert.isTrue(client.resolvedAddressBalance(sponsor2));
    assert.equal(client.getCollateralBalance(sponsor2), 0);
    assert.equal(client.getSyntheticBalance(sponsor2), toWei("5678"));
    assert.equal(client.getEtherBalance(sponsor2), await web3.eth.getBalance(sponsor2));
    assert.isTrue(client.resolvedAddressBalance(sponsor2));

    // After all testing rando should not be monitored address.
    assert.isFalse(client.resolvedAddressBalance(rando));
  });

  it("Returning ETH balances", async function() {
    assert.equal(client.getEtherBalance(sponsor1), null);

    await client._update();
    assert.equal(client.getEtherBalance(sponsor1), await web3.eth.getBalance(sponsor1));

    // After Sending ether the balance should update accordingly.
    await web3.eth.sendTransaction({ from: tokenCreator, to: sponsor1, value: toWei("1") });
    await client._update();
    assert.equal(client.getCollateralBalance(sponsor1), toWei("1234"));
    assert.equal(client.getSyntheticBalance(sponsor1), 0);
    assert.equal(client.getEtherBalance(sponsor1), await web3.eth.getBalance(sponsor1));
  });
});

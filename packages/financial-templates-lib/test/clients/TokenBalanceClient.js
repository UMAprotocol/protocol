const { toWei } = web3.utils;
const winston = require("winston");

const { parseFixed } = require("@uma/common");

// Script to test
const { TokenBalanceClient } = require("../../src/clients/TokenBalanceClient");
const { getTruffleContract } = require("@uma/core");

const CONTRACT_VERSION = "latest";

// Truffle artifacts
const Token = getTruffleContract("ExpandedERC20", web3, CONTRACT_VERSION);

const configs = [
  { tokenName: "Wrapped Ether", tokenSymbol: "WETH", collateralDecimals: 18 },
  { tokenName: "Wrapped Bitcoin", tokenSymbol: "WBTC", collateralDecimals: 8 }
];

const Convert = decimals => number => parseFixed(number.toString(), decimals).toString();

contract("TokenBalanceClient.js", function(accounts) {
  for (let tokenConfig of configs) {
    describe(`${tokenConfig.collateralDecimals} decimals`, function() {
      const tokenCreator = accounts[0];
      const sponsor1 = accounts[1];
      const sponsor2 = accounts[2];
      const rando = accounts[3];

      // Test object for Financial Contract event client
      let client;

      // Contracts
      let collateralToken;
      let syntheticToken;

      // Shared convert function.
      let convert;

      before(async function() {
        convert = Convert(tokenConfig.collateralDecimals);
        // The TokenBalance Client is independent of the Financial Contract and simply needs two tokens to monitor.
        collateralToken = await Token.new(
          tokenConfig.tokenName,
          tokenConfig.tokenSymbol,
          tokenConfig.collateralDecimals,
          { from: tokenCreator }
        );
        await collateralToken.addMember(1, tokenCreator, { from: tokenCreator });
        syntheticToken = await Token.new("Test Synthetic Token", "SYNTH", 18, { from: tokenCreator });
        await syntheticToken.addMember(1, tokenCreator, { from: tokenCreator });
      });

      beforeEach(async function() {
        // The BalanceMonitor does not emit any info `level` events.  Therefore no need to test Winston outputs.
        // DummyLogger will not print anything to console as only capture `info` level events.
        const dummyLogger = winston.createLogger({
          level: "info",
          transports: [new winston.transports.Console()]
        });
        client = new TokenBalanceClient(dummyLogger, Token.abi, web3, collateralToken.address, syntheticToken.address);
      });

      it("Returning token balances", async function() {
        // Register wallets with TokenBalanceClient to enable them to be retrievable on the first query.
        client.batchRegisterAddresses([sponsor1, sponsor2]);

        // Update the client to pull the initial balances.
        await client.update();

        // Token balances should correctly pull on the first query.
        assert.equal(client.getCollateralBalance(sponsor1), 0);
        assert.equal(client.getSyntheticBalance(sponsor1), 0);
        assert.isTrue(client.resolvedAddressBalance(sponsor1));

        // After sending tokens to a wallet the client should update accordingly.
        await collateralToken.mint(sponsor1, convert("1234"), { from: tokenCreator });
        await client.update();
        assert.equal(client.getCollateralBalance(sponsor1), convert("1234"));
        assert.equal(client.getSyntheticBalance(sponsor1), 0);

        // Sending tokens to a wallet should be correctly updated on the first query.
        await syntheticToken.mint(sponsor2, toWei("5678"), { from: tokenCreator });
        await client.update();
        assert.equal(client.getCollateralBalance(sponsor2), 0);
        assert.equal(client.getSyntheticBalance(sponsor2), toWei("5678"));
        assert.equal(client.getEtherBalance(sponsor2), await web3.eth.getBalance(sponsor2));
        assert.isTrue(client.resolvedAddressBalance(sponsor2));

        // After multiple updates with no state changes the client should not update.
        await client.update();
        await client.update();
        await client.update();
        assert.equal(client.getCollateralBalance(sponsor1), convert("1234"));
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
        // Register wallets with TokenBalanceClient to enable them to be retrievable on the first query.
        client.batchRegisterAddresses([sponsor1, sponsor2]);

        // Update the client to pull the initial balances.
        await client.update();

        assert.equal(client.getEtherBalance(sponsor1), await web3.eth.getBalance(sponsor1));

        // After Sending ether the balance should update accordingly.
        await web3.eth.sendTransaction({ from: tokenCreator, to: sponsor1, value: toWei("1") });
        await client.update();
        assert.equal(client.getCollateralBalance(sponsor1), convert("1234"));
        assert.equal(client.getSyntheticBalance(sponsor1), 0);
        assert.equal(client.getEtherBalance(sponsor1), await web3.eth.getBalance(sponsor1));
      });
    });
  }
});

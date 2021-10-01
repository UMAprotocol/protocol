const { web3, getContract } = require("hardhat");
const { assert } = require("chai");

const { toWei } = web3.utils;
const winston = require("winston");

const { parseFixed, TEST_DECIMAL_COMBOS } = require("@uma/common");

// Script to test
const { TokenBalanceClient } = require("../../dist/clients/TokenBalanceClient");

// Truffle artifacts
const Token = getContract("ExpandedERC20", web3);

const Convert = (decimals) => (number) => parseFixed(number.toString(), decimals).toString();

describe("TokenBalanceClient.js", function () {
  let tokenCreator, sponsor1, sponsor2, rando, accounts;
  before(async function () {
    accounts = await web3.eth.getAccounts();
    [tokenCreator, sponsor1, sponsor2, rando] = accounts;
  });
  for (let tokenConfig of TEST_DECIMAL_COMBOS) {
    describe(`${tokenConfig.collateralDecimals} decimals`, function () {
      // Test object for Financial Contract event client
      let client;

      // Contracts
      let collateralToken;
      let syntheticToken;

      // Shared convert function.
      let convert;

      before(async function () {
        convert = Convert(tokenConfig.collateralDecimals);
        // The TokenBalance Client is independent of the Financial Contract and simply needs two tokens to monitor.
        collateralToken = await Token.new(
          tokenConfig.tokenName,
          tokenConfig.tokenSymbol,
          tokenConfig.collateralDecimals
        ).send({ from: tokenCreator });
        await collateralToken.methods.addMember(1, tokenCreator).send({ from: tokenCreator });
        syntheticToken = await Token.new("Test Synthetic Token", "SYNTH", 18).send({ from: tokenCreator });
        await syntheticToken.methods.addMember(1, tokenCreator).send({ from: tokenCreator });
      });

      beforeEach(async function () {
        // The BalanceMonitor does not emit any info `level` events.  Therefore no need to test Winston outputs.
        // DummyLogger will not print anything to console as only capture `info` level events.
        const dummyLogger = winston.createLogger({ level: "info", transports: [new winston.transports.Console()] });
        client = new TokenBalanceClient(
          dummyLogger,
          Token.abi,
          web3,
          collateralToken.options.address,
          syntheticToken.options.address
        );
      });

      it("Returning token balances", async function () {
        // Register wallets with TokenBalanceClient to enable them to be retrievable on the first query.
        client.batchRegisterAddresses([sponsor1, sponsor2]);

        // Update the client to pull the initial balances.
        await client.update();

        // Token balances should correctly pull on the first query.
        assert.equal(client.getCollateralBalance(sponsor1), 0);
        assert.equal(client.getSyntheticBalance(sponsor1), 0);
        assert.isTrue(client.resolvedAddressBalance(sponsor1));

        // After sending tokens to a wallet the client should update accordingly.
        await collateralToken.methods.mint(sponsor1, convert("1234")).send({ from: tokenCreator });
        await client.update();
        assert.equal(client.getCollateralBalance(sponsor1), convert("1234"));
        assert.equal(client.getSyntheticBalance(sponsor1), 0);

        // Sending tokens to a wallet should be correctly updated on the first query.
        await syntheticToken.methods.mint(sponsor2, toWei("5678")).send({ from: tokenCreator });
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

      it("Returning ETH balances", async function () {
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

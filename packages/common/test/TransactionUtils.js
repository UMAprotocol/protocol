// Script to test
const { web3, getContract } = require("hardhat");
const { assert } = require("chai");
const TransactionUtils = require("../dist/TransactionUtils");

const ERC20 = getContract("BasicERC20");
const { toWei } = web3.utils;

describe("TransactionUtils.js", function () {
  let accounts;
  before(async function () {
    accounts = await web3.eth.getAccounts();
  });
  describe("runTransaction", function () {
    it("sets error.type correctly", async function () {
      // `.call()` fails, error.type = "call"
      try {
        const erc20Contract = await ERC20.new("0").send({ from: accounts[0] });
        // Allowance is not set for accounts[0] so this should fail on .call()
        const transaction = erc20Contract.methods.transferFrom(accounts[0], accounts[1], "1");
        const transactionConfig = { from: accounts[0] };
        await TransactionUtils.runTransaction({ web3, transaction, transactionConfig });

        // Test should not get here because error should be thrown.
        assert.ok(false);
      } catch (error) {
        assert.equal(error.type, "call");
      }
    });
    it("scales maxFeePerGas by maxFeePerGasMultiplier, doubling by default", async function () {
      const erc20Contract = await ERC20.new("2").send({ from: accounts[0] });
      const gasFees = { maxFeePerGas: toWei("10", "gwei"), maxPriorityFeePerGas: toWei("1", "gwei") };

      const { transactionHash: doubledTxHash } = await TransactionUtils.runTransaction({
        web3,
        transaction: erc20Contract.methods.transfer(accounts[1], "1"),
        transactionConfig: { ...gasFees, from: accounts[0] },
      });
      const doubledTx = await web3.eth.getTransaction(doubledTxHash);
      assert.equal(doubledTx.maxFeePerGas.toString(), toWei("20", "gwei"));

      const { transactionHash: unscaledTxHash } = await TransactionUtils.runTransaction({
        web3,
        transaction: erc20Contract.methods.transfer(accounts[1], "1"),
        transactionConfig: { ...gasFees, from: accounts[0] },
        maxFeePerGasMultiplier: 1,
      });
      const unscaledTx = await web3.eth.getTransaction(unscaledTxHash);
      assert.equal(unscaledTx.maxFeePerGas.toString(), toWei("10", "gwei"));
    });
    // TODO: Figure out how to test situations where the `transaction.send()` fails but `.call()` does not
    it("waitForMine = false doesn't hang if transaction hash errors", async function () {
      const erc20Contract = await ERC20.new("1").send({ from: accounts[0] });
      // This transaction should be successful since the sender has 1 wei.
      const transaction = erc20Contract.methods.transfer(accounts[1], "1");

      // Should fail pre-transaction hash because gas prices cannot be negative.
      const transactionConfig = {
        from: accounts[0],
        maxFeePerGas: toWei("-1", "gwei"),
        maxPriorityFeePerGas: toWei("4", "gwei"),
      };

      assert.isTrue(
        await TransactionUtils.runTransaction({ web3, transaction, transactionConfig, waitForMine: false }).catch(
          () => true
        )
      );
    });
  });
});

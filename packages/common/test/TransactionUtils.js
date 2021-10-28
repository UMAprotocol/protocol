// Script to test
const { web3, getContract } = require("hardhat");
const { assert } = require("chai");
const TransactionUtils = require("../dist/TransactionUtils");

const ERC20 = getContract("BasicERC20");

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
    // TODO: Figure out how to test situations where the `transaction.send()` fails but `.call()` does not
  });
});

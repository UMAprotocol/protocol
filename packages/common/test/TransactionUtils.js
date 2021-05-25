// Script to test
const TransactionUtils = require("../src/TransactionUtils");
const { getTruffleContract, getAbi } = require("@uma/core");
const ERC20 = getTruffleContract("BasicERC20", web3);
const ERC20ABI = getAbi("BasicERC20");

contract("TransactionUtils.js", function (accounts) {
  describe("runTransaction", function () {
    it("sets error.type correctly", async function () {
      // `.call()` fails, error.type = "call"
      try {
        const erc20 = await ERC20.new("0");
        const erc20Contract = new web3.eth.Contract(ERC20ABI, erc20.address);
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

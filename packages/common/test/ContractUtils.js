// Script to test
const ContractUtils = require("../src/ContractUtils");
const { getTruffleContract, getAbi } = require("@uma/core");
const ERC20 = getTruffleContract("BasicERC20", web3, "latest");
const ERC20ABI = getAbi("BasicERC20", "latest");

contract("ContractUtils.js", function(accounts) {
  describe("runTransaction", function() {
    it("sets error.type correctly", async function() {
      // `.call()` fails, error.type = "call"
      try {
        const erc20 = await ERC20.new("0");
        const erc20Contract = new web3.eth.Contract(ERC20ABI, erc20.address);
        // Allowance is not set for accounts[0] so this should fail on .call()
        const transaction = erc20Contract.methods.transferFrom(accounts[0], accounts[1], "1");
        const config = {
          from: accounts[0]
        };
        await ContractUtils.runTransaction({ transaction, config });

        // Test should not get here because error should be thrown.
        assert.ok(false);
      } catch (error) {
        assert.equal(error.type, "call");
      }
    });
    // TODO: Figure out how to test situations where the `transaction.send()` fails but `.call()` does not
  });
});

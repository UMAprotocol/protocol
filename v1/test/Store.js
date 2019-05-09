const Store = artifacts.require("Store");

contract("Store", function(accounts) {
  // A deployed instance of the CentralizedStore contract, ready for testing.
  let store;

  const owner = accounts[0];
  const derivative = accounts[1];
  const erc20TokenOwner = accounts[2];

  beforeEach(async function() {
    store = await Store.new();
  });

  it("Compute fees", async function() {
    // Set a convenient fee for this test case of 10%.
    //const result = await store.setFixedOracleFeePerSecond(web3.utils.toWei("0.1", "ether"));

    //dummy test
    const result = await store.computeOracleFees("0","0","0", {from:owner});
    assert.equal(result.fee, 7);
    assert.equal(result.latePenalty, "0");
	});
});

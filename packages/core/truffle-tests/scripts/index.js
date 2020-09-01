const { getAbi, getAddress, getTruffleContract } = require("../../");

const Voting = artifacts.require("Voting");

describe("index.js", function() {
  it("Read Contract ABI", function() {
    assert.deepEqual(getAbi("Voting"), Voting.abi);
  });

  it("Read Contract Address", async function() {
    assert.equal(getAddress("Voting", await web3.eth.net.getId()), Voting.address);
  });

  it("Truffle contract", function() {
    assert.deepEqual(getTruffleContract("Voting"), Voting);
  });
});

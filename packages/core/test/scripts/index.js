const { getAbi, getAddress, getTruffleContract } = require("../../");

const Voting = artifacts.require("Voting");

contract("index.js", function() {
  it("Read Contract ABI", async function() {
    assert.deepEqual(getAbi("Voting"), Voting.abi);
  });

  it("Read Contract Address", async function() {
    assert.equal(getAddress("Voting", await web3.eth.net.getId()), (await Voting.deployed()).address);
  });

  it("Truffle contract", function() {
    // assert.deepEqual(getTruffleContract("Voting"), Voting);
  });
});

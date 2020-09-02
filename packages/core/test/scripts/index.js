const { getAbi, getAddress, getTruffleContract } = require("../../");

const Voting = artifacts.require("Voting");

contract("index.js", function() {
  it("Read Contract ABI", async function() {
    assert.deepEqual(getAbi("Voting"), Voting.abi);
  });

  it("Read Contract Address", async function() {
    console.log(getAddress);
    console.log(getAddress("Voting", await web3.eth.net.getId()));
    assert.equal(getAddress("Voting", await web3.eth.net.getId()), Voting.address);
  });

  it("Truffle contract", function() {
    assert.deepEqual(getTruffleContract("Voting"), Voting);
  });
});

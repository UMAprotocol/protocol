const { getAbi, getAddress, getTruffleContract } = require("../..");
const { assert } = require("chai");

const Voting = artifacts.require("Voting");

contract("index.js", function() {
  it("Read Contract ABI", async function() {
    assert.deepEqual(getAbi("Voting"), Voting.abi);

    // Bad contract name.
    assert.throws(() => getAbi("Nonsense"));
  });

  it("Read Contract Address", async function() {
    const networkId = await web3.eth.net.getId();
    assert.equal(getAddress("Voting", networkId), (await Voting.deployed()).address);

    // Bad network ID.
    assert.throws(() => getAddress("Voting", networkId + 1));

    // Bad contract name.
    assert.throws(() => getAddress("Nonsense", networkId));
  });

  it("Truffle contract", function() {
    // Cannot deepEqual the entire object as some of the getters cause the process to hang.
    assert.deepEqual(getTruffleContract("Voting").networks, Voting.networks);

    // Bad contract name.
    assert.throws(() => getTruffleContract("Nonsense"));
  });

  it("Legacy Contract Abis", function() {
    // Note: the "PositionManager" specifically existed in version 1.1.0.
    assert.isNotNull(getAbi("PositionManager", "1.1.0"));
    assert.isNotNull(getTruffleContract("PositionManager", undefined, "1.1.0"));

    // PerpetualPositionManager exists in the current version, but not in 1.1.0.
    assert.throws(() => getTruffleContract("PerpetualPositionManager", undefined, "1.1.0"));
    assert.throws(() => getAbi("PerpetualPositionManager", "1.1.0"));

    // Voting address should be available, as usual in this version.
    assert.isNotNull(getAddress("Voting", 1, "1.1.0"));
  });
});

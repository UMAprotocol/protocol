const { getAbi, getAddress, getTruffleContract } = require("../");
const Web3 = require("web3");
const assert = require("chai").assert;

describe("index.js", function() {
  it("Read Contract ABI", async function() {
    assert.isNotNull(getAbi("Voting"));

    // Bad contract name.
    assert.throws(() => getAbi("Nonsense"));
  });

  it("Read Contract Address", function() {
    assert.isNotNull(getAddress("Voting", 1));

    // Bad contract name.
    assert.throws(() => getAddress("Nonsense", 1));

    // Bad network.
    assert.isNull(getAddress("Voting", 41));
  });

  it("Get Truffle Contract", function() {
    // Note: it doesn't matter if there's a node to connect to here.
    // This will only cause problems afterwards.
    const injectedWeb3 = new Web3("http://127.0.0.1:8545");
    assert.isNotNull(getTruffleContract("Voting", injectedWeb3));

    // Bad contract name.
    assert.throws(() => getTruffleContract("Nonsense", injectedWeb3));
  });

  it("Get Truffle Contract Default web3", function() {
    // Should use a default web3 (connected to the default test network).
    assert.isNotNull(getTruffleContract("Voting"));

    // Bad contract name.
    assert.throws(() => getTruffleContract("Nonsense"));
  });
});

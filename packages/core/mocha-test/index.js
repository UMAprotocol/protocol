const { getAbi, getAddress, getTruffleContract } = require("../");
const Web3 = require("web3");
const assert = require("chai").assert;

describe("index.js", function() {
  it("Read Contract ABI", async function() {
    assert.isNotNull(getAbi("Voting"));
    assert.isNull(getAbi("Nonsense"));
  });

  it("Read Contract Address", function() {
    assert.isNotNull(getAddress("Voting", 1));
    assert.isNull(getAddress("Nonsense", 1));
    assert.isNull(getAddress("Voting", 41));
  });

  it("Get Truffle Contract", function() {
    // Note: it doesn't matter if there's a node to connect to here.
    const injectedWeb3 = new Web3("http://127.0.0.1:8545");
    assert.isNotNull(getTruffleContract("Voting", injectedWeb3));
    assert.isNull(getTruffleContract("Nonsense", injectedWeb3));
  });

  it("Get Truffle Contract Default web3", function() {
    // Should use a default web3 (connected to localhost).
    assert.isNotNull(getTruffleContract("Voting"));
    assert.isNull(getTruffleContract("Nonsense"));
  });
});

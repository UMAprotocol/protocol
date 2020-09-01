const { getAbi, getAddress, getTruffleContract } = require("../../");
const { assert } = require("chai");

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
    // const fakeWeb3 = {};
    // assert.isNotNull(getTruffleContract("Voting"), fakeWeb3);
    // assert.isNull(getTruffleContract("Nonsense"));
  });
});

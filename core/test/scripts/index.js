const { getAbi, getAddress, getArtifact } = require("../../");

describe("index.js", function() {
  it("Read Contract ABI", async function() {
    assert.isNotNull(getAbi("Voting"));
    assert.isNull(getAbi("Nonsense"));
  });

  it("Read Contract Address", function() {
    assert.isNotNull(getAddress("Voting", 1));
    assert.isNull(getAddress("Nonsense", 1));
  });

  it("Read Artifact", function() {
    assert.isNotNull(getArtifact("Voting"));
    assert.isNull(getArtifact("Nonsense"));
  });
});

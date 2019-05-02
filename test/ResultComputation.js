const { didContractThrow } = require("./utils/DidContractThrow.js");

const ResultComputationTest = artifacts.require("ResultComputationTest");

contract("ResultComputation", function(accounts) {
  it("Insertions", async function() {
    const resultComputation = await ResultComputationTest.new();

    // Insert into empty list, i.e., first vote.
    await resultComputation.wrapAddVote("100", 10);
    assert.equal(await resultComputation.wrapGetResolvedPrice(), "100");

    // Insert at tail of list, i.e., new vote is the largest so far.
    await resultComputation.wrapAddVote("200", 10);
    assert.equal(await resultComputation.wrapGetResolvedPrice(), "150");

    // Insert at head of non-empty list, i.e., new vote is the smallest so far.
    await resultComputation.wrapAddVote("50", 10);
    assert.equal(await resultComputation.wrapGetResolvedPrice(), "100");

    // Insert in between two nodes.
    await resultComputation.wrapAddVote("150", 10);
    assert.equal(await resultComputation.wrapGetResolvedPrice(), "125");

    // Join each of the other votes.
    await resultComputation.wrapAddVote("100", 10);
    await resultComputation.wrapAddVote("200", 10);
    await resultComputation.wrapAddVote("50", 10);
    await resultComputation.wrapAddVote("150", 10);

    assert.equal(await resultComputation.wrapGetResolvedPrice(), "125");
  });

  it("Median computations - one vote", async function() {
    const resultComputation = await ResultComputationTest.new();

    assert(await didContractThrow(resultComputation.wrapGetResolvedPrice()));

    await resultComputation.wrapAddVote("100", 10);
    assert.equal(await resultComputation.wrapGetResolvedPrice(), "100");

    await resultComputation.wrapAddVote("100", 20);
    assert.equal(await resultComputation.wrapGetResolvedPrice(), "100");
  });

  it("Median computations - in vote", async function() {
    const resultComputation = await ResultComputationTest.new();

    // Median is the head.
    await resultComputation.wrapAddVote("100", 100);
    await resultComputation.wrapAddVote("200", 90);
    assert.equal(await resultComputation.wrapGetResolvedPrice(), "100");

    // Median is the tail.
    await resultComputation.wrapAddVote("300", 200);
    assert.equal(await resultComputation.wrapGetResolvedPrice(), "300");

    // Median is an interior node.
    await resultComputation.wrapAddVote("400", 388);
    assert.equal(await resultComputation.wrapGetResolvedPrice(), "300");
  });

  it("Median computations - in between votes", async function() {
    const resultComputation = await ResultComputationTest.new();

    // Median is in between 100 and 200.
    await resultComputation.wrapAddVote("100", 100);
    await resultComputation.wrapAddVote("200", 100);
    assert.equal(await resultComputation.wrapGetResolvedPrice(), "150");

    // Median is in between 200 and 500.
    await resultComputation.wrapAddVote("500", 200);
    assert.equal(await resultComputation.wrapGetResolvedPrice(), "350");
  });
});

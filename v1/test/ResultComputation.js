const ResultComputationTest = artifacts.require("ResultComputationTest");

contract("ResultComputation", function(accounts) {
  it("Basic", async function() {
    const resultComputation = await ResultComputationTest.new();

    // Three arbitrary but distinct prices for this test case.
    const priceOne = web3.utils.toWei("10");
    const priceTwo = web3.utils.toWei("11");
    const priceThree = web3.utils.toWei("12");

    // No minimum vote threshold.
    const minVoteThreshold = web3.utils.toWei("0");

    await resultComputation.wrapAddVote(priceOne, web3.utils.toWei("5"));
    // Frequency table: priceOne->5. Cutoff: 2.5.
    let resolved = await resultComputation.wrapGetResolvedPrice(minVoteThreshold);
    assert.isTrue(resolved.isResolved);
    assert.equal(resolved.price, priceOne);

    await resultComputation.wrapAddVote(priceTwo, web3.utils.toWei("4"));
    // Frequency table: priceOne->5, priceTwo->4. Cutoff: 4.5.
    resolved = await resultComputation.wrapGetResolvedPrice(minVoteThreshold);
    assert.isTrue(resolved.isResolved);
    assert.equal(resolved.price, priceOne);

    await resultComputation.wrapAddVote(priceThree, web3.utils.toWei("4"));
    // Frequency table: priceOne->5, priceTwo->4, priceThree->4. Cutoff: 6.5.
    // No price has 6.5.
    resolved = await resultComputation.wrapGetResolvedPrice(minVoteThreshold);
    assert.isFalse(resolved.isResolved);

    await resultComputation.wrapAddVote(priceTwo, web3.utils.toWei("4"));
    // Frequency table: priceOne->5, priceTwo->8, priceThree->4. Cutoff: 8.5.
    // No price has 8.5.
    resolved = await resultComputation.wrapGetResolvedPrice(minVoteThreshold);
    assert.isFalse(resolved.isResolved);

    await resultComputation.wrapAddVote(priceTwo, web3.utils.toWei("4"));
    // Frequency table: priceOne->5, priceTwo->9.1, priceThree->4. Cutoff: 9.05.
    resolved = await resultComputation.wrapGetResolvedPrice(minVoteThreshold);
    assert.isTrue(resolved.isResolved);
    assert.equal(resolved.price, priceTwo);
  });

  it("Zero price", async function() {
    const resultComputation = await ResultComputationTest.new();

    // No minimum vote threshold.
    const minVoteThreshold = web3.utils.toWei("0");

    // Unresolved if no votes have been submitted.
    let resolved = await resultComputation.wrapGetResolvedPrice(minVoteThreshold);
    assert.isFalse(resolved.isResolved);

    const zeroPrice = web3.utils.toWei("0");
    // Make sure zero prices can still work and can be distinguished from no votes.
    await resultComputation.wrapAddVote(zeroPrice, web3.utils.toWei("5"));
    resolved = await resultComputation.wrapGetResolvedPrice(minVoteThreshold);
    assert.isTrue(resolved.isResolved);
    assert.equal(resolved.price, zeroPrice);
  });

  it("Min vote threshold", async function() {
    const resultComputation = await ResultComputationTest.new();

    const price = web3.utils.toWei("10");

    await resultComputation.wrapAddVote(price, web3.utils.toWei("5"));
    let resolved = await resultComputation.wrapGetResolvedPrice(web3.utils.toWei("4"));
    assert.isTrue(resolved.isResolved);

    resolved = await resultComputation.wrapGetResolvedPrice(web3.utils.toWei("6"));
    assert.isFalse(resolved.isResolved);
  });
});

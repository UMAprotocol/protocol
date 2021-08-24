const hre = require("hardhat");
const { getContract } = hre;
const { assert } = require("chai");
const ResultComputationTest = getContract("ResultComputationTest");

describe("ResultComputation", function () {
  let accounts;
  before(async () => {
    accounts = await web3.eth.getAccounts();
  });
  it("Basic", async function () {
    const resultComputation = await ResultComputationTest.new().send({ from: accounts[0] });

    // Three arbitrary but distinct prices for this test case.
    const priceOne = web3.utils.toWei("10");
    const priceTwo = web3.utils.toWei("11");
    const priceThree = web3.utils.toWei("12");

    // No minimum vote threshold.
    const minVoteThreshold = web3.utils.toWei("0");

    await resultComputation.methods.wrapAddVote(priceOne, web3.utils.toWei("5")).send({ from: accounts[0] });
    // Frequency table: priceOne->5. Cutoff: 2.5.
    let resolved = await resultComputation.methods.wrapGetResolvedPrice(minVoteThreshold).call();
    assert.isTrue(resolved.isResolved);
    assert.equal(resolved.price, priceOne);
    assert.isTrue(await resultComputation.methods.wrapWasVoteCorrect(web3.utils.soliditySha3(priceOne)).call());
    assert.isFalse(await resultComputation.methods.wrapWasVoteCorrect(web3.utils.soliditySha3(priceTwo)).call());
    assert.equal(await resultComputation.methods.wrapGetTotalCorrectlyVotedTokens().call(), web3.utils.toWei("5"));

    await resultComputation.methods.wrapAddVote(priceTwo, web3.utils.toWei("4")).send({ from: accounts[0] });
    // Frequency table: priceOne->5, priceTwo->4. Cutoff: 4.5.
    resolved = await resultComputation.methods.wrapGetResolvedPrice(minVoteThreshold).call();
    assert.isTrue(resolved.isResolved);
    assert.equal(resolved.price, priceOne);
    assert.isTrue(await resultComputation.methods.wrapWasVoteCorrect(web3.utils.soliditySha3(priceOne)).call());
    assert.isFalse(await resultComputation.methods.wrapWasVoteCorrect(web3.utils.soliditySha3(priceTwo)).call());
    assert.equal(await resultComputation.methods.wrapGetTotalCorrectlyVotedTokens().call(), web3.utils.toWei("5"));

    await resultComputation.methods.wrapAddVote(priceThree, web3.utils.toWei("4")).send({ from: accounts[0] });
    // Frequency table: priceOne->5, priceTwo->4, priceThree->4. Cutoff: 6.5.
    // No price has 6.5.
    resolved = await resultComputation.methods.wrapGetResolvedPrice(minVoteThreshold).call();
    assert.isFalse(resolved.isResolved);

    await resultComputation.methods.wrapAddVote(priceTwo, web3.utils.toWei("4")).send({ from: accounts[0] });
    // Frequency table: priceOne->5, priceTwo->8, priceThree->4. Cutoff: 8.5.
    // No price has 8.5.
    resolved = await resultComputation.methods.wrapGetResolvedPrice(minVoteThreshold).call();
    assert.isFalse(resolved.isResolved);

    await resultComputation.methods.wrapAddVote(priceTwo, web3.utils.toWei("1.1")).send({ from: accounts[0] });
    // Frequency table: priceOne->5, priceTwo->9.1, priceThree->4. Cutoff: 9.05.
    resolved = await resultComputation.methods.wrapGetResolvedPrice(minVoteThreshold).call();
    assert.isTrue(resolved.isResolved);
    assert.equal(resolved.price, priceTwo);
    assert.isFalse(await resultComputation.methods.wrapWasVoteCorrect(web3.utils.soliditySha3(priceOne)).call());
    assert.isTrue(await resultComputation.methods.wrapWasVoteCorrect(web3.utils.soliditySha3(priceTwo)).call());
    assert.equal(
      (await resultComputation.methods.wrapGetTotalCorrectlyVotedTokens().call()).toString(),
      web3.utils.toWei("9.1")
    );
  });

  it("Zero price", async function () {
    const resultComputation = await ResultComputationTest.new().send({ from: accounts[0] });

    // No minimum vote threshold.
    const minVoteThreshold = web3.utils.toWei("0");

    // Unresolved if no votes have been submitted.
    let resolved = await resultComputation.methods.wrapGetResolvedPrice(minVoteThreshold).call();
    assert.isFalse(resolved.isResolved);

    const zeroPrice = web3.utils.toWei("0");
    // Make sure zero prices can still work and can be distinguished from no votes.
    await resultComputation.methods.wrapAddVote(zeroPrice, web3.utils.toWei("5")).send({ from: accounts[0] });
    resolved = await resultComputation.methods.wrapGetResolvedPrice(minVoteThreshold).call();
    assert.isTrue(resolved.isResolved);
    assert.equal(resolved.price, zeroPrice);
    assert.isTrue(await resultComputation.methods.wrapWasVoteCorrect(web3.utils.soliditySha3(zeroPrice)).call());
    assert.isFalse(
      await resultComputation.methods.wrapWasVoteCorrect(web3.utils.soliditySha3(web3.utils.toWei("1"))).call()
    );
    assert.equal(
      (await resultComputation.methods.wrapGetTotalCorrectlyVotedTokens().call()).toString(),
      web3.utils.toWei("5")
    );
  });

  it("Min vote threshold", async function () {
    const resultComputation = await ResultComputationTest.new().send({ from: accounts[0] });

    // Arbitrary but distinct prices.
    const priceOne = web3.utils.toWei("10");
    const priceTwo = web3.utils.toWei("11");

    // A non-zero minimum vote threshold.
    const minVotes = web3.utils.toWei("5");

    // Price isn't resolved because minimum votes threshold isn't met, even though 100% of votes are for the median.
    await resultComputation.methods.wrapAddVote(priceOne, minVotes).send({ from: accounts[0] });
    let resolved = await resultComputation.methods.wrapGetResolvedPrice(minVotes).call();
    assert.isFalse(resolved.isResolved);

    // Minimum votes threshold is satisfied, but mode threshold isn't satisfied.
    await resultComputation.methods.wrapAddVote(priceTwo, minVotes).send({ from: accounts[0] });
    resolved = await resultComputation.methods.wrapGetResolvedPrice(minVotes).call();
    assert.isFalse(resolved.isResolved);

    // Both thresholds are satisfied.
    await resultComputation.methods.wrapAddVote(priceOne, minVotes).send({ from: accounts[0] });
    resolved = await resultComputation.methods.wrapGetResolvedPrice(minVotes).call();
    assert.isTrue(resolved.isResolved);
    assert.equal(resolved.price, priceOne);
    assert.isTrue(await resultComputation.methods.wrapWasVoteCorrect(web3.utils.soliditySha3(priceOne)).call());
    assert.isFalse(await resultComputation.methods.wrapWasVoteCorrect(web3.utils.soliditySha3(priceTwo)).call());
    assert.equal(
      (await resultComputation.methods.wrapGetTotalCorrectlyVotedTokens().call()).toString(),
      web3.utils.toWei("10")
    );
  });
});

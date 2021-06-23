const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract } = hre;
const { didContractThrow } = require("@uma/common");

const VoteTimingTest = getContract("VoteTimingTest");

contract("VoteTiming", function (accounts) {
  const COMMIT_PHASE = "0";
  const REVEAL_PHASE = "1";

  let voteTiming;

  beforeEach(async function () {
    await runDefaultFixture(hre);
    voteTiming = await VoteTimingTest.new("100").send({ from: accounts[0] });
  });
  it("Reject invalid init params", async function () {
    // Should not be able to create an instance of VoteTiming with 0 phase length.
    assert(await didContractThrow(VoteTimingTest.new("0")));
  });

  it("Phasing", async function () {
    // If time % 200 is between 0 and 99 (inclusive), the phase should be commit.
    assert.equal((await voteTiming.methods.wrapComputeCurrentPhase("50").call()).toString(), COMMIT_PHASE);
    assert.equal((await voteTiming.methods.wrapComputeCurrentPhase("1401").call()).toString(), COMMIT_PHASE);

    // If time % 200 is between 100 and 199 (inclusive), the phase should be reveal.
    assert.equal((await voteTiming.methods.wrapComputeCurrentPhase("100").call()).toString(), REVEAL_PHASE);
    assert.equal((await voteTiming.methods.wrapComputeCurrentPhase("17145").call()).toString(), REVEAL_PHASE);
  });

  it("Compute Round Id", async function () {
    const startTime = 1579202864;
    // Round Id is a function of the current time defined by floor(timestamp/phaseLength)
    const initialRoundId = (await voteTiming.methods.wrapComputeCurrentRoundId(startTime).call()).toNumber();
    assert.equal(initialRoundId, Math.floor(startTime / 200));

    // Incremented by +200 should result in the next Round Id
    assert.equal((await voteTiming.wrapComputeCurrentRoundId(startTime + 200)).toNumber(), initialRoundId + 1);

    // Incremented by +250 should result in the same round Id as +200 as it rounds down
    assert.equal((await voteTiming.wrapComputeCurrentRoundId(startTime + 250)).toNumber(), initialRoundId + 1);
  });
});

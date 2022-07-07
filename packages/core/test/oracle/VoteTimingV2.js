const hre = require("hardhat");
const { getContract } = hre;
const { didContractThrow } = require("@uma/common");
const { assert } = require("chai");

const VoteTimingV2Test = getContract("VoteTimingV2Test");

describe("VoteTimingV2", function () {
  const COMMIT_PHASE = "0";
  const REVEAL_PHASE = "1";

  let voteTiming, accounts;

  let phaseLength = 100;
  let minRollToNextRoundLength = 20;

  before(async function () {
    accounts = await web3.eth.getAccounts();
  });
  beforeEach(async function () {
    voteTiming = await VoteTimingV2Test.new(phaseLength, minRollToNextRoundLength).send({ from: accounts[0] });
  });

  it("Reject invalid init params", async function () {
    // Should not be able to create an instance of VoteTiming with 0 phase length.
    assert(await didContractThrow(VoteTimingV2Test.new("0", minRollToNextRoundLength).send({ from: accounts[0] })));
    // MinRollToNextRound cant be bigger than the phase length.
    assert(await didContractThrow(VoteTimingV2Test.new(phaseLength, phaseLength + 1).send({ from: accounts[0] })));
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
    const initialRoundId = parseInt(await voteTiming.methods.wrapComputeCurrentRoundId(startTime).call());
    assert.equal(initialRoundId, Math.floor(startTime / 200));

    // Incremented by +200 should result in the next Round Id
    assert.equal(
      parseInt(await voteTiming.methods.wrapComputeCurrentRoundId(startTime + 200).call()),
      initialRoundId + 1
    );

    // Incremented by +250 should result in the same round Id as +200 as it rounds down
    assert.equal(
      parseInt(await voteTiming.methods.wrapComputeCurrentRoundId(startTime + 250).call()),
      initialRoundId + 1
    );
  });
  it("Compute Round Id to vote on request", async function () {
    const startTime = 1579202864;
    // Round Id is a function of the current time defined by floor(timestamp/phaseLength)
    const initialRoundId = parseInt(await voteTiming.methods.wrapComputeCurrentRoundId(startTime).call());
    assert.equal(initialRoundId, Math.floor(startTime / 200));

    // Incremented by +200 should result in the next Round Id
    assert.equal(
      parseInt(await voteTiming.methods.wrapComputeCurrentRoundId(startTime + 200).call()),
      initialRoundId + 1
    );

    // Incremented by +250 should result in the same round Id as +200 as it rounds down
    assert.equal(
      parseInt(await voteTiming.methods.wrapComputeCurrentRoundId(startTime + 250).call()),
      initialRoundId + 1
    );
  });
  it("Compute Round end time", async function () {
    const startTime = 1579202800;
    // Round Id is a function of the current time defined by floor(timestamp/phaseLength)
    const initialRoundId = parseInt(await voteTiming.methods.wrapComputeCurrentRoundId(startTime).call());

    // The round end time should be the start time + 2x the phase length.
    assert.equal(parseInt(await voteTiming.methods.wrapComputeRoundEndTime(initialRoundId).call()), startTime + 200);

    // The subsequent round end time should be 4x the phase length after the start time.
    assert.equal(
      parseInt(await voteTiming.methods.wrapComputeRoundEndTime(initialRoundId + 1).call()),
      startTime + 400
    );
  });
  it("Compute Round Id to vote on request", async function () {
    const startTime = 1579202800;
    // Round Id is a function of the current time defined by floor(timestamp/phaseLength)
    const initialRoundId = parseInt(await voteTiming.methods.wrapComputeCurrentRoundId(startTime).call());
    assert.equal(initialRoundId, Math.floor(startTime / 200));

    // At the start time we should expect the vote to happen in exactly the following round.
    assert.equal(
      parseInt(await voteTiming.methods.wrapComputeRoundToVoteOnPriceRequest(startTime).call()),
      initialRoundId + 1
    );

    // We know that the round end time is 200 seconds after the start time (2x the phase length). If we go to startTime
    // + 200 seconds - minRollToNextRoundLength then we should be voting in initialRound+2 (the vote rolls into the
    // next round). If we are are at start time +200 -1 then we should still be in the subsequent round (no roll).

    // Right on the edge margin of the minRollToNextRoundLength should roll into the round after next.
    assert.equal(
      parseInt(
        await voteTiming.methods.wrapComputeRoundToVoteOnPriceRequest(startTime + 200 - minRollToNextRoundLength).call()
      ),
      initialRoundId + 2
    );

    // One second into the minRollToNextRoundLength should roll into the round after next.
    assert.equal(
      parseInt(
        await voteTiming.methods
          .wrapComputeRoundToVoteOnPriceRequest(startTime + 200 - minRollToNextRoundLength + 1)
          .call()
      ),
      initialRoundId + 2
    );

    // One second before the minRollToNextRoundLength should place vote in the following round.
    assert.equal(
      parseInt(
        await voteTiming.methods
          .wrapComputeRoundToVoteOnPriceRequest(startTime + 200 - minRollToNextRoundLength - 1)
          .call()
      ),
      initialRoundId + 1
    );
  });
});

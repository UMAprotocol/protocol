const { didContractThrow } = require("../../common/SolidityTestUtils.js");

const VoteTimingTest = artifacts.require("VoteTimingTest");

contract("VoteTiming", function(accounts) {
  let votingTiming;

  const COMMIT_PHASE = "0";
  const REVEAL_PHASE = "1";

  beforeEach(async function() {
    voteTiming = await VoteTimingTest.new("100");
  });

  it("Phasing", async function() {
    // If time % 200 is between 0 and 99 (inclusive), the phase should be commit.
    assert.equal((await voteTiming.wrapComputeCurrentPhase("50")).toString(), COMMIT_PHASE);
    assert.equal((await voteTiming.wrapComputeCurrentPhase("1401")).toString(), COMMIT_PHASE);

    // If time % 200 is between 100 and 199 (inclusive), the phase should be reveal.
    assert.equal((await voteTiming.wrapComputeCurrentPhase("100")).toString(), REVEAL_PHASE);
    assert.equal((await voteTiming.wrapComputeCurrentPhase("17145")).toString(), REVEAL_PHASE);
  });

  it("Should Update", async function() {
    const startTime = (await voteTiming.voteTiming()).roundStartTime.toNumber();

    // If the new time is 200+ larger than startTime, the method should return true.
    assert.isTrue(await voteTiming.wrapShouldUpdateRoundId(startTime + 200));
    assert.isTrue(await voteTiming.wrapShouldUpdateRoundId(startTime + 1000050));

    // If the new time is less than 200 larger than startTime, the method should return false.
    assert.isFalse(await voteTiming.wrapShouldUpdateRoundId(startTime));
    assert.isFalse(await voteTiming.wrapShouldUpdateRoundId(startTime + 50));
    assert.isFalse(await voteTiming.wrapShouldUpdateRoundId(startTime + 199));
  });

  it("Compute New Round Id", async function() {
    const currentRoundId = (await voteTiming.wrapGetLastUpdatedRoundId()).toNumber();
    const startTime = (await voteTiming.voteTiming()).roundStartTime.toNumber();

    // If the new time is 200+ larger than startTime, the method should return a round id that is incremented.
    assert.equal((await voteTiming.wrapComputeCurrentRoundId(startTime + 200)).toNumber(), currentRoundId + 1);
    assert.equal((await voteTiming.wrapComputeCurrentRoundId(startTime + 1000050)).toNumber(), currentRoundId + 1);

    // If the new time is less than 200 larger than startTime, the method should return the currentRoundId.
    assert.equal((await voteTiming.wrapComputeCurrentRoundId(startTime)).toNumber(), currentRoundId);
    assert.equal((await voteTiming.wrapComputeCurrentRoundId(startTime + 50)).toNumber(), currentRoundId);
    assert.equal((await voteTiming.wrapComputeCurrentRoundId(startTime + 199)).toNumber(), currentRoundId);
  });

  it("Update Round Id", async function() {
    const initialRoundId = (await voteTiming.wrapGetLastUpdatedRoundId()).toNumber();
    const initialStartTime = (await voteTiming.voteTiming()).roundStartTime.toNumber();

    // If the new time is 200+ larger than startTime, the method should increment the roundId.
    await voteTiming.wrapUpdateRoundId(initialStartTime + 5060);

    // Grab the updated round id and start time.
    const updatedRoundId = (await voteTiming.wrapGetLastUpdatedRoundId()).toNumber();
    const updatedStartTime = (await voteTiming.voteTiming()).roundStartTime.toNumber();

    // The updated round id should be incremented by 1.
    assert.equal(updatedRoundId, initialRoundId + 1);

    // The updated start time should be the provided start time floored to the nearest 200.
    assert.equal(updatedStartTime, initialStartTime + 5000);

    // If the time doesn't change, the round id and start time should not change.
    await voteTiming.wrapUpdateRoundId(updatedStartTime);
    assert.equal((await voteTiming.wrapGetLastUpdatedRoundId()).toNumber(), updatedRoundId);
    assert.equal((await voteTiming.voteTiming()).roundStartTime.toNumber(), updatedStartTime);

    // If the time moves forward by less than 200, the round id and time should not change.
    await voteTiming.wrapUpdateRoundId(updatedStartTime + 199);
    assert.equal((await voteTiming.wrapGetLastUpdatedRoundId()).toNumber(), updatedRoundId);
    assert.equal((await voteTiming.voteTiming()).roundStartTime.toNumber(), updatedStartTime);

    // If time goes backwards the round id and start time should not change.
    await voteTiming.wrapUpdateRoundId(updatedStartTime - 1000);
    assert.equal((await voteTiming.wrapGetLastUpdatedRoundId()).toNumber(), updatedRoundId);
    assert.equal((await voteTiming.voteTiming()).roundStartTime.toNumber(), updatedStartTime);

    // If the time moves forward by exactly 200, the round id and start time should incrmement.
    await voteTiming.wrapUpdateRoundId(updatedStartTime + 200);
    assert.equal((await voteTiming.wrapGetLastUpdatedRoundId()).toNumber(), updatedRoundId + 1);
    assert.equal((await voteTiming.voteTiming()).roundStartTime.toNumber(), updatedStartTime + 200);
  });

  it("Estimated Round End Times", async function() {
    const roundId = (await voteTiming.wrapGetLastUpdatedRoundId()).toNumber();
    const startTime = (await voteTiming.voteTiming()).roundStartTime.toNumber();

    // The estimated end of the current round should be one round length in the future.
    assert.equal((await voteTiming.wrapComputeEstimatedRoundEndTime(roundId)).toNumber(), startTime + 200);

    // The estimated end of the next round should be two round lengths in the future.
    assert.equal((await voteTiming.wrapComputeEstimatedRoundEndTime(roundId + 1)).toNumber(), startTime + 400);

    // The estimated end of the round 50 rounds from now should be 51 round lengths in the future.
    assert.equal((await voteTiming.wrapComputeEstimatedRoundEndTime(roundId + 50)).toNumber(), startTime + 51 * 200);

    // Any rounds in the past should result in an error.
    assert(await didContractThrow(voteTiming.wrapComputeEstimatedRoundEndTime(roundId - 1)));
  });
});

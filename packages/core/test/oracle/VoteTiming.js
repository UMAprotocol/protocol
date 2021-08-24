const hre = require("hardhat");
const { getContract } = hre;
const { didContractThrow } = require("@uma/common");
const { assert } = require("chai");

const VoteTimingTest = getContract("VoteTimingTest");

describe("VoteTiming", function () {
  const COMMIT_PHASE = "0";
  const REVEAL_PHASE = "1";

  let voteTiming;
  let accounts;

  before(async function () {
    accounts = await web3.eth.getAccounts();
  });
  beforeEach(async function () {
    voteTiming = await VoteTimingTest.new("100").send({ from: accounts[0] });
  });

  it("Reject invalid init params", async function () {
    // Should not be able to create an instance of VoteTiming with 0 phase length.
    assert(await didContractThrow(VoteTimingTest.new("0").send({ from: accounts[0] })));
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
});

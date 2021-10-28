const Voting = artifacts.require("Voting");
const { moveToNextPhase } = require("../../utils/Voting.js");

// to advance to next commit phase
// call dvm (voting) getVotePhase
// commit phase is 0, revealphase is 1
const run = async function (callback) {
  const voting = await Voting.deployed();

  const startingPhase = await voting.getVotePhase();
  // we are in a commit phase. move to reveal, then move to next commit.
  if (startingPhase == 0) {
    // move to reveal
    await moveToNextPhase(voting);
  }
  // move to commit
  await moveToNextPhase(voting);
  const endingPhase = await voting.getVotePhase();

  console.log("Moved from phase", startingPhase.toString(), "to", endingPhase.toString());
  callback();
};

module.exports = run;

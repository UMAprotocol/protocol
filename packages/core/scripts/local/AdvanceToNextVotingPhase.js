const Voting = artifacts.require("Voting");
const { moveToNextPhase } = require("../../utils/Voting.js");

const run = async function(callback) {
  const voting = await Voting.deployed();

  const startingPhase = await voting.getVotePhase();
  await moveToNextPhase(voting);
  const endingPhase = await voting.getVotePhase();

  console.log("Moved from phase", startingPhase.toString(), "to", endingPhase.toString());
  callback();
};

module.exports = run;

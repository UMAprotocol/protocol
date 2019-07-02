const web3 = require("web3");

const { VotePhasesEnum } = require("../../common/Enums.js");

const secondsPerDay = web3.utils.toBN(86400);

// Moves the voting contract to the first phase of the next round.
async function moveToNextRound(voting) {
  const phase = await voting.getVotePhase();
  const currentTime = await voting.getCurrentTime();
  let timeIncrement;
  if (phase.toString() === VotePhasesEnum.COMMIT) {
    // Commit phase, so it will take 2 days to move to the next round.
    timeIncrement = secondsPerDay.muln(2);
  } else {
    // Reveal phase, so it will take 1 day to move to the next round.
    timeIncrement = secondsPerDay;
  }

  await voting.setCurrentTime(currentTime.add(timeIncrement));
}

// Moves the voting contract to the next phase.
async function moveToNextPhase(voting) {
  const currentTime = await voting.getCurrentTime();
  await voting.setCurrentTime(currentTime.add(secondsPerDay));
}

module.exports = {
  moveToNextRound,
  moveToNextPhase
};

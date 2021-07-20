const web3 = require("web3");

const { VotePhasesEnum } = require("@uma/common");

const { toBN } = web3.utils;
const secondsPerDay = web3.utils.toBN(86400);

// Moves the voting contract to the first phase of the next round.
async function moveToNextRound(voting, fromAddress) {
  // Temporary workaround for handling both web3 and truffle contract types.
  const isWeb3 = Boolean(voting.methods);
  const phase = isWeb3 ? await voting.methods.getVotePhase().call() : await voting.getVotePhase();
  const currentTime = toBN(
    (isWeb3 ? await voting.methods.getCurrentTime().call() : await voting.getCurrentTime()).toString()
  );
  let timeIncrement;
  if (phase.toString() === VotePhasesEnum.COMMIT) {
    // Commit phase, so it will take 2 days to move to the next round.
    timeIncrement = secondsPerDay.muln(2);
  } else {
    // Reveal phase, so it will take 1 day to move to the next round.
    timeIncrement = secondsPerDay;
  }

  isWeb3
    ? await voting.methods.setCurrentTime(currentTime.add(timeIncrement)).send({ from: fromAddress })
    : await voting.setCurrentTime(currentTime.add(timeIncrement));
}

// Moves the voting contract to the next phase.
async function moveToNextPhase(voting, fromAddress) {
  // Temporary workaround for handling both web3 and truffle contract types.
  const isWeb3 = Boolean(voting.methods);
  const currentTime = toBN(
    (isWeb3 ? await voting.methods.getCurrentTime().call() : await voting.getCurrentTime()).toString()
  );
  isWeb3
    ? await voting.methods.setCurrentTime(currentTime.add(secondsPerDay)).send({ from: fromAddress })
    : await voting.setCurrentTime(currentTime.add(secondsPerDay));
}

module.exports = { moveToNextRound, moveToNextPhase };

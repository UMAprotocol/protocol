const web3 = require("web3");
const hre = require("hardhat");

const { VotePhasesEnum } = require("@uma/common");

const { toBN } = web3.utils;
const secondsPerDay = web3.utils.toBN(86400);

const setCurrentTimeEvm = async (newTime) => {
  await hre.network.provider.send("evm_mine", [newTime]);
};

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

async function moveToNextRoundEvm(voting) {
  // Temporary workaround for handling both web3 and truffle contract types.
  const isWeb3 = Boolean(voting.methods);
  const phase = isWeb3 ? await voting.methods.getVotePhase().call() : await voting.getVotePhase();

  const currentTime = (await hre.ethers.provider.getBlock("latest")).timestamp;

  if (phase.toString() === VotePhasesEnum.COMMIT) {
    // Commit phase, so it will take 2 days to move to the next round.
    return setCurrentTimeEvm(currentTime + 2 * secondsPerDay.toNumber());
  } else {
    // Reveal phase, so it will take 1 day to move to the next round.
    return setCurrentTimeEvm(currentTime + secondsPerDay.toNumber());
  }
}

async function moveToNextPhaseEvm() {
  const currentTime = (await hre.ethers.provider.getBlock("latest")).timestamp;
  return setCurrentTimeEvm(currentTime + secondsPerDay.toNumber());
}

module.exports = { moveToNextRound, moveToNextPhase, moveToNextRoundEvm, moveToNextPhaseEvm, setCurrentTimeEvm };

const style = require("../textStyle");
const { VotePhasesEnum } = require("../../../../common/Enums");
const getDefaultAccount = require("../wallet/getDefaultAccount");
const filterRequests = require("./filterRequestsByRound");

module.exports = async (web3, artifacts) => {
  // TODO: Find a way not to have to require this artifacts twice, if that is even an inefficiency
  const Voting = artifacts.require("Voting");
  const voting = await Voting.deployed();

  style.spinnerReadingContracts.start();
  const pendingRequests = await voting.getPendingRequests();
  const roundId = await voting.getCurrentRoundId();
  const roundPhase = await voting.getVotePhase();
  const roundStats = await voting.rounds(roundId);
  const account = await getDefaultAccount(web3);
  style.spinnerReadingContracts.stop();

  // Filter requests according to round phase
  const filteredRequests = await filterRequests(pendingRequests, account, roundId, roundPhase, voting);

  console.group(`${style.bgMagenta(`\n** Your voting status **`)}`);
  console.log(`${style.bgMagenta(`- Current round ID`)}: ${roundId.toString()}`);
  console.log(
    `${style.bgMagenta(`- Current round phase`)}: ${
      roundPhase.toString() === VotePhasesEnum.COMMIT ? "Commit" : "Reveal"
    }`
  );
  // TODO: Display these as ordered table intuitvely
  console.log(
    `${style.bgMagenta(
      `- Pending ${roundPhase.toString() === VotePhasesEnum.COMMIT ? "price" : "reveal"} requests`
    )}: ${filteredRequests.length}`
  );
  console.log(`${style.bgMagenta(`- Round Inflation percentage`)}: ${roundStats.inflationRate.toString()}`);
  console.log(`${style.bgMagenta(`- Round GAT percentage`)}: ${roundStats.gatPercentage.toString()}`);
  console.log(`\n`);
  console.groupEnd();
};

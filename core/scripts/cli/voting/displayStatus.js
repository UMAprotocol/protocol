const style = require("../textStyle");
const { VotePhasesEnum } = require("../../../../common/Enums");
const getDefaultAccount = require("../wallet/getDefaultAccount");
const filterRequests = require("./filterRequestsByRound");

module.exports = async (web3, voting) => {
  style.spinnerReadingContracts.start();
  const pendingRequests = await voting.getPendingRequests();
  const roundId = await voting.getCurrentRoundId();
  const roundPhase = await voting.getVotePhase();
  const roundStats = await voting.rounds(roundId);
  const account = await getDefaultAccount(web3);
  const filteredRequests = await filterRequests(pendingRequests, account, roundId, roundPhase, voting);
  style.spinnerReadingContracts.stop();

  // If no reveals have taken place in the current vote phase, then
  // show the global inflation and GAT percentages. Otherwise,
  // show the round's inflation and GAT percentages.
  const _inflationRate = (roundStats.snapshotId.toString() === '0' ? (await voting.inflationRate()) : roundStats.inflationRate.toString())
  const _gatPercentage = (roundStats.snapshotId.toString() === '0' ? (await voting.gatPercentage()) : roundStats.gatPercentage.toString())
  const inflationRate = parseFloat(web3.utils.fromWei(_inflationRate))*100
  const gatPercentage = parseFloat(web3.utils.fromWei(_gatPercentage))*100


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
  console.log(`${style.bgMagenta(`- Round Inflation`)}: ${inflationRate.toString()} %`);
  console.log(`${style.bgMagenta(`- Round GAT`)}: ${gatPercentage.toString()} %`);
  console.log(`\n`);
  console.groupEnd();
};

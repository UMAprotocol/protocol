const style = require("../textStyle");
const { VotePhasesEnum } = require("../../../../common/Enums");
const getDefaultAccount = require("../wallet/getDefaultAccount");
const filterRequests = require("./filterRequestsByRound");
const votePhaseTime = require("./votePhaseTiming");
const getAvailableRewards = require("./getResolvedVotesByRoundId");

/**
 * Display information about the current voting round:
 * - Round ID
 * - Whether you are in the Commit or Reveal Phase
 * - Round Inflation and GAT
 * - The current contract's timestamp
 * - Time until the next phase and next round
 * - A table displaying all pending price requests, which will be pending commits or reveals depending on the stage
 * - Any resolved price requests that the user can retrieve rewards from
 *
 * @param {* Object} web3 Web3 provider
 * @param {* Object} voting deployed Voting.sol contract instance
 */
const displayVoteStatus = async (web3, voting) => {
  style.spinnerReadingContracts.start();
  const pendingRequests = await voting.getPendingRequests();
  const roundId = await voting.getCurrentRoundId();
  const roundPhase = await voting.getVotePhase();
  const roundStats = await voting.rounds(roundId);
  const currentTime = await voting.getCurrentTime();
  const account = await getDefaultAccount(web3);
  const filteredRequests = await filterRequests(pendingRequests, account, roundId, roundPhase, voting);
  const rewards = await getAvailableRewards(web3, voting, account);
  style.spinnerReadingContracts.stop();

  // If no reveals have taken place in the current vote phase, then
  // show the global inflation and GAT percentages. Otherwise,
  // show the round's inflation and GAT percentages.
  const _inflationRate =
    roundStats.snapshotId.toString() === "0" ? await voting.inflationRate() : roundStats.inflationRate.toString();
  const _gatPercentage =
    roundStats.snapshotId.toString() === "0" ? await voting.gatPercentage() : roundStats.gatPercentage.toString();
  const inflationRate = parseFloat(web3.utils.fromWei(_inflationRate)) * 100;
  const gatPercentage = parseFloat(web3.utils.fromWei(_gatPercentage)) * 100;

  // Compute time until next phase and round
  const { minutesInLastHour, hoursUntilNextPhase, hoursUntilNextRound } = votePhaseTime(currentTime, roundPhase);

  console.group(`${style.success(`\n** Your voting status **`)}`);
  console.log(`${style.success(`- Current round ID`)}: ${roundId.toString()}`);
  console.log(
    `${style.success(`- Current round phase`)}: ${
      roundPhase.toString() === VotePhasesEnum.COMMIT ? "Commit" : "Reveal"
    }`
  );
  console.log(`${style.success(`- Round Inflation`)}: ${inflationRate.toString()} %`);
  console.log(`${style.success(`- Round GAT`)}: ${gatPercentage.toString()} %`);
  console.log(`${style.success(`- Contract time`)}: ${style.formatSecondsToUtc(currentTime)}`);
  console.log(
    `${style.success(
      `- Time until ${roundPhase.toString() === VotePhasesEnum.COMMIT ? "Reveal" : "Commit"}`
    )} phase: ${hoursUntilNextPhase} hours, ${minutesInLastHour} minutes`
  );
  console.log(
    `${style.success(`- Time until next voting round`)}: ${hoursUntilNextRound} hours, ${minutesInLastHour} minutes`
  );

  // Display pending requests in a table
  console.log(
    `${style.success(`- Pending ${roundPhase.toString() === VotePhasesEnum.COMMIT ? "Price" : "Reveal"} Requests`)}:`
  );
  if (filteredRequests.length > 0) {
    const requestsTable = [];
    filteredRequests.forEach(request => {
      const identifierUtf8 = web3.utils.hexToUtf8(request.identifier);
      const timestampUtc = style.formatSecondsToUtc(parseInt(request.time));
      requestsTable.push({
        "Identifier": identifierUtf8,
        "Time": timestampUtc
      });
    });
    console.table(requestsTable);
  }

  // Display rewards to be retrieved in a table
  console.log(`${style.success(`- Voting Rewards Available`)}:`);
  if (rewards.roundIds.length > 0) {
    const rewardsTable = [];
    Object.keys(rewards.resolvedVotesByRoundId).forEach(roundId => {
      rewards.resolvedVotesByRoundId[roundId].forEach(_reward => {
        rewardsTable.push({
          "Round ID": _reward.roundId,
          "Name": _reward.name,
          "Reward Tokens": web3.utils.fromWei(_reward.potentialRewards)
        });
      });
    });
    console.table(rewardsTable);
  }

  console.log(`\n`);
  console.groupEnd();
};

module.exports = displayVoteStatus;

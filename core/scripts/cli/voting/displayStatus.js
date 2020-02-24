const style = require("../textStyle");
const { VotePhasesEnum } = require("../../../../common/Enums");
const getDefaultAccount = require("../wallet/getDefaultAccount");
const filterRequests = require("./filterRequestsByRound");
const votePhaseTime = require("./votePhaseTiming");
const getAvailableRewards = require("./getRewardsByRoundId");
const getResolvedPrices = require("./getResolvedVotesByRoundId");

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
const displayVoteStatus = async (web3, voting, designatedVoting) => {
  style.spinnerReadingContracts.start();
  const pendingRequests = await voting.getPendingRequests();
  const roundId = await voting.getCurrentRoundId();
  const roundPhase = (await voting.getVotePhase()).toString();
  // TODO: #901 Can't access Voting.rounds in latest deployed Contract https://etherscan.io/address/0xfe3c4f1ec9f5df918d42ef7ed3fba81cc0086c5f#readContract
  // const roundStats = await voting.rounds(roundId);
  const currentTime = await voting.getCurrentTime();
  // If the user is using the two key contract, then the account is the designated voting contract's address
  const account = designatedVoting ? designatedVoting.address : await getDefaultAccount(web3);
  const filteredRequests = await filterRequests(pendingRequests, account, roundId, roundPhase, voting);
  const resolvedPrices = await getResolvedPrices(web3, voting, account);
  const rewards = await getAvailableRewards(web3, voting, account);
  style.spinnerReadingContracts.stop();

  // TODO: #901 Can't access Voting.rounds in latest deployed Contract https://etherscan.io/address/0xfe3c4f1ec9f5df918d42ef7ed3fba81cc0086c5f#readContract
  // // If no reveals have taken place in the current vote phase, then
  // // show the global inflation and GAT percentages. Otherwise,
  // // show the round's inflation and GAT percentages.
  // const _inflationRate =
  //   roundStats.snapshotId.toString() === "0" ? await voting.inflationRate() : roundStats.inflationRate.toString();
  // const _gatPercentage =
  //   roundStats.snapshotId.toString() === "0" ? await voting.gatPercentage() : roundStats.gatPercentage.toString();
  // const inflationRate = parseFloat(web3.utils.fromWei(_inflationRate)) * 100;
  // const gatPercentage = parseFloat(web3.utils.fromWei(_gatPercentage)) * 100;

  // Compute time until next phase and round
  const { minutesInLastHour, hoursUntilNextPhase, hoursUntilNextRound } = votePhaseTime(currentTime, roundPhase);

  console.group(`${style.success("\n** Your voting status **")}`);
  if (designatedVoting) {
    console.log(`${style.success("- Voting by proxy with the two key contract @")}: ${designatedVoting.address}`);
  }
  console.log(`${style.success("- Current round ID")}: ${roundId.toString()}`);
  console.log(
    `${style.success("- Current round phase")}: ${
      roundPhase.toString() === VotePhasesEnum.COMMIT ? "Commit" : "Reveal"
    }`
  );
  // console.log(`${style.success(`- Round Inflation`)}: ${inflationRate.toString()} %`);
  // console.log(`${style.success(`- Round GAT`)}: ${gatPercentage.toString()} %`);
  console.log(`${style.success("- Contract time")}: ${style.formatSecondsToUtc(currentTime)}`);
  console.log(
    `${style.success(
      `- Time until ${roundPhase === VotePhasesEnum.COMMIT ? "Reveal" : "Commit"}`
    )} phase: ${hoursUntilNextPhase} hours, ${minutesInLastHour} minutes`
  );
  console.log(
    `${style.success("- Time until next voting round")}: ${hoursUntilNextRound} hours, ${minutesInLastHour} minutes`
  );

  // Display pending requests in a table
  console.log(`${style.success(`- Pending ${roundPhase === VotePhasesEnum.COMMIT ? "Price" : "Reveal"} Requests`)}:`);
  if (filteredRequests.length > 0) {
    const requestsTable = [];
    filteredRequests.forEach(request => {
      const identifierUtf8 = web3.utils.hexToUtf8(request.identifier);
      const timestampUtc = style.formatSecondsToUtc(parseInt(request.time));
      requestsTable.push({
        identifier: identifierUtf8,
        time: timestampUtc
      });
    });
    console.table(requestsTable);
  }

  // Display rewards to be retrieved in a table
  if (rewards) {
    console.log(`${style.success("- Voting Rewards Available")}:`);
    if (rewards.roundIds.length > 0) {
      const reducer = (accumulator, currentValue) => accumulator.concat(currentValue);
      const rewardsTable = Object.values(rewards.rewardsByRoundId)
        .reduce(reducer)
        .map(reward => {
          return {
            round_id: reward.roundId,
            name: reward.name,
            reward_tokens: web3.utils.fromWei(reward.potentialRewards)
          };
        });
      console.table(rewardsTable);
    }
  } else {
    console.log(`${style.warning("- Cannot display available voting rewards for Metamask users")}`);
  }

  // Display resolved prices that voter voted on
  if (resolvedPrices) {
    console.log(`${style.success("- Resolved Prices of Votes Participated In")}:`);
    if (Object.keys(resolvedPrices).length > 0) {
      const reducer = (accumulator, currentValue) => accumulator.concat(currentValue);
      const resolvedPricesTable = Object.values(resolvedPrices)
        .reduce(reducer)
        .map(resolution => {
          return {
            round_id: resolution.roundId,
            identifier: resolution.identifier,
            time: resolution.time,
            price: resolution.price
          };
        });
      console.table(resolvedPricesTable);
    }
  } else {
    console.log(`${style.warning("- Cannot display past vote results for Metamask users")}`);
  }

  console.log("\n");
  console.groupEnd();
};

module.exports = displayVoteStatus;

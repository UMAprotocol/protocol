const style = require("../textStyle");
const argv = require("minimist")(process.argv.slice());

/**
 * Given a list of revealed votes for a user, return
 * the filtered list of votes that have successfully resolved a price
 * mapped to their round ID's.
 *
 * Cross reference revealed votes with a list of already-retrieved
 * rewards by the user to remove duplicate retrievals.
 *
 * We can check which rewards have already been retrieved by calling (but not executing!) the
 * retrieveRewards() method and checking that the return value is greater than 0. This return value
 * is the number of rewards that can be retrieved. Moreover, if retrieveRewards() throws an error
 * then the price has not resolved yet.
 *
 * @param {* Object} web3 Web3 provider
 * @param {* Object} voting deployed Voting.sol contract instance
 * @param {* String} account Etheruem account of voter
 */
const getRewardsByRound = async (web3, votingContract, account) => {
  // TODO(#901): MetaMask provider sometimes has trouble reading past events
  if (argv.network === "metamask") {
    return;
  }

  // All rewards available must be tied to formerly revealed votes
  const revealedVotes = await votingContract.getPastEvents("VoteRevealed", {
    filter: { voter: account },
    fromBlock: 0
  });

  const rewardsByRoundId = {};

  for (let i = 0; i < revealedVotes.length; i++) {
    const identifier = revealedVotes[i].args.identifier.toString();
    const time = revealedVotes[i].args.time.toString();
    const roundId = revealedVotes[i].args.roundId.toString();

    try {
      const price = (await votingContract.getPrice(identifier, time)).toString();

      // If retrieveRewards returns 0, then the rewards have already been retrieved
      let potentialRewards = await votingContract.retrieveRewards.call(account, roundId, [{ identifier, time }], {
        from: account
      });
      potentialRewards = potentialRewards.toString();

      if (potentialRewards !== "0") {
        const resolvedVote = {
          price,
          name: `${web3.utils.hexToUtf8(identifier)} @ ${style.formatSecondsToUtc(time)}`,
          identifier,
          time,
          roundId,
          potentialRewards
        };

        // If this is a new roundId, begin a new array of resolved votes for the roundId
        if (!rewardsByRoundId[roundId]) {
          rewardsByRoundId[roundId] = [resolvedVote];
        } else {
          rewardsByRoundId[roundId].push(resolvedVote);
        }
      } else {
        // Account already retrieved this reward
        continue;
      }
    } catch (err) {
      // getPrice will throw if the vote has not resolved
      continue;
    }
  }

  // Create a mapping of round IDs to total rewards per round
  let roundIds = [];
  Object.keys(rewardsByRoundId).forEach(id => {
    let totalRewardsInRound = web3.utils.toBN(0);
    rewardsByRoundId[id].forEach(reward => {
      totalRewardsInRound.add(web3.utils.toBN(reward.potentialRewards));
    });
    roundIds.push({
      name: `ID: ${id}, rewards: ${web3.utils.fromWei(totalRewardsInRound)}`,
      value: id,
      totalRewardsInRound: totalRewardsInRound.toString()
    });
  });
  roundIds = roundIds.sort((a, b) => {
    return parseInt(a.id) - parseInt(a.id);
  });

  return { rewardsByRoundId, roundIds };
};

module.exports = getRewardsByRound;

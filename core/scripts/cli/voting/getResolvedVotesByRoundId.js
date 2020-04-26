const style = require("../textStyle");
const argv = require("minimist")(process.argv.slice());

/**
 * Return the list of votes (that the voter has participated in) that have successfully resolved a price
 * mapped to their round ID's.
 *
 * @param {* Object} web3 Web3 provider
 * @param {* Object} voting deployed Voting.sol contract instance
 * @param {* String} account Etheruem account of voter
 */
const getResolvedVotesByRound = async (web3, votingContract, account) => {
  // TODO(#901): MetaMask provider sometimes has trouble reading past events
  if (argv.network === "metamask") {
    return;
  }

  // First check list of votes revealed by user to determine which
  // price requests a user has voted on
  const revealedVotes = await votingContract.getPastEvents("VoteRevealed", {
    filter: { voter: account },
    fromBlock: 0
  });

  // Construct list of round ID's participated in by voter
  const roundIds = {};
  for (let i = 0; i < revealedVotes.length; i++) {
    const roundId = revealedVotes[i].args.roundId.toString();
    // If this is a new roundId, count it
    if (!roundIds[roundId]) {
      roundIds[roundId] = [];
    } else {
      continue;
    }
  }

  // Now filter resolved prices by the voter participation
  if (Object.keys(roundIds).length > 0) {
    const resolvedPrices = await votingContract.getPastEvents("PriceResolved", {
      filter: { roundId: Object.keys(roundIds) },
      fromBlock: 0
    });

    resolvedPrices.forEach(price => {
      const roundId = price.args.roundId;
      const resolvedPrice = {
        roundId: roundId.toString(),
        identifier: web3.utils.hexToUtf8(price.args.identifier),
        time: style.formatSecondsToUtc(price.args.time),
        price: web3.utils.fromWei(price.args.price)
      };
      roundIds[roundId].push(resolvedPrice);
    });
  }

  return roundIds;
};

module.exports = getResolvedVotesByRound;

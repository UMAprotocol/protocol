const { VotePhasesEnum, getLatestEvent, IDENTIFIER_BLACKLIST } = require("@uma/common");

/**
 * First, sorts all price requests chronologically from earliest to latest.
 *
 * Next, if the phase is a Commit phase, then return all sorted requests.
 * If the phase is a Reveal phase, then only return price requests that have yet to be revealed (i.e. you can only reveal a price request once).
 * Conversely, a commit can be redone as many times as the user wants in a round, therefore we should display them all to the user.
 *
 * @param {* Object} web3 Web3 provider
 * @param {* Object[] Array} allPendingRequests List of pending price requests => {identifier, time}
 * @param {* String} account Etheruem account of voter
 * @param {* String} roundId Round ID number
 * @param {* String} roundPhase 0 = Commit or 1 = Reveal
 * @param {* Object} votingContract deployed Voting.sol contract instance
 */
const filterRequestsByRound = async (web3, allPendingRequests, account, roundId, roundPhase, votingContract) => {
  let filteredRequests = [];
  if (allPendingRequests.length > 0) {
    // Only display non-blacklisted price requests (uniquely identifier by identifier name and timestamp)
    const pendingRequests = allPendingRequests.filter(req => {
      if (!IDENTIFIER_BLACKLIST[web3.utils.hexToUtf8(req.identifier)]) return true;
      else {
        if (!IDENTIFIER_BLACKLIST[web3.utils.hexToUtf8(req.identifier)].includes(req.time)) return true;
        else return false;
      }
    });

    if (pendingRequests.length > 0) {
      // Sort requests by timestamp requested
      const chronologicalPriceRequests = pendingRequests.sort((a, b) => {
        return parseInt(a.time) - parseInt(b.time);
      });

      // Depending on the round phase, determine which requests to display
      if (roundPhase.toString() === VotePhasesEnum.COMMIT) {
        // Display all requests during commit phase even if
        // user has already committed a vote, for they
        // might want to change it
        filteredRequests = chronologicalPriceRequests;
      } else {
        // Only display committed votes during the reveal phase (i.e.
        // if an EncryptedVote event exists for the identifier-timestamp)
        for (let i = 0; i < chronologicalPriceRequests.length; i++) {
          const request = chronologicalPriceRequests[i];
          const ev = await getLatestEvent("EncryptedVote", request, roundId, account, votingContract);
          if (ev !== null) {
            // Check for already revealed vote.
            const alreadyRevealedVote = await getLatestEvent("VoteRevealed", request, roundId, account, votingContract);
            if (!alreadyRevealedVote) {
              filteredRequests.push(request);
            }
          }
        }
      }
    }
  }
  return filteredRequests;
};

module.exports = filterRequestsByRound;

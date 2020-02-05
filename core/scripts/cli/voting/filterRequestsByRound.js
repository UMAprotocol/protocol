const { computeTopicHash } = require("../../../../common/EncryptionHelper");
const { VotePhasesEnum } = require("../../../../common/Enums");

module.exports = async (pendingRequests, account, roundId, roundPhase, votingContract) => {
  let filteredRequests = [];
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
      for (let i = 0; i < chronologicalPriceRequests.length; i++) {
        const request = chronologicalPriceRequests[i];
        filteredRequests.push({
          identifier: request.identifier,
          time: request.time
        });
      }
    } else {
      // Only display committed votes during the reveal phase (i.e.
      // if an encrypted message exists for the identifier-timestamp)
      for (let i = 0; i < chronologicalPriceRequests.length; i++) {
        const request = chronologicalPriceRequests[i];
        const topicHash = computeTopicHash(request, roundId);
        const encryptedCommit = await votingContract.getMessage(account, topicHash, { from: account });
        if (encryptedCommit) {
          filteredRequests.push({
            identifier: request.identifier,
            time: request.time
          });
        }
      }
    }
  } else {
    console.log(`There are no pending price requests`);
  }

  return filteredRequests;
};

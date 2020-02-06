const style = require("../textStyle");
const { BATCH_MAX_RETRIEVALS } = require("../../../../common/Constants");

module.exports = async (requests, roundId, votingContract, account) => {
  let successes = [];
  let batches = 0;
  for (let i = 0; i < requests.length; i += BATCH_MAX_RETRIEVALS) {
    const maxBatchSize = requests.slice(i, Math.min(i + BATCH_MAX_RETRIEVALS, requests.length));
    const pendingRequests = [];
    for (let j = 0; j < maxBatchSize.length; j++) {
      pendingRequests.push({
        identifier: maxBatchSize[j].identifier,
        time: maxBatchSize[j].time
      });
    }

    // Always call `retrieveRewards`, even if there's only one reward. Difference in gas cost is negligible.
    style.spinnerWritingContracts.start();
    const { receipt } = await votingContract.retrieveRewards(account, roundId, pendingRequests, { from: account });
    style.spinnerWritingContracts.stop();

    // Add the batch transaction hash to each reveal.
    maxBatchSize.forEach(retrieve => {
      retrieve.txnHash = receipt.transactionHash;
    });

    // Append any of new batch's commitments to running commitment list
    successes = successes.concat(maxBatchSize);
    batches += 1;
  }

  return {
    successes,
    batches
  };
};

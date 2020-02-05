const style = require("../textStyle");
const { BATCH_MAX_REVEALS } = require("../../../../common/Constants");

module.exports = async (newReveals, votingContract, account) => {
  let successes = [];
  let batches = 0;
  for (let k = 0; k < newReveals.length; k += BATCH_MAX_REVEALS) {
    const maxBatchSize = newReveals.slice(k, Math.min(k + BATCH_MAX_REVEALS, newReveals.length));

    // Always call `batchReveal`, even if there's only one reveal. Difference in gas cost is negligible.
    style.spinnerWritingContracts.start();
    const { receipt } = await votingContract.batchReveal(maxBatchSize, { from: account });
    style.spinnerWritingContracts.stop();

    // Add the batch transaction hash to each reveal.
    maxBatchSize.forEach(reveal => {
      reveal.txnHash = receipt.transactionHash;
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

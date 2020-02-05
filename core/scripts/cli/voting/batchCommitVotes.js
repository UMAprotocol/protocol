const style = require('../textStyle')
const { BATCH_MAX_COMMITS } = require('../../../../common/Constants')

module.exports = async (newCommitments, votingContract, account) => {
    let successes = []
    let batches = 0
    for (let k = 0; k < newCommitments.length; k += BATCH_MAX_COMMITS) {
        const maxBatchSize = newCommitments.slice(k, Math.min(k+BATCH_MAX_COMMITS, newCommitments.length));
        
        // Always call `batchCommit`, even if there's only one commitment. Difference in gas cost is negligible.
        style.spinnerWritingContracts.start();
        const { receipt } = await votingContract.batchCommit(
            maxBatchSize.map(commitment => {
            // This filters out the parts of the commitment that we don't need to send to solidity.
            // Note: this isn't strictly necessary since web3 will only encode variables that share names with properties in
            // the solidity struct.
            const { price, salt, ...rest } = commitment;
            return rest;
            }),
            { from: account }
        );
        style.spinnerWritingContracts.stop();

        // Add the batch transaction hash to each commitment.
        maxBatchSize.forEach(commitment => {
            commitment.txnHash = receipt.transactionHash;
        });

        // Append any of new batch's commitments to running commitment list
        successes = successes.concat(maxBatchSize);
        batches += 1;
    }

    return {
        successes,
        batches
    }
}
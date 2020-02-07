const { decryptMessage, encryptMessage, deriveKeyPairFromSignatureTruffle } = require("./Crypto");
const { getKeyGenMessage, computeTopicHash } = require("./EncryptionHelper");
const { BATCH_MAX_COMMITS, BATCH_MAX_RETRIEVALS, BATCH_MAX_REVEALS } = require("./Constants");

const constructCommitment = async (request, roundId, web3, price, account) => {
  const priceString = web3.utils.toWei(price.toString());
  const salt = web3.utils.toBN(web3.utils.randomHex(32));
  const hash = web3.utils.soliditySha3(priceString, salt);

  const vote = { price: priceString, salt };
  const { publicKey } = await deriveKeyPairFromSignatureTruffle(web3, getKeyGenMessage(roundId), account);
  const encryptedVote = await encryptMessage(publicKey, JSON.stringify(vote));

  return {
    identifier: request.identifier,
    time: request.time,
    hash,
    encryptedVote,
    price: priceString,
    salt
  };
};

const constructReveal = async (request, roundId, web3, account, votingContract) => {
  const topicHash = computeTopicHash(request, roundId);
  const encryptedCommit = await votingContract.getMessage(account, topicHash, { from: account });

  const { privateKey } = await deriveKeyPairFromSignatureTruffle(web3, getKeyGenMessage(roundId), account);
  const vote = JSON.parse(await decryptMessage(privateKey, encryptedCommit));

  return {
    identifier: request.identifier,
    time: request.time,
    price: vote.price.toString(),
    salt: web3.utils.hexToNumberString("0x" + vote.salt.toString())
  };
};

const batchCommitVotes = async (newCommitments, votingContract, account) => {
  let successes = [];
  let batches = 0;
  for (let k = 0; k < newCommitments.length; k += BATCH_MAX_COMMITS) {
    const maxBatchSize = newCommitments.slice(k, Math.min(k + BATCH_MAX_COMMITS, newCommitments.length));

    // Always call `batchCommit`, even if there's only one commitment. Difference in gas cost is negligible.
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
  };
};

const batchRevealVotes = async (newReveals, votingContract, account) => {
  let successes = [];
  let batches = 0;
  for (let k = 0; k < newReveals.length; k += BATCH_MAX_REVEALS) {
    const maxBatchSize = newReveals.slice(k, Math.min(k + BATCH_MAX_REVEALS, newReveals.length));

    // Always call `batchReveal`, even if there's only one reveal. Difference in gas cost is negligible.
    const { receipt } = await votingContract.batchReveal(maxBatchSize, { from: account });

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

const batchRetrieveRewards = async (requests, roundId, votingContract, account) => {
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
    const { receipt } = await votingContract.retrieveRewards(account, roundId, pendingRequests, { from: account });

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

module.exports = {
  constructCommitment,
  constructReveal,
  batchCommitVotes,
  batchRevealVotes,
  batchRetrieveRewards
};

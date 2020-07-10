const {
  decryptMessage,
  encryptMessage,
  deriveKeyPairFromSignatureTruffle,
  deriveKeyPairFromSignatureMetamask
} = require("./Crypto");
const { getKeyGenMessage, computeVoteHash } = require("./EncryptionHelper");
const { BATCH_MAX_COMMITS, BATCH_MAX_RETRIEVALS, BATCH_MAX_REVEALS } = require("./Constants");
const { getRandomUnsignedInt } = require("./Random.js");

const argv = require("minimist")(process.argv.slice());

const gasToSendTransactions = 600000;

/**
 * Generate a salt and use it to encrypt a committed vote in response to a price request
 * Return committed vote details to the voter.
 * @param {Object} request {identifier, time}
 * @param {String} roundId
 * @param {Object} web3
 * @param {String | Number | BN} price
 * @param {String} signingAccount
 * @param {String} votingAccount
 */
const constructCommitment = async (request, roundId, web3, price, signingAccount, votingAccount) => {
  const priceWei = web3.utils.toWei(price.toString());
  const salt = getRandomUnsignedInt().toString();
  const hash = computeVoteHash({
    price: priceWei,
    salt,
    account: votingAccount,
    time: request.time,
    roundId,
    identifier: request.identifier
  });

  const vote = { price: priceWei, salt };
  let publicKey;
  if (argv.network === "metamask") {
    publicKey = (await deriveKeyPairFromSignatureMetamask(web3, getKeyGenMessage(roundId), signingAccount)).publicKey;
  } else {
    publicKey = (await deriveKeyPairFromSignatureTruffle(web3, getKeyGenMessage(roundId), signingAccount)).publicKey;
  }
  const encryptedVote = await encryptMessage(publicKey, JSON.stringify(vote));

  return {
    identifier: request.identifier,
    time: request.time,
    hash,
    encryptedVote,
    price: priceWei,
    salt
  };
};

/**
 * Decrypt an encrypted vote commit for the voter and return vote details
 * @param {Object} request {identifier, time}
 * @param {String} roundId
 * @param {Object} web3
 * @param {String} signingAccount
 * @param {Object} votingContract deployed Voting.sol instance
 * @param {String} votingAccount
 */
const constructReveal = async (request, roundId, web3, signingAccount, votingContract, votingAccount) => {
  const encryptedCommit = (await getLatestEvent("EncryptedVote", request, roundId, votingAccount, votingContract))
    .encryptedVote;

  let privateKey;
  if (argv.network === "metamask") {
    privateKey = (await deriveKeyPairFromSignatureMetamask(web3, getKeyGenMessage(roundId), signingAccount)).privateKey;
  } else {
    privateKey = (await deriveKeyPairFromSignatureTruffle(web3, getKeyGenMessage(roundId), signingAccount)).privateKey;
  }
  const vote = JSON.parse(await decryptMessage(privateKey, encryptedCommit));

  return {
    identifier: request.identifier,
    time: request.time,
    price: vote.price.toString(),
    salt: vote.salt
  };
};

// Optimally batch together vote commits in the fewest batches possible,
// each batchCommit is one Ethereum transaction. Return the number of successes
// and batches to the user
const batchCommitVotes = async (newCommitments, votingContract, account) => {
  let successes = [];
  let batches = 0;
  for (let k = 0; k < newCommitments.length; k += BATCH_MAX_COMMITS) {
    const maxBatchSize = newCommitments.slice(k, Math.min(k + BATCH_MAX_COMMITS, newCommitments.length));

    // Always call `batchCommit`, even if there's only one commitment. Difference in gas cost is negligible.
    const { transactionHash } = await votingContract.methods
      .batchCommit(
        maxBatchSize.map(commitment => {
          // This filters out the parts of the commitment that we don't need to send to solidity.
          // Note: this isn't strictly necessary since web3 will only encode variables that share names with properties in
          // the solidity struct.
          const { price, salt, ...rest } = commitment;
          return rest;
        })
      )
      .send({ from: account, gas: gasToSendTransactions });
    // Add the batch transaction hash to each commitment.
    maxBatchSize.forEach(commitment => {
      commitment.txnHash = transactionHash;
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

// Optimally batch together vote reveals in the fewest batches possible,
// each batchReveal is one Ethereum transaction. Return the number of successes
// and batches to the user
const batchRevealVotes = async (newReveals, votingContract, account) => {
  let successes = [];
  let batches = 0;
  for (let k = 0; k < newReveals.length; k += BATCH_MAX_REVEALS) {
    const maxBatchSize = newReveals.slice(k, Math.min(k + BATCH_MAX_REVEALS, newReveals.length));

    // Always call `batchReveal`, even if there's only one reveal. Difference in gas cost is negligible.
    const { transactionHash } = await votingContract.methods
      .batchReveal(maxBatchSize)
      .send({ from: account, gas: gasToSendTransactions });

    // Add the batch transaction hash to each reveal.
    maxBatchSize.forEach(reveal => {
      reveal.txnHash = transactionHash;
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

// Optimally batch together reward retrievals in the fewest batches possible,
// each retrieveRewards is one Ethereum transaction. Return the number of successes
// and batches to the user
const batchRetrieveRewards = async (requests, roundId, votingContract, votingAccount, signingAccount) => {
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
    const { transactionHash } = await votingContract.methods
      .retrieveRewards(votingAccount, roundId, pendingRequests)
      .send({
        from: signingAccount,
        gas: gasToSendTransactions
      });

    // Add the batch transaction hash to each reveal.
    maxBatchSize.forEach(retrieve => {
      retrieve.txnHash = transactionHash;
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

// Get the latest event matching the provided parameters. Assumes that all events from Voting.sol have indexed
// parameters for identifier, roundId, and voter.
const getLatestEvent = async (eventName, request, roundId, account, votingContract) => {
  const events = await votingContract.getPastEvents(eventName, {
    fromBlock: 0,
    filter: { identifier: request.identifier, roundId: roundId.toString(), voter: account.toString() }
  });
  // Sort descending. Primary sort on block number. Secondary sort on transactionIndex. Tertiary sort on logIndex.
  events.sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) {
      return b.blockNumber - a.blockNumber;
    }

    if (a.transactionIndex !== b.transactionIndex) {
      return b.transactionIndex - a.transactionIndex;
    }

    return b.logIndex - a.logIndex;
  });
  for (const ev of events) {
    if (ev.returnValues.time.toString() === request.time.toString()) {
      return ev.returnValues;
    }
  }
  return null;
};

module.exports = {
  getLatestEvent,
  constructCommitment,
  constructReveal,
  batchCommitVotes,
  batchRevealVotes,
  batchRetrieveRewards
};

const { decryptMessage, encryptMessage, deriveKeyPairFromSignatureTruffle } = require("./Crypto");
const { getKeyGenMessage, computeTopicHash } = require("./EncryptionHelper");

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

module.exports = {
  constructCommitment,
  constructReveal
};

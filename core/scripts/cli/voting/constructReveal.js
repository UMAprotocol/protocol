const { decryptMessage, deriveKeyPairFromSignatureTruffle } = require("../../../../common/Crypto");
const { getKeyGenMessage, computeTopicHash } = require("../../../../common/EncryptionHelper");

module.exports = async (request, roundId, web3, account, votingContract) => {
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

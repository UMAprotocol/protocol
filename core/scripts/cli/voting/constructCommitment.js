const { encryptMessage, deriveKeyPairFromSignatureTruffle } = require("../../../../common/Crypto");
const { getKeyGenMessage } = require("../../../../common/EncryptionHelper");

module.exports = async (request, roundId, web3, price, account) => {
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

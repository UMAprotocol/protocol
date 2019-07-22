const EthCrypto = require("eth-crypto");

// Encrypts a message using an ethereum public key. To decrypt messages that are encrypted with this method, use
// decryptMessage().
async function encryptMessage(publicKey, message) {
  // substr(2) removes the web3 friendly "0x" from the public key.
  const encryptedMessageObject = await EthCrypto.encryptWithPublicKey(publicKey.substr(2), message);
  return "0x" + EthCrypto.cipher.stringify(encryptedMessageObject);
}

// Converts an ethereum public key to the corresponding address.
function addressFromPublicKey(publicKey) {
  // substr(2) just removes the web3 friendly "0x" from the public key.
  return EthCrypto.publicKey.toAddress(publicKey.substr(2));
}

// Recovers a public key from a private key.
function recoverPublicKey(privateKey) {
  // The "0x" is added to make the public key web3 friendly.
  return "0x" + EthCrypto.publicKeyByPrivateKey(privateKey);
}

// Decrypts a message that was encrypted using encryptMessage().
async function decryptMessage(privKey, encryptedMessage) {
  // substr(2) just removes the 0x at the beginning. parse() reverses the stringify() in encryptMessage().
  const encryptedMessageObject = EthCrypto.cipher.parse(encryptedMessage.substr(2));
  return await EthCrypto.decryptWithPrivateKey(privKey, encryptedMessageObject);
}

// Derives a private key from a signature.
async function deriveKeyPair(web3, signature) {
  const privateKey = web3.utils.soliditySha3(signature).substr(2);
  const publicKey = recoverPublicKey(privateKey);
  return { publicKey, privateKey };
}

// The methods to get signatures in MetaMask and Truffle are different and return slightly different results.
async function getMessageSignatureMetamask(web3, messageToSign, signingAccount) {
  return await web3.eth.personal.sign(messageToSign, signingAccount);
}

async function getMessageSignatureTruffle(web3, messageToSign, signingAccount) {
  const signature = await web3.eth.sign(messageToSign, signingAccount);
  // The 65 byte signature consists of r (first 32 bytes), s (next 32 bytes), and v (final byte). 65 bytes is
  // represented as 130 hex digits and the initial "0x". In order to produce a consistent signature with Metamask, we
  // have to adjust the v value.
  const rAndS = signature.substring(0, 128 + 2);
  const v = signature.substring(128 + 2, 132);
  if (v === "00") {
    return rAndS + "1b";
  } else {
    return rAndS + "1c";
  }
}

// The following two methods derive a private key from the signature of a particular message by a particular account.
// Note: this is not meant to be used to generate private keys that hold ETH or any other high value assets. This is
// meant to create a node/metamask friendly way of generating a temporary encryption/decryption key for sending private
// messages.

// Derive a private key, that works *only* on Metamask.
async function deriveKeyPairFromSignatureMetamask(web3, messageToSign, signingAccount) {
  return deriveKeyPair(web3, await getMessageSignatureMetamask(web3, messageToSign, signingAccount));
}

// Derive a private key, that works *only* with Truffle.
async function deriveKeyPairFromSignatureTruffle(web3, messageToSign, signingAccount) {
  return deriveKeyPair(web3, await getMessageSignatureTruffle(web3, messageToSign, signingAccount));
}

module.exports = {
  encryptMessage,
  addressFromPublicKey,
  decryptMessage,
  recoverPublicKey,
  deriveKeyPairFromSignatureTruffle,
  deriveKeyPairFromSignatureMetamask
};

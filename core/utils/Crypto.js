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

// Adds an account to web3 and returns all account "secrets" to the caller.
// Note: This is primarily of use when attempting to use a node that comes preloaded with unlocked accounts. Since
// there is no way for the user to access the private keys of these accounts over the node JSON-RPC api, the user must
// manually generate an account and add it for the private key to be accessible.
async function createVisibleAccount(web3) {
  const newAccount = web3.eth.accounts.create();
  const password = "password";
  await web3.eth.personal.importRawKey(newAccount.privateKey, password);
  if (!(await web3.eth.personal.unlockAccount(newAccount.address, password, 3600))) {
    throw "Account could not be unlocked";
  }

  return {
    privKey: newAccount.privateKey,
    pubKey: recoverPublicKey(newAccount.privateKey),
    address: newAccount.address
  };
}

module.exports = {
  encryptMessage,
  addressFromPublicKey,
  decryptMessage,
  recoverPublicKey,
  createVisibleAccount
};

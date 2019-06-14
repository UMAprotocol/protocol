const EthCrypto = require("eth-crypto");

// Note: all methods in this file assume a specific way of hashing messages before they are signed. This is designed
// for compatibility with both openzeppelin's ECDSA library and web3's signing and hashing methods.

// Signs a message in a way where it can be verified onchain by the openzeppelin ECDSA library.
async function signMessage(web3, account, message) {
    // Must hash the inner message because Solidity requires a fixed length message to verify a signature.
    const innerMessageHash = web3.utils.soliditySha3(message);

    // Construct a signature that will be accepted by openzeppelin.
    // See https://github.com/OpenZeppelin/openzeppelin-solidity/blob/1e584e495782ebdb5096fe65037d99dae1cbe940/contracts/cryptography/ECDSA.sol#L53
    // and https://medium.com/@yaoshiang/ethereums-ecrecover-openzeppelin-s-ecdsa-and-web3-s-sign-8ff8d16595e1 for details.
    const mutableSignature = await web3.eth.sign(innerMessageHash, account);
    const rs = mutableSignature.slice(0, 128+2);
    let v = mutableSignature.slice(128+2, 130+2);
    if (v == "00") {
      v = "1b"
    } else if (v == "01") {
      v = "1c"
    }
    return rs + v;
}

// Hashes a string method for verification of a signature.
function hashMessage(web3, message) {
    const innerMessageHash = web3.utils.soliditySha3(message);
    return web3.eth.accounts.hashMessage(innerMessageHash);
}

// Recovers an ethereum address from a signature that was used to sign a string message.
function recoverAddress(web3, signature, message) {
    const innerMessageHash = web3.utils.soliditySha3(message);
    return web3.eth.accounts.recover(innerMessageHash, signature);
}

// Recovers a public key from a signature that was used to sign a string message.
function recoverPublicKey(web3, signature, message) {
    const messageHash = hashMessage(web3, message);
    return EthCrypto.recoverPublicKey(signature, messageHash);
}

// Encrypts a message using an ethereum public key. To decrypt messages that are encrypted with this method, use
// decryptMessage().
async function encryptMessage(publicKey, message) {
    const encryptedMessageObject = await EthCrypto.encryptWithPublicKey(publicKey, message);
    return "0x" + EthCrypto.cipher.stringify(encryptedMessageObject);
}

// Converts an ethereum public key to the corresponding address.
function addressFromPublicKey(publickKey) {
    return EthCrypto.publicKey.toAddress(publicKey);
}

// Decrypts a message that was encrypted using encryptMessage().
async function decryptMessage(privKey, encryptedMessage) {
    // substr(2) just removes the 0x at the beginning. parse() reverses the stringify() in encryptMessage().
    const encryptedMessageObject = EthCrypto.cipher.parse(encryptedMessage.substr(2));
    return await EthCrypto.decryptWithPrivateKey(privKey, encryptedMessageObject);
}

// Directly encrypts a message with the public key obtained from a (signature, signedMessage) pair.
// To decrypt messages created with this method, use decryptMessage().
async function encryptMessageFromSignature(web3, signature, signedMessage, messageToEncrypt) {
    const publicKey = recoverPublicKey(web3, signature, signedMessage);
    return await encryptMessage(publicKey, messageToEncrypt);
}

module.exports = {
    signMessage,
    hashMessage,
    recoverPublicKey,
    encryptMessage,
    addressFromPublicKey,
    decryptMessage,
    recoverAddress,
    encryptMessageFromSignature
};
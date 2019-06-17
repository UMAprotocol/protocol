const EthCrypto = require("eth-crypto");

// Encrypts a message using an ethereum public key. To decrypt messages that are encrypted with this method, use
// decryptMessage().
async function encryptMessage(publicKey, message) {
    const encryptedMessageObject = await EthCrypto.encryptWithPublicKey(publicKey.substr(2), message);
    return "0x" + EthCrypto.cipher.stringify(encryptedMessageObject);
}

// Converts an ethereum public key to the corresponding address.
function addressFromPublicKey(publicKey) {
    return EthCrypto.publicKey.toAddress(publicKey.substr(2));
}

// Recovers a public key from a private key.
function recoverPublicKey(privateKey) {
    return "0x" + EthCrypto.publicKeyByPrivateKey(privateKey);
}

// Decrypts a message that was encrypted using encryptMessage().
async function decryptMessage(privKey, encryptedMessage) {
    // substr(2) just removes the 0x at the beginning. parse() reverses the stringify() in encryptMessage().
    const encryptedMessageObject = EthCrypto.cipher.parse(encryptedMessage.substr(2));
    return await EthCrypto.decryptWithPrivateKey(privKey, encryptedMessageObject);
}

module.exports = {
    encryptMessage,
    addressFromPublicKey,
    decryptMessage,
    recoverPublicKey
};

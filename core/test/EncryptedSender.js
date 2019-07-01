const { didContractThrow } = require("../../common/SolidityTestUtils.js");
const { getRandomSignedInt, getRandomUnsignedInt } = require("../utils/Random.js");
const {
  decryptMessage,
  encryptMessage,
  addressFromPublicKey,
  recoverPublicKey,
  deriveKeyPairFromSignature
} = require("../utils/Crypto.js");
const EthCrypto = require("eth-crypto");

const EncryptedSender = artifacts.require("EncryptedSender");

contract("EncryptedSender", function(accounts) {
  const senderAccount = accounts[0];
  const receiverAccount = accounts[1];

  before(async function() {
    encryptedSender = await EncryptedSender.deployed();
  });

  it("Encrypt Decrypt", async function() {
    const message = web3.utils.randomHex(100);
    const { publicKey, privateKey } = await deriveKeyPairFromSignature(web3, "Some message to sign", receiverAccount);
    const encryptedMessage = await encryptMessage(publicKey, message);
    assert.equal(await decryptMessage(privateKey, encryptedMessage), message);
  });

  it("Auth", async function() {
    const topicHash = web3.utils.soliditySha3("unauthorized");
    const encryptedmessage = web3.utils.randomHex(64);

    // No accounts should be authorized to start.
    assert.isFalse(await encryptedSender.isAuthorizedSender(senderAccount, receiverAccount));
    assert(
      await didContractThrow(
        encryptedSender.sendMessage(receiverAccount, topicHash, encryptedmessage, { from: senderAccount })
      )
    );

    // Recipient should always be able to send to themselves.
    assert.isTrue(await encryptedSender.isAuthorizedSender(receiverAccount, receiverAccount));
    await encryptedSender.sendMessage(receiverAccount, topicHash, encryptedmessage, { from: receiverAccount });

    // Once the sender is added, the message should send.
    await encryptedSender.addAuthorizedSender(senderAccount, { from: receiverAccount });
    assert.isTrue(await encryptedSender.isAuthorizedSender(senderAccount, receiverAccount));
    await encryptedSender.sendMessage(receiverAccount, topicHash, encryptedmessage, { from: senderAccount });

    // After the sender is removed, they should be unable to send a message.
    await encryptedSender.removeAuthorizedSender(senderAccount, { from: receiverAccount });
    assert.isFalse(await encryptedSender.isAuthorizedSender(senderAccount, receiverAccount));
    assert(
      await didContractThrow(
        encryptedSender.sendMessage(receiverAccount, topicHash, encryptedmessage, { from: senderAccount })
      )
    );
  });

  it("Send a message", async function() {
    // Hash topic for lookup.
    const identifier = web3.utils.utf8ToHex("identifier");
    const time = "1000";
    const topicHash = web3.utils.soliditySha3(identifier, time);

    // Derive the keypair for this topic hash.
    const { publicKey, privateKey } = await deriveKeyPairFromSignature(
      web3,
      "Signed message for topic hash: " + topicHash,
      receiverAccount
    );

    // Set the public key for the receiver.
    await encryptedSender.setPublicKey(publicKey, topicHash, { from: receiverAccount });

    // Verify the correct public key can be retrieved.
    assert.equal(await encryptedSender.getPublicKey(receiverAccount, topicHash), publicKey);

    // Prepare message to send.
    const salt = getRandomUnsignedInt().toString();
    const price = getRandomSignedInt().toString();
    const message = salt + "," + price;

    // Encrypt the message.
    const encryptedMessage = await encryptMessage(publicKey, message);

    // Authorize senderAccount to send messages to receiverAccount via the EncryptedSender.
    await encryptedSender.addAuthorizedSender(senderAccount, { from: receiverAccount });
    await encryptedSender.sendMessage(receiverAccount, topicHash, encryptedMessage, { from: senderAccount });

    // Pull down the encrypted message and decrypt it.
    const pulledMessage = await encryptedSender.getMessage(receiverAccount, topicHash);
    const decryptedMessage = await decryptMessage(privateKey, pulledMessage);

    // decryptedMessage should match the plaintext message from above.
    assert.equal(decryptedMessage, message);
  });
});

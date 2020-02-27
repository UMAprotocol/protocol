const { didContractThrow } = require("../../../common/SolidityTestUtils.js");
const { getRandomSignedInt, getRandomUnsignedInt } = require("../../../common/Random.js");
const { decryptMessage, encryptMessage, deriveKeyPairFromSignatureTruffle } = require("../../../common/Crypto.js");

const EncryptedStore = artifacts.require("EncryptedStore");

contract("EncryptedStore", function(accounts) {
  const senderAccount = accounts[0];
  const storeOwnerAccount = accounts[1];

  before(async function() {
    encryptedStore = await EncryptedStore.new();
  });

  it("Encrypt Decrypt", async function() {
    const message = web3.utils.randomHex(100);
    const { publicKey, privateKey } = await deriveKeyPairFromSignatureTruffle(
      web3,
      "Some message to sign",
      storeOwnerAccount
    );
    const encryptedMessage = await encryptMessage(publicKey, message);
    assert.equal(await decryptMessage(privateKey, encryptedMessage), message);
  });

  it("Auth", async function() {
    const topicHash = web3.utils.soliditySha3("unauthorized");
    const encryptedmessage = web3.utils.randomHex(64);

    // No accounts should be authorized to start.
    assert.isFalse(await encryptedStore.isAuthorizedSender(senderAccount, storeOwnerAccount));
    assert(
      await didContractThrow(
        encryptedStore.sendMessage(storeOwnerAccount, topicHash, encryptedmessage, { from: senderAccount })
      )
    );

    // Store owner should always be able to send to themselves.
    assert.isTrue(await encryptedStore.isAuthorizedSender(storeOwnerAccount, storeOwnerAccount));
    await encryptedStore.sendMessage(storeOwnerAccount, topicHash, encryptedmessage, { from: storeOwnerAccount });

    // Once the sender is added, the message should send.
    await encryptedStore.addAuthorizedSender(senderAccount, { from: storeOwnerAccount });
    assert.isTrue(await encryptedStore.isAuthorizedSender(senderAccount, storeOwnerAccount));
    await encryptedStore.sendMessage(storeOwnerAccount, topicHash, encryptedmessage, { from: senderAccount });

    // After the sender is removed, they should be unable to send a message.
    await encryptedStore.removeAuthorizedSender(senderAccount, { from: storeOwnerAccount });
    assert.isFalse(await encryptedStore.isAuthorizedSender(senderAccount, storeOwnerAccount));
    assert(
      await didContractThrow(
        encryptedStore.sendMessage(storeOwnerAccount, topicHash, encryptedmessage, { from: senderAccount })
      )
    );
  });

  it("Send a message", async function() {
    // Hash topic for lookup.
    const identifier = web3.utils.utf8ToHex("identifier");
    const time = "1000";
    const topicHash = web3.utils.soliditySha3(identifier, time);

    // Derive the keypair for this topic hash.
    const { publicKey, privateKey } = await deriveKeyPairFromSignatureTruffle(
      web3,
      "Signed message for topic hash: " + topicHash,
      storeOwnerAccount
    );

    // Prepare message to send.
    const salt = getRandomUnsignedInt().toString();
    const price = getRandomSignedInt().toString();
    const message = salt + "," + price;

    // Encrypt the message.
    const encryptedMessage = await encryptMessage(publicKey, message);

    // Authorize senderAccount to send messages to storeOwnerAccount.
    await encryptedStore.addAuthorizedSender(senderAccount, { from: storeOwnerAccount });
    await encryptedStore.sendMessage(storeOwnerAccount, topicHash, encryptedMessage, { from: senderAccount });

    // Pull down the encrypted message and decrypt it.
    const pulledMessage = await encryptedStore.getMessage(storeOwnerAccount, topicHash);
    const decryptedMessage = await decryptMessage(privateKey, pulledMessage);

    // decryptedMessage should match the plaintext message from above.
    assert.equal(decryptedMessage, message);
  });
});

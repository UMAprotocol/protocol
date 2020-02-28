const { didContractThrow } = require("../../../common/SolidityTestUtils.js");
const { getRandomSignedInt, getRandomUnsignedInt } = require("../../../common/Random.js");
const { decryptMessage, encryptMessage, deriveKeyPairFromSignatureTruffle } = require("../../../common/Crypto.js");

const EncryptedStore = artifacts.require("EncryptedStore");

contract("EncryptedStore", function(accounts) {
  const userAccount = accounts[0];
  const rando = accounts[1];

  before(async function() {
    encryptedStore = await EncryptedStore.new();
  });

  it("Encrypt Decrypt", async function() {
    const message = web3.utils.randomHex(100);
    const { publicKey, privateKey } = await deriveKeyPairFromSignatureTruffle(
      web3,
      "Some message to sign",
      senderAccount
    );
    const encryptedMessage = await encryptMessage(publicKey, message);
    assert.equal(await decryptMessage(privateKey, encryptedMessage), message);
  });

  it("Store a message", async function() {
    // Hash topic for lookup.
    const identifier = web3.utils.utf8ToHex("identifier");
    const time = "1000";
    const topicHash = web3.utils.soliditySha3(identifier, time);

    // Derive the keypair for this topic hash.
    const { publicKey, privateKey } = await deriveKeyPairFromSignatureTruffle(
      web3,
      "Signed message for topic hash: " + topicHash,
      senderAccount
    );

    // Prepare message to store.
    const salt = getRandomUnsignedInt().toString();
    const price = getRandomSignedInt().toString();
    const message = salt + "," + price;

    // Encrypt the message.
    const encryptedMessage = await encryptMessage(publicKey, message);

    // Store the message.
    await encryptedStore.storeMessage(topicHash, encryptedMessage, { from: senderAccount });

    // Pull down the encrypted message and decrypt it.
    const pulledMessage = await encryptedStore.getMessage(senderAccount, topicHash);
    const decryptedMessage = await decryptMessage(privateKey, pulledMessage);

    // decryptedMessage should match the plaintext message from above.
    assert.equal(decryptedMessage, message);
  });

  it("Remove a message", async function() {
    // Hash topic for lookup.
    const identifier = web3.utils.utf8ToHex("identifier");
    const time = "1000";
    const topicHash = web3.utils.soliditySha3(identifier, time);
    // Technically, the message can be any bytes data, encrypted or un-encrypted
    const message = identifier;

    // Send the message.
    await encryptedStore.storeMessage(topicHash, message, { from: senderAccount });
    let pulledMessage = await encryptedStore.getMessage(senderAccount, topicHash);
    assert.equal(pulledMessage, message);

    // User can remove their own message.
    await encryptedStore.removeMessage(topicHash, { from: senderAccount });
    pulledMessage = await encryptedStore.getMessage(senderAccount, topicHash);
    assert.equal(pulledMessage, null);

    // Removing a message when none exists does not throw and does nothing
    await encryptedStore.removeMessage(topicHash, { from: senderAccount });
    pulledMessage = await encryptedStore.getMessage(senderAccount, topicHash);
    assert.equal(pulledMessage, null);
  });
});

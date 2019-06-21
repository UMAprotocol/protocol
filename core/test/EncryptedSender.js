const { didContractThrow } = require("../../common/SolidityTestUtils.js");
const { getRandomSignedInt, getRandomUnsignedInt } = require("../utils/Random.js");
const { decryptMessage, encryptMessage, addressFromPublicKey, recoverPublicKey, createVisibleAccount } = require("../utils/Crypto.js");
const EthCrypto = require("eth-crypto");

const EncryptedSender = artifacts.require("EncryptedSender");

contract("EncryptedSender", function(accounts) {
  const senderAccount = accounts[0];

  // The receiving account is created in before().
  let receiverAccount;
  let receiverPrivKey;
  let receiverPubKey;

  let encryptedSender;

  before(async function() {
    encryptedSender = await EncryptedSender.deployed();

    ({ pubKey: receiverPubKey, privKey: receiverPrivKey, address: receiverAccount } = await createVisibleAccount(web3)); 

    // Fund the new account
    await web3.eth.sendTransaction({ from: accounts[9], to: receiverAccount, value: web3.utils.toWei("5", "ether") });
  });

  it("Encrypt Decrypt", async function() {
    const message = web3.utils.randomHex(100);
    const encryptedMessage = await encryptMessage(receiverPubKey, message);
    assert.equal(await decryptMessage(receiverPrivKey, encryptedMessage), message);
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

  it("Key validation", async function() {
    // Verify that the address can be correctly recovered offchain.
    assert.equal(addressFromPublicKey(receiverPubKey), receiverAccount);

    // If the valid key is sent by the wrong address, the call should fail.
    assert(await didContractThrow(encryptedSender.setPublicKey(receiverPubKey, { from: senderAccount })));

    // Valid key should succeed.
    await encryptedSender.setPublicKey(receiverPubKey, { from: receiverAccount });
  });

  it("Send a message", async function() {
    // // Set the public key for the receiver.
    await encryptedSender.setPublicKey(receiverPubKey, { from: receiverAccount });

    // Verify the correct public key can be retrieved.
    assert.equal(await encryptedSender.getPublicKey(receiverAccount), receiverPubKey);

    // Prepare message to send.
    const salt = getRandomUnsignedInt().toString();
    const price = getRandomSignedInt().toString();
    const message = salt + "," + price;

    // Encrypt the message.
    const encryptedMessage = await encryptMessage(receiverPubKey, message);

    // Hash topic for lookup.
    const identifier = web3.utils.utf8ToHex("identifier");
    const time = "1000";
    const topicHash = web3.utils.soliditySha3(identifier, time);

    // Authorize senderAccount to send messages to receiverAccount via the EncryptedSender.
    await encryptedSender.addAuthorizedSender(senderAccount, { from: receiverAccount });
    await encryptedSender.sendMessage(receiverAccount, topicHash, encryptedMessage, { from: senderAccount });

    // Pull down the encrypted message and decrypt it.
    const pulledMessage = await encryptedSender.getMessage(receiverAccount, topicHash);
    const decryptedMessage = await decryptMessage(receiverPrivKey, pulledMessage);

    // decryptedMessage should match the plaintext message from above.
    assert.equal(decryptedMessage, message);
  });
});

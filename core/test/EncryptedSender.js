const { didContractThrow } = require("../../common/SolidityTestUtils.js");
const { getRandomSignedInt, getRandomUnsignedInt } = require("../utils/Random.js");
const {
  signMessage,
  recoverAddress,
  recoverPublicKey,
  encryptMessage,
  decryptMessage,
  encryptMessageFromSignature
} = require("../utils/Crypto.js");
const EthCrypto = require("eth-crypto");

const EncryptedSender = artifacts.require("EncryptedSender");

contract("EncryptedSender", function(accounts) {
  const senderAccount = accounts[0];

  // The receiving account is created in before().
  let receiverAccount;
  let receiverPrivKey;

  let encryptedSender;

  const signatureMessage = "EncryptedSender";

  before(async function() {
    encryptedSender = await EncryptedSender.new();

    // Note: nodes don't appear to provide direct client access to pre-generated account's private keys, so to get
    // access, we must create an account and grab the private key before adding it to the wallet.
    const newAccount = web3.eth.accounts.create();
    receiverPrivKey = newAccount.privateKey;
    receiverAccount = newAccount.address;
    const password = "password";
    await web3.eth.personal.importRawKey(receiverPrivKey, password);
    assert.isTrue(await web3.eth.personal.unlockAccount(receiverAccount, password, 3600));

    // Fund the new account
    await web3.eth.sendTransaction({ from: accounts[9], to: receiverAccount, value: web3.utils.toWei("5", "ether") });
  });

  it("Auth", async function() {
    const topicHash = web3.utils.soliditySha3("unauthorized");
    const encryptedmessage = web3.utils.randomHex(64);

    // No accounts should be authorized to start.
    assert(
      await didContractThrow(
        encryptedSender.sendMessage(receiverAccount, topicHash, encryptedmessage, { from: senderAccount })
      )
    );

    // Once the sender is added, the message should send.
    await encryptedSender.addAuthorizedSender(senderAccount, { from: receiverAccount });
    await encryptedSender.sendMessage(receiverAccount, topicHash, encryptedmessage, { from: senderAccount });

    // After the sender is removed, they should be unable to send a message.
    await encryptedSender.removeAuthorizedSender(senderAccount, { from: receiverAccount });
    assert(
      await didContractThrow(
        encryptedSender.sendMessage(receiverAccount, topicHash, encryptedmessage, { from: senderAccount })
      )
    );
  });

  it("Signature validation", async function() {
    // Construct and send the expected signature to the EncryptedSender.
    const validSignature = await signMessage(web3, receiverAccount, signatureMessage);

    // If the valid signature is sent by the wrong address, the call should fail.
    assert(await didContractThrow(encryptedSender.setSignature(validSignature, { from: senderAccount })));

    // If the incorrect message is signed, the call should fail.
    const invalidMessageSignature = await signMessage(web3, receiverAccount, "InvalidMessage");
    assert(await didContractThrow(encryptedSender.setSignature(invalidMessageSignature, { from: senderAccount })));

    // Valid signature should succeed.
    await encryptedSender.setSignature(validSignature, { from: receiverAccount });
  });

  it("Send a message", async function() {
    // This is the standard signed message required by the contract.
    const standardSignedMessage = "EncryptedSender";

    // Construct and send the expected signature to the EncryptedSender.
    const signatureToSend = await signMessage(web3, receiverAccount, signatureMessage);
    await encryptedSender.setSignature(signatureToSend, { from: receiverAccount });

    // Verify the correct signature can be retrieved.
    const retrievedSignature = await encryptedSender.getSignature(receiverAccount);
    assert.equal(retrievedSignature, signatureToSend);

    // Verify that the correct address is recovered from the signature.
    const recoveredAddress = recoverAddress(web3, retrievedSignature, signatureMessage);
    assert.equal(recoveredAddress, receiverAccount);

    // Recover the public key from the signature.
    const recoveredPublicKey = recoverPublicKey(web3, retrievedSignature, signatureMessage);

    // Prepare message to send.
    const salt = getRandomUnsignedInt(web3).toString();
    const price = getRandomSignedInt(web3).toString();
    const messageToEncrypt = salt + "," + price;

    // Encrypt the message.
    const encryptedMessage = await encryptMessageFromSignature(
      web3,
      retrievedSignature,
      signatureMessage,
      messageToEncrypt
    );

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
    assert.equal(decryptedMessage, messageToEncrypt);
  });
});

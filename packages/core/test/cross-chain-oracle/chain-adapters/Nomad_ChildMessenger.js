const hre = require("hardhat");
const { web3, assertEventEmitted } = hre;
const { utf8ToHex, padLeft } = web3.utils;
const { getContract } = hre;
const { assert } = require("chai");

const { interfaceName, didContractThrow } = require("@uma/common");

const { deployContractMock } = require("../../helpers/SmockitHelper");

// Tested Contract
const Nomad_ChildMessenger = getContract("Nomad_ChildMessenger");

// Helper contracts
const Finder = getContract("Finder");
const parentChainDomain = 1000;

// Addresses are sent to the `Home.dispatch()` method in bytes32 encoding, so we need to convert them from checksum
// addresses to bytes32.
const addressToBytes32 = (addressString) => {
  return padLeft(addressString.toLowerCase(), 64);
};

describe("Nomad_ChildMessenger", function () {
  let nomad_ChildMessenger, finder, home, xAppConnectionManager;
  let l1Owner, parentMessenger, replica, rando, oracleSpoke;

  beforeEach(async () => {
    const accounts = await hre.web3.eth.getAccounts();
    [l1Owner, replica, parentMessenger, rando, oracleSpoke] = accounts;

    finder = await Finder.new().send({ from: l1Owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.ParentMessenger), parentMessenger)
      .send({ from: l1Owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.OracleSpoke), oracleSpoke)
      .send({ from: l1Owner });

    // Deploy mocked Nomad infrastructure contracts:
    home = await deployContractMock("HomeInterface", {}, getContract("HomeInterface"));
    xAppConnectionManager = await deployContractMock(
      "XAppConnectionManagerInterface",
      {},
      getContract("XAppConnectionManagerInterface")
    );
    xAppConnectionManager.smocked.home.will.return.with(() => home.options.address);
    xAppConnectionManager.smocked.isReplica.will.return.with(() => true);
    await finder.methods
      .changeImplementationAddress(
        utf8ToHex(interfaceName.XAppConnectionManager),
        xAppConnectionManager.options.address
      )
      .send({ from: l1Owner });

    nomad_ChildMessenger = await Nomad_ChildMessenger.new(finder.options.address, parentChainDomain).send({
      from: l1Owner,
    });
  });
  describe("Sending messages to parent", () => {
    it("Blocks calls from non privileged callers", async () => {
      // Only the oracleSpoke should be able to call this function. All other accounts should be blocked.
      const relayMessageTxn = nomad_ChildMessenger.methods.sendMessageToParent("0x1234");
      assert(await didContractThrow(relayMessageTxn.send({ from: rando })));
      assert.ok(await relayMessageTxn.send({ from: oracleSpoke }));
    });

    it("Correctly encodes and sends messages to parent", async () => {
      const message = "0x1234";
      const txn = await nomad_ChildMessenger.methods.sendMessageToParent(message).send({ from: oracleSpoke });

      // Check the message was sent to the Home contract and was encoded correctly.

      const smockedMessage = home.smocked.dispatch.calls;
      assert.equal(smockedMessage.length, 1); // there should be only one call
      assert.equal(smockedMessage[0]._destinationDomain, parentChainDomain);
      assert.equal(smockedMessage[0]._recipientAddress, addressToBytes32(parentMessenger));
      assert.equal(smockedMessage[0]._messageBody, message);

      await assertEventEmitted(txn, nomad_ChildMessenger, "MessageSentToParent", (ev) => {
        return (
          ev.data == message &&
          ev.targetHub == parentMessenger &&
          ev.parentChainDomain.toString() == parentChainDomain.toString() &&
          ev.oracleSpoke == oracleSpoke &&
          ev.parentMessenger == parentMessenger
        );
      });
    });
  });
  describe("Receiving messages from parent", () => {
    it("Caller must be Replica and cross chain sender must be ParentMessenger", async () => {
      const oracleSpokeSmocked = await deployContractMock("OracleSpoke", {}, getContract("OracleSpoke"));
      const dataToSendToSpoke = "0x1234";
      const messageToHandle = web3.eth.abi.encodeParameters(
        ["bytes", "address"],
        [dataToSendToSpoke, oracleSpokeSmocked.options.address]
      );
      const handleTxn = (sender) => {
        return nomad_ChildMessenger.methods.handle(parentChainDomain, addressToBytes32(sender), messageToHandle);
      };

      // Fails if `isReplica` returns false, so we'll set the smocked XAppConnectionManager to always return false for
      // this method.
      xAppConnectionManager.smocked.isReplica.will.return.with(() => false);
      assert(await didContractThrow(handleTxn(parentMessenger).send({ from: replica })));
      xAppConnectionManager.smocked.isReplica.will.return.with(() => true);

      // Sender must be parent messenger
      assert(await didContractThrow(handleTxn(rando).send({ from: replica })));
      const txn = await handleTxn(parentMessenger).send({ from: replica });

      // Check if data is sent correctly to target, which checks that `handle()` correctly decodes the message.
      const smockedMessage = oracleSpokeSmocked.smocked.processMessageFromParent.calls;
      assert.equal(smockedMessage.length, 1); // there should be only one call
      assert.equal(smockedMessage[0].data, dataToSendToSpoke);

      await assertEventEmitted(txn, nomad_ChildMessenger, "MessageReceivedFromParent", (ev) => {
        return (
          ev.dataToSendToTarget == dataToSendToSpoke &&
          ev.targetSpoke == oracleSpokeSmocked.options.address &&
          ev.sourceSender == parentMessenger &&
          ev.sourceDomain.toString() == parentChainDomain
        );
      });
    });
  });
});

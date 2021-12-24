const hre = require("hardhat");
const { web3, assertEventEmitted } = hre;
const { utf8ToHex, padLeft } = web3.utils;
const { getContract } = hre;
const { assert } = require("chai");

const { interfaceName, didContractThrow } = require("@uma/common");

const { deployContractMock } = require("../../helpers/SmockitHelper");

// Tested Contract
const Nomad_ParentMessenger = getContract("Nomad_ParentMessenger");

// Helper contracts
const Finder = getContract("Finder");
const childChainDomain = 1000;

// Addresses are sent to the `Home.dispatch()` method in bytes32 encoding, so we need to convert them from checksum
// addresses to bytes32.
const addressToBytes32 = (addressString) => {
  return padLeft(addressString.toLowerCase(), 64);
};

describe("Nomad_ParentMessenger", function () {
  let nomad_ParentMessenger, finder, home, xAppConnectionManager;
  let l1Owner, childMessenger, replica, rando, oracleHub, governorHub, oracleSpoke, governorSpoke;

  beforeEach(async () => {
    const accounts = await hre.web3.eth.getAccounts();
    [l1Owner, replica, childMessenger, rando, oracleHub, governorHub, oracleSpoke, governorSpoke] = accounts;

    finder = await Finder.new().send({ from: l1Owner });

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

    nomad_ParentMessenger = await Nomad_ParentMessenger.new(finder.options.address, childChainDomain).send({
      from: l1Owner,
    });
    await nomad_ParentMessenger.methods.setChildMessenger(childMessenger).send({ from: l1Owner });
    await nomad_ParentMessenger.methods.setOracleHub(oracleHub).send({ from: l1Owner });
    await nomad_ParentMessenger.methods.setGovernorHub(governorHub).send({ from: l1Owner });
    await nomad_ParentMessenger.methods.setOracleSpoke(oracleSpoke).send({ from: l1Owner });
    await nomad_ParentMessenger.methods.setGovernorSpoke(governorSpoke).send({ from: l1Owner });
  });
  describe("Sending messages to child", () => {
    it("Blocks calls from non privileged callers", async () => {
      // Only a hub contract should be able to call this function. All other accounts should be blocked.
      const relayMessageTxn = nomad_ParentMessenger.methods.sendMessageToChild("0x1234");
      assert(await didContractThrow(relayMessageTxn.send({ from: rando })));
      assert.ok(await relayMessageTxn.send({ from: oracleHub }));
    });

    it("Correctly encodes and sends messages to child", async () => {
      let message = "0x1234";

      // Check the message was sent to the Home contract and was encoded correctly.

      // Calls from GovernorHub should set target in encoded data to GovernorSpoke.
      let txn = await nomad_ParentMessenger.methods.sendMessageToChild(message).send({ from: governorHub });
      let expectedDataToSendToChild = web3.eth.abi.encodeParameters(["bytes", "address"], [message, governorSpoke]);
      let smockedMessage = home.smocked.dispatch.calls;
      assert.equal(smockedMessage.length, 1); // there should be only one call
      assert.equal(smockedMessage[0]._destinationDomain, childChainDomain);
      assert.equal(smockedMessage[0]._recipientAddress, addressToBytes32(childMessenger));
      assert.equal(smockedMessage[0]._messageBody, expectedDataToSendToChild);
      await assertEventEmitted(txn, nomad_ParentMessenger, "MessageSentToChild", (ev) => {
        return (
          ev.data == expectedDataToSendToChild &&
          ev.targetSpoke == governorSpoke &&
          ev.childChainDomain.toString() == childChainDomain.toString() &&
          ev.childMessenger == childMessenger
        );
      });

      // Calls from OracleHub should set target in encoded data to OracleSpoke
      txn = await nomad_ParentMessenger.methods.sendMessageToChild(message).send({ from: oracleHub });
      expectedDataToSendToChild = web3.eth.abi.encodeParameters(["bytes", "address"], [message, oracleSpoke]);
      smockedMessage = home.smocked.dispatch.calls;
      assert.equal(smockedMessage.length, 1); // there should be only one call
      assert.equal(smockedMessage[0]._destinationDomain, childChainDomain);
      assert.equal(smockedMessage[0]._recipientAddress, addressToBytes32(childMessenger));
      assert.equal(smockedMessage[0]._messageBody, expectedDataToSendToChild);
      await assertEventEmitted(txn, nomad_ParentMessenger, "MessageSentToChild", (ev) => {
        return (
          ev.data == expectedDataToSendToChild &&
          ev.targetSpoke == oracleSpoke &&
          ev.childChainDomain.toString() == childChainDomain.toString() &&
          ev.childMessenger == childMessenger
        );
      });
    });
  });
  describe("Receiving messages from child", () => {
    it("Caller must be Replica and cross chain sender must be ChildMessenger", async () => {
      const oracleHubSmocked = await deployContractMock("OracleHub", {}, getContract("OracleHub"));
      await nomad_ParentMessenger.methods.setOracleHub(oracleHubSmocked.options.address).send({ from: l1Owner });

      const dataToSendToHub = "0x1234";
      const handleTxn = (sender) => {
        return nomad_ParentMessenger.methods.handle(childChainDomain, addressToBytes32(sender), dataToSendToHub);
      };

      // Fails if `isReplica` returns false, so we'll set the smocked XAppConnectionManager to always return false for
      // this method.
      xAppConnectionManager.smocked.isReplica.will.return.with(() => false);
      assert(await didContractThrow(handleTxn(childMessenger).send({ from: replica })));
      xAppConnectionManager.smocked.isReplica.will.return.with(() => true);

      // Sender must be parent messenger
      assert(await didContractThrow(handleTxn(rando).send({ from: replica })));
      const txn = await handleTxn(childMessenger).send({ from: replica });

      // Check if data is sent correctly to target, which checks that `handle()` correctly decodes the message.
      const smockedMessage = oracleHubSmocked.smocked.processMessageFromChild.calls;
      assert.equal(smockedMessage.length, 1); // there should be only one call
      assert.equal(smockedMessage[0].data, dataToSendToHub);
      assert.equal(smockedMessage[0].chainId.toString(), childChainDomain.toString());

      await assertEventEmitted(txn, nomad_ParentMessenger, "MessageReceivedFromChild", (ev) => {
        return (
          ev.data == dataToSendToHub &&
          ev.targetHub == oracleHubSmocked.options.address &&
          ev.childMessenger == childMessenger &&
          ev.sourceDomain.toString() == childChainDomain.toString()
        );
      });
    });
  });
});

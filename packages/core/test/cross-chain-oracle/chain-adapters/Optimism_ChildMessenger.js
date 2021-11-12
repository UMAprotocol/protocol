const hre = require("hardhat");
const { web3, assertEventEmitted } = hre;
const { predeploys } = require("@eth-optimism/contracts");
const { toWei, utf8ToHex, padRight } = web3.utils;
const { getContract } = hre;
const { assert } = require("chai");

const { ZERO_ADDRESS, didContractThrow } = require("@uma/common");

const { deployContractMock } = require("../../helpers/SmockitHelper");

// Tested Contract
const Optimism_ChildMessenger = getContract("Optimism_ChildMessenger");

// Helper contracts
const OracleSpokeMock = getContract("OracleSpokeMock");
const ParentMessengerInterface = getContract("ParentMessengerInterface");

const priceIdentifier = padRight(utf8ToHex("TEST_IDENTIFIER"), 64);
const ancillaryData = utf8ToHex("some-address-field:0x1234");

// Create some random accounts to mimic key cross-chain oracle addresses that are not deployed in these tests.

describe("Optimism_ChildMessenger", function () {
  let optimism_ChildMessenger, l1Owner, parentMessenger, controlledEOA, rando, oracleSpoke, l2CrossDomainMessengerMock;

  beforeEach(async () => {
    const accounts = await hre.web3.eth.getAccounts();
    [l1Owner, controlledEOA, parentMessenger, rando] = accounts;

    l2CrossDomainMessengerMock = await deployContractMock("OVM_L2CrossDomainMessenger", {
      address: predeploys.OVM_L2CrossDomainMessenger,
    });
    await web3.eth.sendTransaction({ from: l1Owner, to: predeploys.OVM_L2CrossDomainMessenger, value: toWei("1") });

    optimism_ChildMessenger = await Optimism_ChildMessenger.new(parentMessenger).send({ from: l1Owner });

    oracleSpoke = await OracleSpokeMock.new(optimism_ChildMessenger.options.address).send({ from: l1Owner });

    l2CrossDomainMessengerMock.smocked.xDomainMessageSender.will.return.with(() => parentMessenger);
    await optimism_ChildMessenger.methods
      .setOracleSpoke(oracleSpoke.options.address)
      .send({ from: l2CrossDomainMessengerMock.options.address });
  });
  describe("Sending messages to parent on L1", () => {
    it("Blocks calls from non privileged callers", async () => {
      // Only the oracleSpoke should be able to call this function. All other accounts should be blocked.
      const relayMessageTxn = optimism_ChildMessenger.methods.sendMessageToParent("0x123");
      assert(await didContractThrow(relayMessageTxn.send({ from: rando })));

      // Change the oracle spoke to be some EOA that we control to check the function can be called.
      l2CrossDomainMessengerMock.smocked.xDomainMessageSender.will.return.with(() => parentMessenger);
      await optimism_ChildMessenger.methods
        .setOracleSpoke(controlledEOA)
        .send({ from: l2CrossDomainMessengerMock.options.address });
      assert.ok(await relayMessageTxn.send({ from: controlledEOA }));
    });

    it("Correctly encodes and sends messages to parent on L1", async () => {
      // For this test we will call the `requestPrice` method on the OracleSpokeMock which will initiate the cross chain
      // function call. Note normally only a registered contract can call this function.

      const requestTime = 123456789;
      await oracleSpoke.methods.requestPrice(priceIdentifier, requestTime, ancillaryData).send({ from: rando });

      // Check the message was sent to the l2 cross domain messenger and was encoded correctly.

      const requestPriceMessage = l2CrossDomainMessengerMock.smocked.sendMessage.calls;

      assert.equal(requestPriceMessage.length, 1); // there should be only one call to sendMessage.
      assert.equal(requestPriceMessage[0]._target, parentMessenger); // Target should be the parent messenger.

      // Validate the data sent matches to the expected format, given events emitted by the Oracle Spoke Mock.
      const emittedData = await oracleSpoke.getPastEvents("PriceRequested", { fromBlock: 0, toBlock: "latest" });
      const targetDataSentFromOracleSpoke = emittedData[0].returnValues.dataSentToParent;

      // Generate the target message data that should have been forwarded to the parent messenger interface from the
      // Optimism child messenger within the sendMessageToParent function call.
      const parentMessengerInterface = await ParentMessengerInterface.at(ZERO_ADDRESS);
      const expectedMessageFromEvent = await parentMessengerInterface.methods
        .processMessageFromChild(targetDataSentFromOracleSpoke)
        .encodeABI();

      assert.equal(requestPriceMessage[0]._message, expectedMessageFromEvent);

      // Equally, we should be able to construct the function call sent from the oracle spoke directly, which should
      // match to the emitted data above.

      const encodedData = web3.eth.abi.encodeParameters(
        ["bytes32", "uint256", "bytes"],
        [priceIdentifier, requestTime, await oracleSpoke.methods._stampAncillaryData(ancillaryData, rando).call()]
      );

      // This data is then encoded within the ParentMessengerInterface processMessageFromChild function.

      const expectedMessageFromManualEncoding = await parentMessengerInterface.methods
        .processMessageFromChild(encodedData)
        .encodeABI();

      assert.equal(requestPriceMessage[0]._message, expectedMessageFromManualEncoding);
    });
  });
  describe("Receiving messages from parent on L1", () => {
    it("Blocks calls from non privileged callers", async () => {
      // only the parent messenger should be able to call this function. All other accounts should be blocked.
      const relayMessageTxn = optimism_ChildMessenger.methods.processMessageFromParent(
        "0x123",
        oracleSpoke.options.address
      );
      assert(await didContractThrow(relayMessageTxn.send({ from: rando })));

      // Equally, calling via the cross domain messenger with the wrong source (not parentMessenger) should fail.
      l2CrossDomainMessengerMock.smocked.xDomainMessageSender.will.return.with(() => rando);

      assert(await didContractThrow(relayMessageTxn.send({ from: l2CrossDomainMessengerMock.options.address })));

      // Finally, should be able to send cross domain call to this function when the parent messenger is set.
      l2CrossDomainMessengerMock.smocked.xDomainMessageSender.will.return.with(() => parentMessenger);
      assert.ok(await relayMessageTxn.send({ from: l2CrossDomainMessengerMock.options.address }));
    });

    it("Correctly decodes and sends to target when sent from parent messenger on L1", async () => {
      // For this test create some arbitrary data that we want to pass to the OracleSpokeMock to validate cross-chain
      // communications.
      const sentData = "0x0123";
      l2CrossDomainMessengerMock.smocked.xDomainMessageSender.will.return.with(() => parentMessenger);
      const tx = await optimism_ChildMessenger.methods
        .processMessageFromParent(sentData, oracleSpoke.options.address)
        .send({ from: l2CrossDomainMessengerMock.options.address });

      // Validate that the tx contains the correct message sent from L1.
      await assertEventEmitted(tx, oracleSpoke, "MessageProcessed", (ev) => {
        return ev.data == sentData;
      });
    });
  });
});

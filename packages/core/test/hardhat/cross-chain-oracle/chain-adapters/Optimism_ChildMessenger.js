const hre = require("hardhat");
const { web3, assertEventEmitted } = hre;
const { predeploys } = require("@eth-optimism/contracts");
const { toWei, utf8ToHex, padRight } = web3.utils;
const { getContract } = hre;
const { assert } = require("chai");

const { ZERO_ADDRESS, interfaceName, RegistryRolesEnum, didContractThrow } = require("@uma/common");

const { deployContractMock } = require("../../helpers/SmockitHelper");

// Tested Contract
const Optimism_ChildMessenger = getContract("Optimism_ChildMessenger");
const Optimism_ParentMessenger = getContract("Optimism_ParentMessenger");

// Helper contracts
const OracleSpoke = getContract("OracleSpoke");
const Finder = getContract("Finder");
const Registry = getContract("Registry");

const priceIdentifier = padRight(utf8ToHex("TEST_IDENTIFIER"), 64);
const ancillaryData = utf8ToHex("some-address-field:0x1234");
const defaultTimestamp = 100;

// Create some random accounts to mimic key cross-chain oracle addresses that are not deployed in these tests.

describe("Optimism_ChildMessenger", function () {
  let optimism_ChildMessenger, finder, oracleSpoke, l2CrossDomainMessengerMock;
  let l1Owner, parentMessenger, controlledEOA, rando;

  beforeEach(async () => {
    const accounts = await hre.web3.eth.getAccounts();
    [l1Owner, controlledEOA, parentMessenger, rando] = accounts;

    l2CrossDomainMessengerMock = await deployContractMock("L2CrossDomainMessenger", {
      address: predeploys.L2CrossDomainMessenger,
    });
    await web3.eth.sendTransaction({ from: l1Owner, to: predeploys.L2CrossDomainMessenger, value: toWei("1") });

    optimism_ChildMessenger = await Optimism_ChildMessenger.new(parentMessenger).send({ from: l1Owner });

    // Deploy a finder & Registry. Add Registry to the Finder. add the controlledEOA to be registered.
    finder = await Finder.new().send({ from: l1Owner });

    const registry = await Registry.new().send({ from: l1Owner });
    await registry.methods.addMember(RegistryRolesEnum.CONTRACT_CREATOR, l1Owner).send({ from: l1Owner });
    await registry.methods.registerContract([], controlledEOA).send({ from: l1Owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Registry), registry.options.address)
      .send({ from: l1Owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.ChildMessenger), optimism_ChildMessenger.options.address)
      .send({ from: l1Owner });
    oracleSpoke = await OracleSpoke.new(finder.options.address).send({ from: l1Owner });

    l2CrossDomainMessengerMock.smocked.xDomainMessageSender.will.return.with(() => parentMessenger);
    await optimism_ChildMessenger.methods
      .setOracleSpoke(oracleSpoke.options.address)
      .send({ from: l2CrossDomainMessengerMock.options.address });
  });
  describe("Resetting contract state", () => {
    // Check that only cross-domain owner can call these methods, that events are emitted as expected, and that state
    // is modified.
    it("setOracleSpoke", async () => {
      const transactionToSend = optimism_ChildMessenger.methods.setOracleSpoke(rando);
      assert(await didContractThrow(transactionToSend.send({ from: rando })));
      const receipt = await transactionToSend.send({ from: l2CrossDomainMessengerMock.options.address });
      await assertEventEmitted(receipt, optimism_ChildMessenger, "SetOracleSpoke", (ev) => {
        return ev.newOracleSpoke == rando;
      });
      assert.equal(await optimism_ChildMessenger.methods.oracleSpoke().call(), rando);
    });
    it("setParentMessenger", async () => {
      const transactionToSend = optimism_ChildMessenger.methods.setParentMessenger(rando);
      assert(await didContractThrow(transactionToSend.send({ from: rando })));
      const receipt = await transactionToSend.send({ from: l2CrossDomainMessengerMock.options.address });
      await assertEventEmitted(receipt, optimism_ChildMessenger, "SetParentMessenger", (ev) => {
        return ev.newParentMessenger == rando;
      });
      assert.equal(await optimism_ChildMessenger.methods.parentMessenger().call(), rando);
    });
    it("setDefaultGasLimit", async () => {
      const transactionToSend = optimism_ChildMessenger.methods.setDefaultGasLimit("100");
      assert(await didContractThrow(transactionToSend.send({ from: rando })));
      const receipt = await transactionToSend.send({ from: l2CrossDomainMessengerMock.options.address });
      await assertEventEmitted(receipt, optimism_ChildMessenger, "SetDefaultGasLimit", (ev) => {
        return ev.newDefaultGasLimit == "100";
      });
      assert.equal((await optimism_ChildMessenger.methods.defaultGasLimit().call()).toString(), "100");
    });
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
      // For this test we will call the `requestPrice` method on the OracleSpoke which will initiate the cross chain
      // function call. Note normally only a registered contract can call this function.

      const requestTime = 123456789;
      const txn = await oracleSpoke.methods
        .requestPrice(priceIdentifier, requestTime, ancillaryData)
        .send({ from: controlledEOA });

      // Check the message was sent to the l2 cross domain messenger and was encoded correctly.

      const requestPriceMessage = l2CrossDomainMessengerMock.smocked.sendMessage.calls;

      assert.equal(requestPriceMessage.length, 1); // there should be only one call to sendMessage.
      assert.equal(requestPriceMessage[0]._target, parentMessenger); // Target should be the parent messenger.

      // We should be able to construct the function call sent from the oracle spoke directly.
      const encodedData = web3.eth.abi.encodeParameters(
        ["bytes32", "uint256", "bytes"],
        [priceIdentifier, requestTime, await oracleSpoke.methods.stampAncillaryData(ancillaryData).call()]
      );

      // This data is then encoded within the Optimism_ParentMessenger.processMessageFromCrossChainChild function.
      const parentMessengerInterface = await Optimism_ParentMessenger.at(ZERO_ADDRESS);
      const expectedMessageFromManualEncoding = await parentMessengerInterface.methods
        .processMessageFromCrossChainChild(encodedData)
        .encodeABI();

      assert.equal(requestPriceMessage[0]._message, expectedMessageFromManualEncoding);

      await assertEventEmitted(txn, optimism_ChildMessenger, "MessageSentToParent", (ev) => {
        return (
          ev.data == expectedMessageFromManualEncoding &&
          ev.parentAddress == parentMessenger &&
          ev.gasLimit.toString() == "5000000"
        );
      });
    });
  });
  describe("Receiving messages from parent on L1", () => {
    it("Blocks calls from non privileged callers", async () => {
      // only the parent messenger should be able to call this function. All other accounts should be blocked.
      const data = web3.eth.abi.encodeParameters(
        ["bytes32", "uint256", "bytes", "int256"],
        [priceIdentifier, defaultTimestamp, ancillaryData, toWei("1234")]
      );
      const relayMessageTxn = optimism_ChildMessenger.methods.processMessageFromCrossChainParent(
        data,
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
      // For this test request a price from a registered contract and then push the price. Validate the data is
      // requested and forwarded to the oracleSpoke correctly.

      await oracleSpoke.methods
        .requestPrice(priceIdentifier, defaultTimestamp, ancillaryData)
        .send({ from: controlledEOA });

      const priceRequestEvents = await oracleSpoke.getPastEvents("PriceRequestAdded", { fromBock: 0 });

      const requestAncillaryData = await oracleSpoke.methods.stampAncillaryData(ancillaryData).call();
      const requestPrice = toWei("1234");

      const data = web3.eth.abi.encodeParameters(
        ["bytes32", "uint256", "bytes", "int256"],
        [priceIdentifier, defaultTimestamp, requestAncillaryData, requestPrice]
      );

      l2CrossDomainMessengerMock.smocked.xDomainMessageSender.will.return.with(() => parentMessenger);
      const tx = await optimism_ChildMessenger.methods
        .processMessageFromCrossChainParent(data, oracleSpoke.options.address)
        .send({ from: l2CrossDomainMessengerMock.options.address });

      await assertEventEmitted(tx, optimism_ChildMessenger, "MessageReceivedFromParent", (ev) => {
        return ev.data == data && ev.targetSpoke == oracleSpoke.options.address && ev.parentAddress == parentMessenger;
      });

      // Validate that the tx contains the correct message sent from L1.
      await assertEventEmitted(tx, oracleSpoke, "PushedPrice", (ev) => {
        return (
          ev.identifier == priceIdentifier &&
          ev.ancillaryData == requestAncillaryData &&
          ev.price == requestPrice &&
          ev.requestHash == priceRequestEvents[0].returnValues.requestHash
        );
      });
    });
  });
});

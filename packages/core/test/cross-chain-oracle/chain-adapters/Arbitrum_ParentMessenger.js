const hre = require("hardhat");
const { web3, assertEventEmitted } = hre;
const { toWei, utf8ToHex, padRight, toBN } = web3.utils;
const { getContract } = hre;
const { assert } = require("chai");

const { ZERO_ADDRESS, didContractThrow, interfaceName } = require("@uma/common");
const { deployContractMock } = require("../../helpers/SmockitHelper");

// Tested Contract
const Arbitrum_ChildMessenger = getContract("Arbitrum_ChildMessenger");
const Arbitrum_ParentMessenger = getContract("Arbitrum_ParentMessenger");

// Other helper contracts
const Arbitrum_BridgeMock = getContract("Arbitrum_BridgeMock");
const OracleHub = getContract("OracleHub");
const GovernorHub = getContract("GovernorHub");
const Finder = getContract("Finder");
const Store = getContract("Store");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const MockOracle = getContract("MockOracleAncillary");
const Timer = getContract("Timer");
const ExpandedERC20 = getContract("ExpandedERC20");

// Create some random accounts to to mimic key cross-chain oracle addresses.
const childMessengerAddress = web3.utils.toChecksumAddress(web3.utils.randomHex(20));
const oracleSpokeAddress = web3.utils.toChecksumAddress(web3.utils.randomHex(20));
const governorSpokeAddress = web3.utils.toChecksumAddress(web3.utils.randomHex(20));
const l2FinderAddress = web3.utils.toChecksumAddress(web3.utils.randomHex(20));

const chainId = 42069;
const priceIdentifier = padRight(utf8ToHex("TEST_IDENTIFIER"), 64);
const ancillaryData = utf8ToHex("some-address-field:0x1234");
const bond = toWei("1");
const defaultTimestamp = 100;

let defaultMaxSubmissionCost;
let defaultGasLimit;
let defaultGasPrice;
let l1CallValue;

describe("Arbitrum_ParentMessenger", function () {
  let arbitrum_ParentMessenger,
    oracleHub,
    governorHub,
    inbox,
    outbox,
    bridge,
    bondToken,
    identifierWhitelist,
    store,
    mockOracle,
    finder,
    timer;
  let l1Owner, controlledEOA, rando;

  beforeEach(async () => {
    const accounts = await hre.web3.eth.getAccounts();
    [l1Owner, controlledEOA, rando] = accounts;

    // Set up Arbitrum sys mock contracts to test that functions are permissioned for cross-domain callers correctly.
    bridge = await Arbitrum_BridgeMock.new().send({ from: l1Owner });

    inbox = await deployContractMock("Arbitrum_InboxMock", {}, getContract("Arbitrum_InboxMock"));
    outbox = await deployContractMock("Arbitrum_OutboxMock", {}, getContract("Arbitrum_OutboxMock"));

    arbitrum_ParentMessenger = await Arbitrum_ParentMessenger.new(inbox.options.address, chainId).send({
      from: l1Owner,
    });

    // Deploy UMA contracts to enable the OracleHub to pull prices from.
    timer = await Timer.new().send({ from: l1Owner });
    finder = await Finder.new().send({ from: l1Owner });
    store = await Store.new({ rawValue: "0" }, { rawValue: "0" }, timer.options.address).send({ from: l1Owner });
    identifierWhitelist = await IdentifierWhitelist.new().send({ from: l1Owner });
    bondToken = await ExpandedERC20.new("BOND", "BOND", 18).send({ from: l1Owner });
    await identifierWhitelist.methods.addSupportedIdentifier(priceIdentifier).send({ from: l1Owner });

    await store.methods.setFinalFee(bondToken.options.address, { rawValue: bond }).send({ from: l1Owner });
    mockOracle = await MockOracle.new(finder.options.address, timer.options.address).send({ from: l1Owner });

    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.IdentifierWhitelist), identifierWhitelist.options.address)
      .send({ from: l1Owner });

    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Store), store.options.address)
      .send({ from: l1Owner });

    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Oracle), mockOracle.options.address)
      .send({ from: l1Owner });

    // deploy the oracleHub. Set the token used for bonding to the zero address as this is not tested here.
    oracleHub = await OracleHub.new(finder.options.address, ZERO_ADDRESS).send({ from: l1Owner });
    await oracleHub.methods.setMessenger(chainId, arbitrum_ParentMessenger.options.address).send({ from: l1Owner });

    governorHub = await GovernorHub.new().send({ from: l1Owner });
    await governorHub.methods.setMessenger(chainId, arbitrum_ParentMessenger.options.address).send({ from: l1Owner });

    await arbitrum_ParentMessenger.methods.setChildMessenger(childMessengerAddress).send({ from: l1Owner });
    await arbitrum_ParentMessenger.methods.setOracleHub(oracleHub.options.address).send({ from: l1Owner });
    await arbitrum_ParentMessenger.methods.setGovernorHub(governorHub.options.address).send({ from: l1Owner });
    await arbitrum_ParentMessenger.methods.setOracleSpoke(oracleSpokeAddress).send({ from: l1Owner });
    await arbitrum_ParentMessenger.methods.setGovernorSpoke(governorSpokeAddress).send({ from: l1Owner });

    defaultMaxSubmissionCost = await arbitrum_ParentMessenger.methods.defaultMaxSubmissionCost().call();
    defaultGasLimit = await arbitrum_ParentMessenger.methods.defaultGasLimit().call();
    defaultGasPrice = await arbitrum_ParentMessenger.methods.defaultGasPrice().call();
    l1CallValue = await arbitrum_ParentMessenger.methods.getL1CallValue().call();
  });
  describe("Resetting contract state", () => {
    // Check that only owner can call these methods, that events are emitted as expected, and that state is modified.
    it("setRefundL2Address", async () => {
      const transactionToSend = arbitrum_ParentMessenger.methods.setRefundL2Address(rando);
      assert(await didContractThrow(transactionToSend.send({ from: rando })));
      const receipt = await transactionToSend.send({ from: l1Owner });
      await assertEventEmitted(receipt, arbitrum_ParentMessenger, "SetRefundL2Address", (ev) => {
        return ev.newRefundL2Address == rando;
      });
      assert.equal(await arbitrum_ParentMessenger.methods.refundL2Address().call(), rando);
    });
    it("setDefaultGasLimit", async () => {
      const transactionToSend = arbitrum_ParentMessenger.methods.setDefaultGasLimit("100");
      assert(await didContractThrow(transactionToSend.send({ from: rando })));
      const receipt = await transactionToSend.send({ from: l1Owner });
      await assertEventEmitted(receipt, arbitrum_ParentMessenger, "SetDefaultGasLimit", (ev) => {
        return ev.newDefaultGasLimit == "100";
      });
      assert.equal((await arbitrum_ParentMessenger.methods.defaultGasLimit().call()).toString(), "100");
    });
    it("setDefaultGasPrice", async () => {
      const transactionToSend = arbitrum_ParentMessenger.methods.setDefaultGasPrice("100");
      assert(await didContractThrow(transactionToSend.send({ from: rando })));
      const receipt = await transactionToSend.send({ from: l1Owner });
      await assertEventEmitted(receipt, arbitrum_ParentMessenger, "SetDefaultGasPrice", (ev) => {
        return ev.newDefaultGasPrice == "100";
      });
      assert.equal((await arbitrum_ParentMessenger.methods.defaultGasPrice().call()).toString(), "100");
    });
    it("setDefaultMaxSubmissionCost", async () => {
      const transactionToSend = arbitrum_ParentMessenger.methods.setDefaultMaxSubmissionCost("100");
      assert(await didContractThrow(transactionToSend.send({ from: rando })));
      const receipt = await transactionToSend.send({ from: l1Owner });
      await assertEventEmitted(receipt, arbitrum_ParentMessenger, "SetDefaultMaxSubmissionCost", (ev) => {
        return ev.newMaxSubmissionCost == "100";
      });
      assert.equal((await arbitrum_ParentMessenger.methods.defaultMaxSubmissionCost().call()).toString(), "100");
    });
  });
  describe("Sending messages to child on L2", () => {
    it("Caller must be hub and messenger must have sufficient ETH balance", async () => {
      // Send enough ETH to contract to cover sendMessage call.
      const expectedL1CallValue = toBN(defaultMaxSubmissionCost.toString()).add(
        toBN(defaultGasLimit.toString()).mul(toBN(defaultGasPrice.toString()))
      );
      assert.equal(l1CallValue.toString(), expectedL1CallValue.toString());
      await web3.eth.sendTransaction({
        from: l1Owner,
        to: arbitrum_ParentMessenger.options.address,
        value: l1CallValue.toString(),
      });

      const relayMessageTxn = arbitrum_ParentMessenger.methods.sendMessageToChild("0x123");
      assert(await didContractThrow(relayMessageTxn.send({ from: rando })));

      // Caller must be a hub contract.
      await arbitrum_ParentMessenger.methods.setGovernorHub(controlledEOA).send({ from: l1Owner });
      assert.ok(await relayMessageTxn.send({ from: controlledEOA }));

      // Reset hub and check that if caller is the other hub, it also works.
      await arbitrum_ParentMessenger.methods.setGovernorHub(governorHub.options.address).send({ from: l1Owner });
      assert(await didContractThrow(relayMessageTxn.send({ from: rando })));
      await arbitrum_ParentMessenger.methods.setOracleHub(controlledEOA).send({ from: l1Owner });

      // Fails unless more ETH is sent to contract to cover second cross chain message:
      assert(await didContractThrow(relayMessageTxn.send({ from: controlledEOA })));
      await web3.eth.sendTransaction({
        from: l1Owner,
        to: arbitrum_ParentMessenger.options.address,
        value: l1CallValue.toString(),
      });
      assert.ok(await relayMessageTxn.send({ from: controlledEOA }));
    });
    it("Can correctly send messages to L2 child from Oracle Hub", async () => {
      // The oracle hub is used to push prices to the oracle Spoke. We can create a fake price, set it in the mock
      // oracle hub and then try send it to the oracle spoke via the publish price method. To validate the correctness
      // of this action we can check what data is sent to the inbox, which passes messages between
      // L1 and L2.
      const pushedPrice = toWei("1234");
      const priceTime = 1234;
      await mockOracle.methods.requestPrice(priceIdentifier, priceTime, ancillaryData).send({ from: l1Owner });
      await mockOracle.methods
        .pushPrice(priceIdentifier, priceTime, ancillaryData, pushedPrice)
        .send({ from: l1Owner });

      // Transaction will fail unless caller includes exactly enough ETH to pay for message:
      assert(
        await didContractThrow(
          oracleHub.methods.publishPrice(chainId, priceIdentifier, priceTime, ancillaryData).send({ from: l1Owner })
        )
      );
      assert(
        await didContractThrow(
          oracleHub.methods
            .publishPrice(chainId, priceIdentifier, priceTime, ancillaryData)
            .send({ from: l1Owner, value: toBN(l1CallValue.toString()).add(toBN("1")) })
        )
      );
      const txn = await oracleHub.methods
        .publishPrice(chainId, priceIdentifier, priceTime, ancillaryData)
        .send({ from: l1Owner, value: l1CallValue.toString() });

      // Validate that the inbox received the expected cross-domain message, destined for the child.
      const publishPriceMessage = inbox.smocked.createRetryableTicketNoRefundAliasRewrite.calls;

      assert.equal(publishPriceMessage.length, 1); // there should be only one call.
      assert.equal(publishPriceMessage[0].destAddr, childMessengerAddress); // Target should be the child messenger.
      assert.equal(publishPriceMessage[0].l2CallValue.toString(), "0");
      assert.equal(publishPriceMessage[0].maxSubmissionCost.toString(), defaultMaxSubmissionCost.toString());
      assert.equal(publishPriceMessage[0].excessFeeRefundAddress, l1Owner);
      assert.equal(publishPriceMessage[0].callValueRefundAddress, l1Owner);
      assert.equal(publishPriceMessage[0].maxGas.toString(), defaultGasLimit.toString());
      assert.equal(publishPriceMessage[0].gasPriceBid.toString(), defaultGasPrice.toString());

      // Inbox receives msg.value
      assert.equal((await web3.eth.getBalance(inbox.options.address)).toString(), l1CallValue.toString());

      // We should be able to re-construct the encoded data, which should match what was sent from the messenger.
      const encodedData = web3.eth.abi.encodeParameters(
        ["bytes32", "uint256", "bytes", "int256"],
        [priceIdentifier, priceTime, ancillaryData, pushedPrice]
      );
      const childMessengerInterface = await Arbitrum_ChildMessenger.at(ZERO_ADDRESS);
      const expectedMessageFromManualEncoding = await childMessengerInterface.methods
        .processMessageFromCrossChainParent(encodedData, oracleSpokeAddress)
        .encodeABI();
      assert.equal(publishPriceMessage[0].data, expectedMessageFromManualEncoding);

      await assertEventEmitted(txn, arbitrum_ParentMessenger, "MessageSentToChild", (ev) => {
        return (
          ev.data == expectedMessageFromManualEncoding &&
          ev.childMessenger == childMessengerAddress &&
          ev.gasLimit.toString() == defaultGasLimit.toString() &&
          ev.l1CallValue.toString() == l1CallValue.toString() &&
          ev.targetSpoke == oracleSpokeAddress &&
          ev.gasPrice.toString() == defaultGasPrice.toString() &&
          ev.maxSubmissionCost.toString() == defaultMaxSubmissionCost.toString() &&
          ev.sequenceNumber.toString() == "0"
        );
      });
    });
    it("Can correctly send messages to L2 child from Governor Hub", async () => {
      // The governor hub is used to send governance actions from L1 to L2. For example, adding/modifying the addresses
      // in the whitelist. We can create a fake governance action, set it in the mock governor hub and then try send it
      // to the governor spoke via the publish governance action method.
      const sampleGovernanceAction = (await Finder.at(ZERO_ADDRESS)).methods
        .changeImplementationAddress(utf8ToHex(interfaceName.CollateralWhitelist), l1Owner)
        .encodeABI();

      const call = [{ to: l2FinderAddress, data: sampleGovernanceAction }];

      // Transaction will fail unless messenger has enough ETH to pay for message:
      assert(await didContractThrow(governorHub.methods.relayGovernance(chainId, call).send({ from: l1Owner })));
      await web3.eth.sendTransaction({
        from: l1Owner,
        to: arbitrum_ParentMessenger.options.address,
        value: l1CallValue.toString(),
      });
      const txn = await governorHub.methods.relayGovernance(chainId, call).send({ from: l1Owner });

      // Validate that the inbox received the expected cross-domain message, destined for the child.
      const relayGovernanceMessage = inbox.smocked.createRetryableTicketNoRefundAliasRewrite.calls;

      assert.equal(relayGovernanceMessage.length, 1); // there should be only one call.
      assert.equal(relayGovernanceMessage[0].destAddr, childMessengerAddress); // Target should be the child messenger.
      assert.equal(relayGovernanceMessage[0].l2CallValue.toString(), "0");
      assert.equal(relayGovernanceMessage[0].maxSubmissionCost.toString(), defaultMaxSubmissionCost.toString());
      assert.equal(relayGovernanceMessage[0].excessFeeRefundAddress, l1Owner);
      assert.equal(relayGovernanceMessage[0].callValueRefundAddress, l1Owner);
      assert.equal(relayGovernanceMessage[0].maxGas.toString(), defaultGasLimit.toString());
      assert.equal(relayGovernanceMessage[0].gasPriceBid.toString(), defaultGasPrice.toString());

      // Inbox receives msg.value
      assert.equal((await web3.eth.getBalance(inbox.options.address)).toString(), l1CallValue.toString());

      // Grab the data emitted from the mock Oracle hub. This contains the dataSentToChild.
      const emittedData = await governorHub.getPastEvents("RelayedGovernanceRequest", {
        fromBlock: 0,
        toBlock: "latest",
      });
      const targetDataSentFromGovernorHub = emittedData[0].returnValues.dataSentToChild;

      // Check that the relayed data contains the correct target address and encoded function data.
      const encodedData = web3.eth.abi.encodeParameters(
        [
          {
            type: "tuple[]",
            components: [
              { name: "to", type: "address" },
              { name: "data", type: "bytes" },
            ],
          },
        ],
        [call]
      );
      assert.equal(encodedData, targetDataSentFromGovernorHub);

      // Generate the target message data that should have been forwarded to the Child messenger interface from the
      // Arbitrum Parent messenger within the _sendMessageToChild function call.
      const childMessengerInterface = await Arbitrum_ChildMessenger.at(ZERO_ADDRESS);
      const expectedMessageFromEvent = childMessengerInterface.methods
        .processMessageFromCrossChainParent(targetDataSentFromGovernorHub, governorSpokeAddress) // note the oracleSpokeAddress for the target in the message
        .encodeABI();
      assert.equal(relayGovernanceMessage[0].data, expectedMessageFromEvent);

      await assertEventEmitted(txn, arbitrum_ParentMessenger, "MessageSentToChild", (ev) => {
        return (
          ev.data == expectedMessageFromEvent &&
          ev.childMessenger == childMessengerAddress &&
          ev.gasLimit.toString() == defaultGasLimit.toString() &&
          ev.l1CallValue.toString() == l1CallValue.toString() &&
          ev.targetSpoke == governorSpokeAddress &&
          ev.gasPrice.toString() == defaultGasPrice.toString() &&
          ev.maxSubmissionCost.toString() == defaultMaxSubmissionCost.toString() &&
          ev.sequenceNumber.toString() == "0"
        );
      });
    });
    it("setChildParentMessenger", async () => {
      const setChildParentMessenger = arbitrum_ParentMessenger.methods.setChildParentMessenger(rando);

      // Can only call as owner
      assert(await didContractThrow(setChildParentMessenger.send({ from: rando })));

      // Will fail unless contract has enough ETH to pay for message.
      assert(await didContractThrow(setChildParentMessenger.send({ from: l1Owner })));
      await web3.eth.sendTransaction({
        from: l1Owner,
        to: arbitrum_ParentMessenger.options.address,
        value: l1CallValue.toString(),
      });
      const txn = await setChildParentMessenger.send({ from: l1Owner });

      // Validate that the inbox received the expected cross-domain message, destined for the child.
      const smockedMessage = inbox.smocked.createRetryableTicketNoRefundAliasRewrite.calls;

      assert.equal(smockedMessage.length, 1); // there should be only one call.
      assert.equal(smockedMessage[0].destAddr, childMessengerAddress); // Target should be the child messenger.
      assert.equal(smockedMessage[0].l2CallValue.toString(), "0");
      assert.equal(smockedMessage[0].maxSubmissionCost.toString(), defaultMaxSubmissionCost.toString());
      assert.equal(smockedMessage[0].excessFeeRefundAddress, l1Owner);
      assert.equal(smockedMessage[0].callValueRefundAddress, l1Owner);
      assert.equal(smockedMessage[0].maxGas.toString(), defaultGasLimit.toString());
      assert.equal(smockedMessage[0].gasPriceBid.toString(), defaultGasPrice.toString());

      // Inbox receives msg.value
      assert.equal((await web3.eth.getBalance(inbox.options.address)).toString(), l1CallValue.toString());

      // We should be able to re-construct the encoded data, which should match what was sent from the messenger.
      const childMessengerInterface = await Arbitrum_ChildMessenger.at(ZERO_ADDRESS);
      const expectedMessageFromManualEncoding = await childMessengerInterface.methods
        .setParentMessenger(rando)
        .encodeABI();
      assert.equal(smockedMessage[0].data, expectedMessageFromManualEncoding);

      await assertEventEmitted(txn, arbitrum_ParentMessenger, "MessageSentToChild", (ev) => {
        return (
          ev.data == expectedMessageFromManualEncoding &&
          ev.childMessenger == childMessengerAddress &&
          ev.gasLimit.toString() == defaultGasLimit.toString() &&
          ev.l1CallValue.toString() == l1CallValue.toString() &&
          ev.targetSpoke == childMessengerAddress &&
          ev.gasPrice.toString() == defaultGasPrice.toString() &&
          ev.maxSubmissionCost.toString() == defaultMaxSubmissionCost.toString() &&
          ev.sequenceNumber.toString() == "0"
        );
      });
    });
    it("setChildOracleSpoke", async () => {
      const setChildOracleSpoke = arbitrum_ParentMessenger.methods.setChildOracleSpoke(rando);

      // Can only call as owner
      assert(await didContractThrow(setChildOracleSpoke.send({ from: rando })));

      // Will fail unless contract has enough ETH to pay for message.
      assert(await didContractThrow(setChildOracleSpoke.send({ from: l1Owner })));
      await web3.eth.sendTransaction({
        from: l1Owner,
        to: arbitrum_ParentMessenger.options.address,
        value: l1CallValue.toString(),
      });
      const txn = await setChildOracleSpoke.send({ from: l1Owner });

      // Validate that the inbox received the expected cross-domain message, destined for the child.
      const smockedMessage = inbox.smocked.createRetryableTicketNoRefundAliasRewrite.calls;

      assert.equal(smockedMessage.length, 1); // there should be only one call.
      assert.equal(smockedMessage[0].destAddr, childMessengerAddress); // Target should be the child messenger.
      assert.equal(smockedMessage[0].l2CallValue.toString(), "0");
      assert.equal(smockedMessage[0].maxSubmissionCost.toString(), defaultMaxSubmissionCost.toString());
      assert.equal(smockedMessage[0].excessFeeRefundAddress, l1Owner);
      assert.equal(smockedMessage[0].callValueRefundAddress, l1Owner);
      assert.equal(smockedMessage[0].maxGas.toString(), defaultGasLimit.toString());
      assert.equal(smockedMessage[0].gasPriceBid.toString(), defaultGasPrice.toString());

      // Inbox receives msg.value
      assert.equal((await web3.eth.getBalance(inbox.options.address)).toString(), l1CallValue.toString());

      // We should be able to re-construct the encoded data, which should match what was sent from the messenger.
      const childMessengerInterface = await Arbitrum_ChildMessenger.at(ZERO_ADDRESS);
      const expectedMessageFromManualEncoding = await childMessengerInterface.methods.setOracleSpoke(rando).encodeABI();
      assert.equal(smockedMessage[0].data, expectedMessageFromManualEncoding);

      await assertEventEmitted(txn, arbitrum_ParentMessenger, "MessageSentToChild", (ev) => {
        return (
          ev.data == expectedMessageFromManualEncoding &&
          ev.childMessenger == childMessengerAddress &&
          ev.gasLimit.toString() == defaultGasLimit.toString() &&
          ev.l1CallValue.toString() == l1CallValue.toString() &&
          ev.targetSpoke == childMessengerAddress &&
          ev.gasPrice.toString() == defaultGasPrice.toString() &&
          ev.maxSubmissionCost.toString() == defaultMaxSubmissionCost.toString() &&
          ev.sequenceNumber.toString() == "0"
        );
      });
    });
  });
  describe("Receiving messages from child on L2", () => {
    it("Only callable from oracle spoke via cross domain message", async () => {
      const sentData = web3.eth.abi.encodeParameters(
        ["bytes32", "uint256", "bytes"],
        [priceIdentifier, defaultTimestamp, ancillaryData]
      );

      // Calling from some EOA on L1 should fail.
      assert(
        await didContractThrow(
          arbitrum_ParentMessenger.methods.processMessageFromCrossChainChild(sentData).send({ from: rando })
        )
      );

      // Must call this function from the L2 bridge. First, set up the bridge such that `activeOutbox` returns
      // an outbox who's `l2ToL1Sender` is set to the same address as `childMessenger` stored in the contract.
      inbox.smocked.bridge.will.return.with(() => bridge.options.address);
      outbox.smocked.l2ToL1Sender.will.return.with(() => childMessengerAddress);
      await bridge.methods.setOutbox(outbox.options.address).send({ from: l1Owner });
      const tx = await bridge.methods
        .processMessageFromCrossChainChild(arbitrum_ParentMessenger.options.address, sentData)
        .send({ from: l1Owner });

      await assertEventEmitted(tx, arbitrum_ParentMessenger, "MessageReceivedFromChild", (ev) => {
        return (
          ev.data == sentData && ev.childMessenger == childMessengerAddress && ev.targetHub == oracleHub.options.address
        );
      });

      // Validate that the tx contains the correct message sent from L2.
      await assertEventEmitted(tx, mockOracle, "PriceRequestAdded", (ev) => {
        return ev.identifier == priceIdentifier && ev.time == defaultTimestamp && ev.ancillaryData == ancillaryData;
      });
    });
  });
});

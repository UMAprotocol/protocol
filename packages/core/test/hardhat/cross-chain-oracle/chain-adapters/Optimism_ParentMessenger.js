const hre = require("hardhat");
const { web3, assertEventEmitted } = hre;
const { toWei, utf8ToHex, padRight } = web3.utils;
const { getContract } = hre;
const { assert, expect } = require("chai");

const { ZERO_ADDRESS, didContractThrow, interfaceName } = require("@uma/common");

const { deployContractMock } = require("../../helpers/SmockitHelper");

// Tested Contract
const Optimism_ChildMessenger = getContract("Optimism_ChildMessenger");
const Optimism_ParentMessenger = getContract("Optimism_ParentMessenger");

// Other helper contracts
const OVM_L1CrossDomainMessengerMock = getContract("OVM_L1CrossDomainMessengerMock");
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
let defaultGasLimit;

describe("Optimism_ParentMessenger", function () {
  let optimism_ParentMessenger,
    oracleHub,
    governorHub,
    l1CrossDomainMessengerMock,
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

    l1CrossDomainMessengerMock = await deployContractMock(
      "OVM_L1CrossDomainMessengerMock",
      {},
      OVM_L1CrossDomainMessengerMock
    );
    await web3.eth.sendTransaction({
      from: l1Owner,
      to: l1CrossDomainMessengerMock.options.address,
      value: toWei("1"),
    });

    optimism_ParentMessenger = await Optimism_ParentMessenger.new(
      l1CrossDomainMessengerMock.options.address,
      chainId
    ).send({ from: l1Owner });

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
    await oracleHub.methods.setMessenger(chainId, optimism_ParentMessenger.options.address).send({ from: l1Owner });

    governorHub = await GovernorHub.new().send({ from: l1Owner });
    await governorHub.methods.setMessenger(chainId, optimism_ParentMessenger.options.address).send({ from: l1Owner });

    await optimism_ParentMessenger.methods.setChildMessenger(childMessengerAddress).send({ from: l1Owner });
    await optimism_ParentMessenger.methods.setOracleHub(oracleHub.options.address).send({ from: l1Owner });
    await optimism_ParentMessenger.methods.setGovernorHub(governorHub.options.address).send({ from: l1Owner });
    await optimism_ParentMessenger.methods.setOracleSpoke(oracleSpokeAddress).send({ from: l1Owner });
    await optimism_ParentMessenger.methods.setGovernorSpoke(governorSpokeAddress).send({ from: l1Owner });

    defaultGasLimit = await optimism_ParentMessenger.methods.defaultGasLimit().call();
  });
  describe("Resetting contract state", () => {
    // Check that only owner can call these methods, that events are emitted as expected, and that state is modified.
    it("setDefaultGasLimit", async () => {
      const transactionToSend = optimism_ParentMessenger.methods.setDefaultGasLimit("100");
      assert(await didContractThrow(transactionToSend.send({ from: rando })));
      const receipt = await transactionToSend.send({ from: l1Owner });
      await assertEventEmitted(receipt, optimism_ParentMessenger, "SetDefaultGasLimit", (ev) => {
        return ev.newDefaultGasLimit == "100";
      });
      assert.equal((await optimism_ParentMessenger.methods.defaultGasLimit().call()).toString(), "100");
    });
  });
  describe("Sending messages to child on L2", () => {
    it("Blocks calls from non privileged callers", async () => {
      const relayMessageTxn = optimism_ParentMessenger.methods.sendMessageToChild("0x123");
      assert(await didContractThrow(relayMessageTxn.send({ from: rando })));

      await optimism_ParentMessenger.methods.setGovernorHub(controlledEOA).send({ from: l1Owner });
      assert.ok(await relayMessageTxn.send({ from: controlledEOA }));

      await optimism_ParentMessenger.methods.setOracleHub(controlledEOA).send({ from: l1Owner });
      assert.ok(await relayMessageTxn.send({ from: controlledEOA }));
    });
    it("Can correctly send messages to L2 child from Oracle Hub", async () => {
      // The oracle hub is used to push prices to the oracle Spoke. We can create a fake price, set it in the mock
      // oracle hub and then try send it to the oracle spoke via the publish price method. To validate the correctness
      // of this action we can check what data is sent to the l1CrossDomainMessengerMock, which passes messages between
      // L1 and L2.
      const pushedPrice = toWei("1234");
      const priceTime = 1234;
      await mockOracle.methods.requestPrice(priceIdentifier, priceTime, ancillaryData).send({ from: l1Owner });
      await mockOracle.methods
        .pushPrice(priceIdentifier, priceTime, ancillaryData, pushedPrice)
        .send({ from: l1Owner });
      const txn = await oracleHub.methods
        .publishPrice(chainId, priceIdentifier, priceTime, ancillaryData)
        .send({ from: l1Owner });

      // We should be able to re-construct the encoded data, which should match what was sent from the messenger.
      const encodedData = web3.eth.abi.encodeParameters(
        ["bytes32", "uint256", "bytes", "int256"],
        [priceIdentifier, priceTime, ancillaryData, pushedPrice]
      );
      const childMessengerInterface = await Optimism_ChildMessenger.at(ZERO_ADDRESS);
      const expectedMessageFromManualEncoding = await await childMessengerInterface.methods
        .processMessageFromCrossChainParent(encodedData, oracleSpokeAddress)
        .encodeABI();

      // Validate that the l1CrossDomainMessengerMock received the expected cross-domain message, destined for the child.
      expect(l1CrossDomainMessengerMock.sendMessage).to.have.been.calledOnce;
      expect(l1CrossDomainMessengerMock.sendMessage.getCall(0).args._target).to.equal(childMessengerAddress);
      expect(l1CrossDomainMessengerMock.sendMessage.getCall(0).args._message).to.equal(
        expectedMessageFromManualEncoding
      );

      await assertEventEmitted(txn, optimism_ParentMessenger, "MessageSentToChild", (ev) => {
        return (
          ev.data == expectedMessageFromManualEncoding &&
          ev.childMessenger == childMessengerAddress &&
          ev.gasLimit.toString() == "5000000" &&
          ev.targetSpoke == oracleSpokeAddress
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

      const txn = await governorHub.methods.relayGovernance(chainId, call).send({ from: l1Owner });

      // Validate that the l1CrossDomainMessengerMock received the expected cross-domain message, destine for the child.
      // There should be only one call to sendMessage.
      expect(l1CrossDomainMessengerMock.sendMessage).to.have.been.calledOnce;

      // Target should be the child messenger.
      expect(l1CrossDomainMessengerMock.sendMessage.getCall(0).args._target).to.be.equal(childMessengerAddress);

      // Grab the data emitted from the mock Oracle hub. This contains the dataSentToChild.
      const emittedData = await governorHub.getPastEvents("RelayedGovernanceRequest", {
        fromBlock: 0,
        toBlock: "latest",
      });

      const targetDataSentFromGovernorHub = emittedData[0].returnValues.dataSentToChild;

      // Generate the target message data that should have been forwarded to the Child messenger interface from the
      // Optimism Parent messenger within the sendMessageToChild function call.
      const childMessengerInterface = await Optimism_ChildMessenger.at(ZERO_ADDRESS);
      const expectedMessageFromEvent = childMessengerInterface.methods
        .processMessageFromCrossChainParent(targetDataSentFromGovernorHub, governorSpokeAddress) // note the oracleSpokeAddress for the target in the message
        .encodeABI();

      expect(l1CrossDomainMessengerMock.sendMessage.getCall(0).args._message).to.be.equal(expectedMessageFromEvent);

      // Re-construct the data that the Governor hub should have sent to the child.the mock.
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
      const expectedMessageFromManualEncoding = childMessengerInterface.methods
        .processMessageFromCrossChainParent(encodedData, governorSpokeAddress)
        .encodeABI();
      expect(l1CrossDomainMessengerMock.sendMessage.getCall(0).args._message).to.be.equal(
        expectedMessageFromManualEncoding
      );

      await assertEventEmitted(txn, optimism_ParentMessenger, "MessageSentToChild", (ev) => {
        return (
          ev.data == expectedMessageFromManualEncoding &&
          ev.childMessenger == childMessengerAddress &&
          ev.gasLimit.toString() == "5000000" &&
          ev.targetSpoke == governorSpokeAddress
        );
      });
    });
    it("setChildParentMessenger", async () => {
      const setChildParentMessenger = optimism_ParentMessenger.methods.setChildParentMessenger(rando);

      // Can only call as owner
      assert(await didContractThrow(setChildParentMessenger.send({ from: rando })));

      const txn = await setChildParentMessenger.send({ from: l1Owner });

      // Validate that the inbox received the expected cross-domain message, destined for the child.
      // There should be only one call to sendMessage.
      expect(l1CrossDomainMessengerMock.sendMessage).to.have.been.calledOnce;

      // Target should be the child messenger.
      expect(l1CrossDomainMessengerMock.sendMessage.getCall(0).args._target).to.equal(childMessengerAddress);

      // We should be able to re-construct the encoded data, which should match what was sent from the messenger.
      const childMessengerInterface = await Optimism_ChildMessenger.at(ZERO_ADDRESS);
      const expectedMessageFromManualEncoding = await childMessengerInterface.methods
        .setParentMessenger(rando)
        .encodeABI();
      expect(l1CrossDomainMessengerMock.sendMessage.getCall(0).args._message).to.equal(
        expectedMessageFromManualEncoding
      );

      await assertEventEmitted(txn, optimism_ParentMessenger, "MessageSentToChild", (ev) => {
        return (
          ev.data == expectedMessageFromManualEncoding &&
          ev.childMessenger == childMessengerAddress &&
          ev.gasLimit.toString() == defaultGasLimit.toString() &&
          ev.targetSpoke == ZERO_ADDRESS
        );
      });
    });
    it("setChildOracleSpoke", async () => {
      const setChildOracleSpoke = optimism_ParentMessenger.methods.setChildOracleSpoke(rando);

      // Can only call as owner
      assert(await didContractThrow(setChildOracleSpoke.send({ from: rando })));

      const txn = await setChildOracleSpoke.send({ from: l1Owner });

      // Validate that the inbox received the expected cross-domain message, destined for the child.
      // There should be only one call to sendMessage.
      expect(l1CrossDomainMessengerMock.sendMessage).to.have.been.calledOnce;

      // Target should be the child messenger.
      expect(l1CrossDomainMessengerMock.sendMessage.getCall(0).args._target).is.equal(childMessengerAddress);

      // We should be able to re-construct the encoded data, which should match what was sent from the messenger.
      const childMessengerInterface = await Optimism_ChildMessenger.at(ZERO_ADDRESS);
      const expectedMessageFromManualEncoding = await childMessengerInterface.methods.setOracleSpoke(rando).encodeABI();
      expect(l1CrossDomainMessengerMock.sendMessage.getCall(0).args._message).is.equal(
        expectedMessageFromManualEncoding
      );

      await assertEventEmitted(txn, optimism_ParentMessenger, "MessageSentToChild", (ev) => {
        return (
          ev.data == expectedMessageFromManualEncoding &&
          ev.childMessenger == childMessengerAddress &&
          ev.gasLimit.toString() == defaultGasLimit.toString() &&
          ev.targetSpoke == ZERO_ADDRESS
        );
      });
    });
    it("setChildDefaultGasLimit", async () => {
      const setChildDefaultGasLimit = optimism_ParentMessenger.methods.setChildDefaultGasLimit("100");

      // Can only call as owner
      assert(await didContractThrow(setChildDefaultGasLimit.send({ from: rando })));

      const txn = await setChildDefaultGasLimit.send({ from: l1Owner });

      // Validate that the inbox received the expected cross-domain message, destined for the child.
      // There should be only one call to sendMessage.
      expect(l1CrossDomainMessengerMock.sendMessage).has.been.calledOnce;

      // Target should be the child messenger.
      expect(l1CrossDomainMessengerMock.sendMessage.getCall(0).args._target).is.equal(childMessengerAddress);

      // We should be able to re-construct the encoded data, which should match what was sent from the messenger.
      const childMessengerInterface = await Optimism_ChildMessenger.at(ZERO_ADDRESS);
      const expectedMessageFromManualEncoding = await childMessengerInterface.methods
        .setDefaultGasLimit("100")
        .encodeABI();
      expect(l1CrossDomainMessengerMock.sendMessage.getCall(0).args._message).is.equal(
        expectedMessageFromManualEncoding
      );

      await assertEventEmitted(txn, optimism_ParentMessenger, "MessageSentToChild", (ev) => {
        return (
          ev.data == expectedMessageFromManualEncoding &&
          ev.childMessenger == childMessengerAddress &&
          ev.gasLimit.toString() == defaultGasLimit.toString() &&
          ev.targetSpoke == ZERO_ADDRESS
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
      const messageFromChildTx = optimism_ParentMessenger.methods.processMessageFromCrossChainChild(sentData);

      // Calling from some EOA on L1 should fail.
      assert(await didContractThrow(messageFromChildTx.send({ from: rando })));

      // Calling via the canonical bridge but with the wrong cross-domain messenger address should also fail.
      l1CrossDomainMessengerMock.xDomainMessageSender.returns(() => rando);
      assert(await didContractThrow(messageFromChildTx.send({ from: l1CrossDomainMessengerMock.options.address })));

      // calling via the child messenger (the only address that should be able to call this method) should work.
      l1CrossDomainMessengerMock.xDomainMessageSender.returns(() => childMessengerAddress);
      const tx = await messageFromChildTx.send({ from: l1CrossDomainMessengerMock.options.address });

      await assertEventEmitted(tx, optimism_ParentMessenger, "MessageReceivedFromChild", (ev) => {
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

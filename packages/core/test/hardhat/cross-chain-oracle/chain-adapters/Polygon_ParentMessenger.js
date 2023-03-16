const hre = require("hardhat");
const { web3, assertEventEmitted, getContract } = hre;
const { assert, expect } = require("chai");

const { didContractThrow } = require("@uma/common");

const { deployContractMock } = require("../../helpers/SmockitHelper");

// Tested Contract
const Polygon_ParentMessenger = getContract("Polygon_ParentMessengerMock");

// Create some random accounts to mimic key cross-chain oracle addresses that are not deployed in these tests.
let fxChildAddress,
  oracleSpokeAddress,
  governorSpokeAddress,
  checkpointManagerAddress,
  oracleHubAddress,
  governorHubAddress;

// Re-used variables
let deployer;
let messenger;
let fxRoot;
let oracleHubSmocked;
const childChainId = "80001";

describe("Polygon_ParentMessenger", function () {
  beforeEach(async () => {
    const accounts = await hre.web3.eth.getAccounts();
    [
      deployer,
      fxChildAddress,
      oracleSpokeAddress,
      governorSpokeAddress,
      checkpointManagerAddress,
      oracleHubAddress,
      governorHubAddress,
    ] = accounts;

    // Parent messenger calls `sendMessageToChild()` on this FxRoot, so we'll check that its called with the
    // correct input.
    fxRoot = await deployContractMock("FxRoot", {}, getContract("FxRootMock"));

    messenger = await Polygon_ParentMessenger.new(
      checkpointManagerAddress, // FxChild is normally a Polygon system contract, but it is unused in this test and can be
      // set to some arbitrary EOA.
      fxRoot.options.address,
      childChainId
    ).send({ from: deployer });
    await messenger.methods.setFxChildTunnel(fxChildAddress).send({ from: deployer });
    await messenger.methods.setOracleHub(oracleHubAddress).send({ from: deployer });
    await messenger.methods.setGovernorHub(governorHubAddress).send({ from: deployer });
    await messenger.methods.setOracleSpoke(oracleSpokeAddress).send({ from: deployer });
    await messenger.methods.setGovernorSpoke(governorSpokeAddress).send({ from: deployer });

    // Child messenger calls `processMessageFromParent()` on this OracleHub, so we'll check that its called with the
    // correct input.
    oracleHubSmocked = await deployContractMock("OracleHub", {}, getContract("OracleHub"));
  });
  it("sendMessageToChild", async function () {
    const dataToSendToChild = "0xdeadbeef";
    const sendMessage = messenger.methods.sendMessageToChild(dataToSendToChild);

    // Callable only by a hub contract stored in contract.
    assert(await didContractThrow(sendMessage.send({ from: deployer })));

    // Called by OracleHub sends data to OracleSpoke
    let txn = await sendMessage.send({ from: oracleHubAddress });

    // Check events are emitted
    let expectedMessageSentData = web3.eth.abi.encodeParameters(
      ["bytes", "address"],
      [
        dataToSendToChild,
        oracleSpokeAddress, // This address is variable depending on which hub called the method.
      ]
    );
    await assertEventEmitted(txn, messenger, "MessageSentToChild", (ev) => {
      return ev.data === expectedMessageSentData && ev.targetSpoke === oracleSpokeAddress;
    });

    // Check that FxRoot function is called with correct params
    expect(fxRoot.sendMessageToChild.getCall(0).args._receiver).to.equal(fxChildAddress);
    expect(fxRoot.sendMessageToChild.getCall(0).args._data).to.equal(expectedMessageSentData);

    // Called by GovernorHub sends data to GovernorSpoke
    txn = await sendMessage.send({ from: governorHubAddress });

    // Check events are emitted
    expectedMessageSentData = web3.eth.abi.encodeParameters(
      ["bytes", "address"],
      [
        dataToSendToChild,
        governorSpokeAddress, // This address is variable depending on which hub called the method.
      ]
    );
    await assertEventEmitted(txn, messenger, "MessageSentToChild", (ev) => {
      return ev.data === expectedMessageSentData && ev.targetSpoke === governorSpokeAddress;
    });

    // Check that FxRoot function is called with correct params
    expect(fxRoot.sendMessageToChild.getCall(1).args._receiver).to.equal(fxChildAddress);
    expect(fxRoot.sendMessageToChild.getCall(1).args._data).to.equal(expectedMessageSentData);
  });
  it("_processMessageFromChild", async function () {
    // Data to pass into this method includes: (1) the data to send to the target and (2) the target contract
    // to call `processMessageFromChild` on with the data from (1). We'll use the smocked contract as the target
    // and test that `processMessageFromChild` is called with the encoded data (1).
    const dataToSendToTarget = "0xdeadbeef";
    const data = web3.eth.abi.encodeParameters(
      ["bytes", "address"],
      [dataToSendToTarget, oracleHubSmocked.options.address]
    );

    const txn = await messenger.methods.processMessageFromChild(data).send({ from: deployer });

    // Check that oracle hub is called as expected
    expect(oracleHubSmocked.processMessageFromChild.getCall(0).args.chainId.toString()).to.equal(childChainId);
    expect(oracleHubSmocked.processMessageFromChild.getCall(0).args.data).to.equal(dataToSendToTarget);

    // Check events are emitted
    await assertEventEmitted(txn, messenger, "MessageReceivedFromChild", (ev) => {
      return ev.targetHub === oracleHubSmocked.options.address && ev.dataToSendToTarget === dataToSendToTarget;
    });
  });
});

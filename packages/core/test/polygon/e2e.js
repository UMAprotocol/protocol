const { ZERO_ADDRESS, interfaceName, RegistryRolesEnum, didContractThrow } = require("@uma/common");
const { assert } = require("chai");
const TruffleAssert = require("truffle-assertions");

const { utf8ToHex, toWei, hexToUtf8 } = web3.utils;

const StateSync = artifacts.require("StateSyncMock");
const FxChild = artifacts.require("FxChildMock");
const FxRoot = artifacts.require("FxRootMock");
const OracleChildTunnel = artifacts.require("OracleChildTunnel");
// We use the a mock contract for the `OracleRootTunnel`because it has an internal `_processMessageFromChild` that we
// want to test directly, whereas the corresponding  `_processMessageFromRoot` on the `OracleChildTunnel` gets tested
// via `FxChildMock.onStateReceive`.
const OracleRootTunnel = artifacts.require("OracleRootTunnelMock");
const Finder = artifacts.require("Finder");
const Registry = artifacts.require("Registry");
const MockOracle = artifacts.require("MockOracleAncillary");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");

contract("Polygon <> Ethereum Tunnel: End-to-End Test", async (accounts) => {
  const owner = accounts[0];
  const systemSuperUser = accounts[1];
  const checkpointManager = accounts[2];
  const rando = accounts[3];

  let stateSync;
  let fxChild;
  let fxRoot;
  let oracleChild;
  let oracleRoot;

  // Oracle system:
  let finder;
  let identifierWhitelist;
  let registry;
  let mockOracle;

  const testIdentifier = utf8ToHex("TEST");
  const testTimestamp = 100;
  const testAncillaryData = utf8ToHex("key:value");
  const testPrice = toWei("0.5");
  let expectedStampedAncillaryData; // Can determine this after contracts are deployed.
  const expectedStateId = "1";
  const childChainId = "31337";

  before(async function () {
    finder = await Finder.deployed();
    identifierWhitelist = await IdentifierWhitelist.deployed();
    registry = await Registry.deployed();
    mockOracle = await MockOracle.new(finder.address, ZERO_ADDRESS);

    await finder.changeImplementationAddress(utf8ToHex(interfaceName.Oracle), mockOracle.address);

    await registry.addMember(RegistryRolesEnum.CONTRACT_CREATOR, owner);
    await registry.registerContract([], owner, { from: owner });

    await identifierWhitelist.addSupportedIdentifier(testIdentifier, { from: owner });
  });
  beforeEach(async function () {
    // Set up mocked Fx tunnel system:
    stateSync = await StateSync.new();
    fxRoot = await FxRoot.new(stateSync.address);
    fxChild = await FxChild.new(systemSuperUser);
    await fxChild.setFxRoot(fxRoot.address);
    await fxRoot.setFxChild(fxChild.address);

    // Set up Oracle tunnel system:
    oracleChild = await OracleChildTunnel.new(fxChild.address, finder.address);
    oracleRoot = await OracleRootTunnel.new(checkpointManager, fxRoot.address, finder.address);
    await oracleChild.setFxRootTunnel(oracleRoot.address);
    await oracleRoot.setFxChildTunnel(oracleChild.address);
    await registry.registerContract([], oracleRoot.address, { from: owner });

    // The OracleChildTunnel should stamp ",childRequester:<requester-address>,childChainId:<chain-id>" to the original
    // ancillary data.
    expectedStampedAncillaryData = utf8ToHex(
      `${hexToUtf8(testAncillaryData)},childRequester:${owner.substr(2).toLowerCase()},childChainId:${childChainId}`
    );
  });
  it("request price from Polygon to Ethereum, resolve price from Ethereum to Polygon", async function () {
    // Only registered caller can call.
    assert(
      await didContractThrow(
        oracleChild.requestPrice(testIdentifier, testTimestamp, testAncillaryData, { from: rando })
      )
    );

    // Should emit MessageSent event with ABI encoded requestPrice parameters.
    let txn = await oracleChild.requestPrice(testIdentifier, testTimestamp, testAncillaryData, { from: owner });
    let messageBytes = web3.eth.abi.encodeParameters(
      ["bytes32", "uint256", "bytes"],
      [testIdentifier, testTimestamp, expectedStampedAncillaryData]
    );
    TruffleAssert.eventEmitted(
      txn,
      "PriceRequestAdded",
      (event) =>
        hexToUtf8(event.identifier) === hexToUtf8(testIdentifier) &&
        event.time.toString() === testTimestamp.toString() &&
        event.ancillaryData.toLowerCase() === expectedStampedAncillaryData.toLowerCase()
    );
    TruffleAssert.eventEmitted(txn, "MessageSent", (event) => event.message === messageBytes);

    // Off-chain bridge should be able to use bytes message as input into _processMessageFromChild on RootTunnel to
    // trigger a price request to the DVM:
    txn = await oracleRoot.processMessageFromChild(messageBytes);
    TruffleAssert.eventEmitted(
      txn,
      "PriceRequestAdded",
      (event) =>
        hexToUtf8(event.identifier) === hexToUtf8(testIdentifier) &&
        event.time.toString() === testTimestamp.toString() &&
        event.ancillaryData.toLowerCase() === expectedStampedAncillaryData.toLowerCase()
    );

    // We should be able to resolve price now and emit message to send back to Polygon:
    await mockOracle.pushPrice(testIdentifier, testTimestamp, expectedStampedAncillaryData, testPrice);
    txn = await oracleRoot.publishPrice(testIdentifier, testTimestamp, expectedStampedAncillaryData);
    TruffleAssert.eventEmitted(
      txn,
      "PushedPrice",
      (event) =>
        hexToUtf8(event.identifier) === hexToUtf8(testIdentifier) &&
        event.time.toString() === testTimestamp.toString() &&
        event.ancillaryData.toLowerCase() === expectedStampedAncillaryData.toLowerCase() &&
        event.price.toString() === testPrice
    );
    let internalTxn = await TruffleAssert.createTransactionResult(stateSync, txn.tx);
    // FxRoot packs the publishPrice ABI-encoded paramaters with additional data:
    // i.e. abi.encode(sender,receiver,message)
    const expectedFxChildData = web3.eth.abi.encodeParameters(
      ["address", "address", "bytes"],
      [
        oracleRoot.address,
        oracleChild.address,
        web3.eth.abi.encodeParameters(
          ["bytes32", "uint256", "bytes", "int256"],
          [testIdentifier, testTimestamp, expectedStampedAncillaryData, testPrice]
        ),
      ]
    );
    TruffleAssert.eventEmitted(
      internalTxn,
      "StateSynced",
      (event) =>
        event.id.toString() === expectedStateId &&
        event.contractAddress === fxChild.address &&
        event.data === expectedFxChildData
    );

    // Until price is resolved on Child, hasPrice and getPrice should return false and revert, respectively.
    assert.isFalse(await oracleChild.hasPrice(testIdentifier, testTimestamp, testAncillaryData, { from: owner }));
    assert(
      await didContractThrow(oracleChild.getPrice(testIdentifier, testTimestamp, testAncillaryData, { from: owner }))
    );

    // Off-chain bridge picks up StateSynced event and forwards to Child receiver on Polygon.
    txn = await fxChild.onStateReceive(expectedStateId, expectedFxChildData, { from: systemSuperUser });
    internalTxn = await TruffleAssert.createTransactionResult(oracleChild, txn.tx);
    TruffleAssert.eventEmitted(
      internalTxn,
      "PushedPrice",
      (event) =>
        hexToUtf8(event.identifier) === hexToUtf8(testIdentifier) &&
        event.time.toString() === testTimestamp.toString() &&
        event.ancillaryData.toLowerCase() === expectedStampedAncillaryData.toLowerCase() &&
        event.price.toString() === testPrice
    );

    // hasPrice and getPrice should now succeed.
    // Note: the ancillary data input into hasPrice and getPrice is the original, pre-stamped ancillary data, which
    // means that the original requester does not know about the ancillary data stamping that took place behind the
    // scene.
    assert.isTrue(await oracleChild.hasPrice(testIdentifier, testTimestamp, testAncillaryData, { from: owner }));
    assert.equal(
      (await oracleChild.getPrice(testIdentifier, testTimestamp, testAncillaryData, { from: owner })).toString(),
      testPrice.toString()
    );
  });
});

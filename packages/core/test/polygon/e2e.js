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
const ExpandedERC20 = artifacts.require("ExpandedERC20");
const GovernorChildTunnel = artifacts.require("GovernorChildTunnel");
const GovernorRootTunnel = artifacts.require("GovernorRootTunnel");

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
  let governorChild;
  let governorRoot;

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

  beforeEach(async function () {
    finder = await Finder.deployed();
    identifierWhitelist = await IdentifierWhitelist.deployed();
    registry = await Registry.deployed();
    mockOracle = await MockOracle.new(finder.address, ZERO_ADDRESS);

    await finder.changeImplementationAddress(utf8ToHex(interfaceName.Oracle), mockOracle.address);

    await registry.addMember(RegistryRolesEnum.CONTRACT_CREATOR, owner);
    await registry.registerContract([], owner, { from: owner });

    await identifierWhitelist.addSupportedIdentifier(testIdentifier, { from: owner });

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

    // Set up Governor tunnel system
    governorChild = await GovernorChildTunnel.new(fxChild.address);
    governorRoot = await GovernorRootTunnel.new(checkpointManager, fxRoot.address, { from: owner });
    await governorChild.setFxRootTunnel(governorRoot.address);
    await governorRoot.setFxChildTunnel(governorChild.address);

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
  it("relay governance transaction from Ethereum to Polygon", async function () {
    // Deploy an ERC20 so the child governor tunnel contract has something to act on.
    const erc20 = await ExpandedERC20.new("Test Token", "TEST", 18);
    await erc20.addMember(1, owner);
    await erc20.mint(governorChild.address, toWei("1"));

    // Governance action to transfer 1 token.
    const innerTransactionCalldata = erc20.contract.methods.transfer(rando, toWei("1")).encodeABI();

    // Only owner can relay governance:
    assert(
      await didContractThrow(
        governorRoot.relayGovernance(erc20.address, innerTransactionCalldata, {
          from: rando,
        })
      )
    );
    let txn = await governorRoot.relayGovernance(erc20.address, innerTransactionCalldata, {
      from: owner,
    });

    // Should emit event with governance transaction calldata.
    TruffleAssert.eventEmitted(
      txn,
      "RelayedGovernanceRequest",
      (event) => event.to.toLowerCase() === erc20.address.toLowerCase() && event.data === innerTransactionCalldata
    );
    let internalTxn = await TruffleAssert.createTransactionResult(stateSync, txn.tx);
    // FxRoot packs the publishPrice ABI-encoded paramaters with additional data:
    // i.e. abi.encode(sender,receiver,message)
    let messageBytes = web3.eth.abi.encodeParameters(["address", "bytes"], [erc20.address, innerTransactionCalldata]);
    const expectedFxChildData = web3.eth.abi.encodeParameters(
      ["address", "address", "bytes"],
      [governorRoot.address, governorChild.address, messageBytes]
    );
    TruffleAssert.eventEmitted(
      internalTxn,
      "StateSynced",
      (event) =>
        event.id.toString() === expectedStateId &&
        event.contractAddress === fxChild.address &&
        event.data === expectedFxChildData
    );

    // Off-chain bridge picks up StateSynced event and forwards to Child receiver on Polygon.
    txn = await fxChild.onStateReceive(expectedStateId, expectedFxChildData, { from: systemSuperUser });
    internalTxn = await TruffleAssert.createTransactionResult(governorChild, txn.tx);
    TruffleAssert.eventEmitted(
      internalTxn,
      "ExecutedGovernanceTransaction",
      (event) => event.to.toLowerCase() === erc20.address.toLowerCase() && event.data === innerTransactionCalldata
    );

    // Child should have transferred tokens, per the governance transaction.
    assert.equal((await erc20.balanceOf(rando)).toString(), web3.utils.toWei("1"));
    assert.equal((await erc20.balanceOf(governorChild.address)).toString(), "0");
  });
});

const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract, assertEventEmitted } = hre;
const { ZERO_ADDRESS, interfaceName, RegistryRolesEnum, didContractThrow } = require("@uma/common");
const { assert } = require("chai");

const { utf8ToHex, toWei, hexToUtf8 } = web3.utils;

const StateSync = getContract("StateSyncMock");
const FxChild = getContract("FxChildMock");
const FxRoot = getContract("FxRootMock");
const OracleChildTunnel = getContract("OracleChildTunnel");
// We use the a mock contract for the `OracleRootTunnel`because it has an internal `_processMessageFromChild` that we
// want to test directly, whereas the corresponding  `_processMessageFromRoot` on the `OracleChildTunnel` gets tested
// via `FxChildMock.onStateReceive`.
const OracleRootTunnel = getContract("OracleRootTunnelMock");
const Finder = getContract("Finder");
const Registry = getContract("Registry");
const MockOracle = getContract("MockOracleAncillary");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const ExpandedERC20 = getContract("ExpandedERC20");
const GovernorChildTunnel = getContract("GovernorChildTunnel");
const GovernorRootTunnel = getContract("GovernorRootTunnel");

describe("Polygon <> Ethereum Tunnel: End-to-End Test", async () => {
  let accounts;
  let owner;
  let systemSuperUser;
  let checkpointManager;
  let rando;

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

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [owner, systemSuperUser, checkpointManager, rando] = accounts;
    await runDefaultFixture(hre);
    finder = await Finder.deployed();
    identifierWhitelist = await IdentifierWhitelist.deployed();
    registry = await Registry.deployed();
    mockOracle = await MockOracle.new(finder.options.address, ZERO_ADDRESS).send({ from: accounts[0] });

    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Oracle), mockOracle.options.address)
      .send({ from: accounts[0] });

    await registry.methods.addMember(RegistryRolesEnum.CONTRACT_CREATOR, owner).send({ from: accounts[0] });
    await registry.methods.registerContract([], owner).send({ from: owner });

    await identifierWhitelist.methods.addSupportedIdentifier(testIdentifier).send({ from: owner });
  });

  beforeEach(async function () {
    // Set up mocked Fx tunnel system:
    stateSync = await StateSync.new().send({ from: accounts[0] });
    fxRoot = await FxRoot.new(stateSync.options.address).send({ from: accounts[0] });
    fxChild = await FxChild.new(systemSuperUser).send({ from: accounts[0] });
    await fxChild.methods.setFxRoot(fxRoot.options.address).send({ from: accounts[0] });
    await fxRoot.methods.setFxChild(fxChild.options.address).send({ from: accounts[0] });

    // Set up Oracle tunnel system:
    oracleChild = await OracleChildTunnel.new(fxChild.options.address, finder.options.address).send({
      from: accounts[0],
    });
    oracleRoot = await OracleRootTunnel.new(checkpointManager, fxRoot.options.address, finder.options.address).send({
      from: accounts[0],
    });
    await oracleChild.methods.setFxRootTunnel(oracleRoot.options.address).send({ from: accounts[0] });
    await oracleRoot.methods.setFxChildTunnel(oracleChild.options.address).send({ from: accounts[0] });
    await registry.methods.registerContract([], oracleRoot.options.address).send({ from: owner });

    // Set up Governor tunnel system
    governorChild = await GovernorChildTunnel.new(fxChild.options.address).send({ from: accounts[0] });
    governorRoot = await GovernorRootTunnel.new(checkpointManager, fxRoot.options.address).send({ from: owner });
    await governorChild.methods.setFxRootTunnel(governorRoot.options.address).send({ from: accounts[0] });
    await governorRoot.methods.setFxChildTunnel(governorChild.options.address).send({ from: accounts[0] });

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
        oracleChild.methods.requestPrice(testIdentifier, testTimestamp, testAncillaryData).send({ from: rando })
      )
    );

    // Should emit MessageSent event with ABI encoded requestPrice parameters.
    let txn = await oracleChild.methods
      .requestPrice(testIdentifier, testTimestamp, testAncillaryData)
      .send({ from: owner });
    let messageBytes = web3.eth.abi.encodeParameters(
      ["bytes32", "uint256", "bytes"],
      [testIdentifier, testTimestamp, expectedStampedAncillaryData]
    );
    await assertEventEmitted(
      txn,
      oracleChild,
      "PriceRequestAdded",
      (event) =>
        hexToUtf8(event.identifier) === hexToUtf8(testIdentifier) &&
        event.time.toString() === testTimestamp.toString() &&
        event.ancillaryData.toLowerCase() === expectedStampedAncillaryData.toLowerCase()
    );
    await assertEventEmitted(txn, oracleChild, "MessageSent", (event) => event.message === messageBytes);

    // Off-chain bridge should be able to use bytes message as input into _processMessageFromChild on RootTunnel to
    // trigger a price request to the DVM:
    txn = await oracleRoot.methods.processMessageFromChild(messageBytes).send({ from: accounts[0] });
    await assertEventEmitted(
      txn,
      oracleRoot,
      "PriceRequestAdded",
      (event) =>
        hexToUtf8(event.identifier) === hexToUtf8(testIdentifier) &&
        event.time.toString() === testTimestamp.toString() &&
        event.ancillaryData.toLowerCase() === expectedStampedAncillaryData.toLowerCase()
    );

    // We should be able to resolve price now and emit message to send back to Polygon:
    await mockOracle.methods
      .pushPrice(testIdentifier, testTimestamp, expectedStampedAncillaryData, testPrice)
      .send({ from: accounts[0] });
    txn = await oracleRoot.methods
      .publishPrice(testIdentifier, testTimestamp, expectedStampedAncillaryData)
      .send({ from: accounts[0] });
    await assertEventEmitted(
      txn,
      oracleRoot,
      "PushedPrice",
      (event) =>
        hexToUtf8(event.identifier) === hexToUtf8(testIdentifier) &&
        event.time.toString() === testTimestamp.toString() &&
        event.ancillaryData.toLowerCase() === expectedStampedAncillaryData.toLowerCase() &&
        event.price.toString() === testPrice
    );
    // FxRoot packs the publishPrice ABI-encoded paramaters with additional data:
    // i.e. abi.encode(sender,receiver,message)
    const expectedFxChildData = web3.eth.abi.encodeParameters(
      ["address", "address", "bytes"],
      [
        oracleRoot.options.address,
        oracleChild.options.address,
        web3.eth.abi.encodeParameters(
          ["bytes32", "uint256", "bytes", "int256"],
          [testIdentifier, testTimestamp, expectedStampedAncillaryData, testPrice]
        ),
      ]
    );
    await assertEventEmitted(
      txn,
      stateSync,
      "StateSynced",
      (event) =>
        event.id.toString() === expectedStateId &&
        event.contractAddress === fxChild.options.address &&
        event.data === expectedFxChildData
    );

    // Until price is resolved on Child, hasPrice and getPrice should return false and revert, respectively.
    assert.isFalse(
      await oracleChild.methods.hasPrice(testIdentifier, testTimestamp, testAncillaryData).call({ from: owner })
    );
    assert(
      await didContractThrow(
        oracleChild.methods.getPrice(testIdentifier, testTimestamp, testAncillaryData).send({ from: owner })
      )
    );

    // Off-chain bridge picks up StateSynced event and forwards to Child receiver on Polygon.
    txn = await fxChild.methods.onStateReceive(expectedStateId, expectedFxChildData).send({ from: systemSuperUser });
    await assertEventEmitted(
      txn,
      oracleChild,
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
    assert.isTrue(
      await oracleChild.methods.hasPrice(testIdentifier, testTimestamp, testAncillaryData).call({ from: owner })
    );
    assert.equal(
      (
        await oracleChild.methods.getPrice(testIdentifier, testTimestamp, testAncillaryData).call({ from: owner })
      ).toString(),
      testPrice.toString()
    );
  });
  it("relay governance transaction from Ethereum to Polygon", async function () {
    // Deploy an ERC20 so the child governor tunnel contract has something to act on.
    const erc20 = await ExpandedERC20.new("Test Token", "TEST", 18).send({ from: accounts[0] });
    await erc20.methods.addMember(1, owner).send({ from: accounts[0] });
    await erc20.methods.mint(governorChild.options.address, toWei("1")).send({ from: accounts[0] });

    // Governance action to transfer 1 token.
    const innerTransactionCalldata = erc20.methods.transfer(rando, toWei("1")).encodeABI();

    // Only owner can relay governance:
    assert(
      await didContractThrow(
        governorRoot.methods.relayGovernance(erc20.options.address, innerTransactionCalldata).send({ from: rando })
      )
    );
    let txn = await governorRoot.methods
      .relayGovernance(erc20.options.address, innerTransactionCalldata)
      .send({ from: owner });

    // Should emit event with governance transaction calldata.
    await assertEventEmitted(
      txn,
      governorRoot,
      "RelayedGovernanceRequest",
      (event) =>
        event.to.toLowerCase() === erc20.options.address.toLowerCase() && event.data === innerTransactionCalldata
    );
    // FxRoot packs the publishPrice ABI-encoded paramaters with additional data:
    // i.e. abi.encode(sender,receiver,message)
    let messageBytes = web3.eth.abi.encodeParameters(
      ["address", "bytes"],
      [erc20.options.address, innerTransactionCalldata]
    );
    const expectedFxChildData = web3.eth.abi.encodeParameters(
      ["address", "address", "bytes"],
      [governorRoot.options.address, governorChild.options.address, messageBytes]
    );
    await assertEventEmitted(
      txn,
      stateSync,
      "StateSynced",
      (event) =>
        event.id.toString() === expectedStateId &&
        event.contractAddress === fxChild.options.address &&
        event.data === expectedFxChildData
    );

    // Off-chain bridge picks up StateSynced event and forwards to Child receiver on Polygon.
    txn = await fxChild.methods.onStateReceive(expectedStateId, expectedFxChildData).send({ from: systemSuperUser });
    await assertEventEmitted(
      txn,
      governorChild,
      "ExecutedGovernanceTransaction",
      (event) =>
        event.to.toLowerCase() === erc20.options.address.toLowerCase() && event.data === innerTransactionCalldata
    );

    // Child should have transferred tokens, per the governance transaction.
    assert.equal((await erc20.methods.balanceOf(rando).call()).toString(), web3.utils.toWei("1"));
    assert.equal((await erc20.methods.balanceOf(governorChild.options.address).call()).toString(), "0");
  });
});

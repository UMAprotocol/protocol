import winston from "winston";
import { assert, web3 } from "hardhat";
import { Contract } from "web3-eth-contract";
import { getTruffleContract } from "@uma/core";
import sinon from "sinon";
import { Relayer } from "../src/Relayer";
import { SpyTransport, GasEstimator, lastSpyLogIncludes } from "@uma/financial-templates-lib";
import { ZERO_ADDRESS, interfaceName, RegistryRolesEnum } from "@uma/common";

const { utf8ToHex, hexToUtf8 } = web3.utils;
const Finder = getTruffleContract("Finder", web3);
const OracleChildTunnel = getTruffleContract("OracleChildTunnel", web3);
const Registry = getTruffleContract("Registry", web3);
const OracleRootTunnel = getTruffleContract("OracleRootTunnelMock", web3);
const MockOracle = getTruffleContract("MockOracleAncillary", web3);
const StateSync = getTruffleContract("StateSyncMock", web3);
const FxChild = getTruffleContract("FxChildMock", web3);
const FxRoot = getTruffleContract("FxRootMock", web3);

// This function should return a bytes string.
type customPayloadFn = () => Promise<string>;
interface MaticPosClient {
  posRootChainManager: {
    customPayload: customPayloadFn;
  };
}
describe("Relayer unit tests", function () {
  let spyLogger: any;
  let spy: any;
  let gasEstimator: any;
  let systemSuperUser: string;
  let checkpointManager: string;
  let owner: any;
  let maticPosClient: MaticPosClient;
  const testIdentifier = utf8ToHex("TEST");
  const testTimestamp = 100;
  const testAncillaryData = utf8ToHex("key:value");
  let expectedStampedAncillaryData: string; // Can determine this after OracleChildTunnel is deployed.
  const childChainId = "31337";

  // Tested relayer:
  let relayer: any;

  // Contracts
  let finder: any;
  let oracleChild: Contract;
  let oracleRoot: Contract;
  let registry: any;
  let mockOracle: any;
  let stateSync: any;
  let fxRoot: any;
  let fxChild: any;

  before(async function () {
    [owner, systemSuperUser, checkpointManager] = await web3.eth.getAccounts();

    // Note: We deploy all contracts on local hardhat network to make testing more convenient.

    // Set up mocked Fx tunnel:
    stateSync = await StateSync.new();
    fxRoot = await FxRoot.new(stateSync.address);
    fxChild = await FxChild.new(systemSuperUser);
    await fxChild.setFxRoot(fxRoot.address, { from: owner });
    await fxRoot.setFxChild(fxChild.address, { from: owner });

    // Set up mocked Oracle infrastructure
    finder = await Finder.new();
    mockOracle = await MockOracle.new(finder.address, ZERO_ADDRESS);
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.Oracle), mockOracle.address);
    registry = await Registry.new();
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.Registry), registry.address);
    await registry.addMember(RegistryRolesEnum.CONTRACT_CREATOR, owner, { from: owner });
    await registry.registerContract([], owner, { from: owner });
  });

  beforeEach(async function () {
    // Deploy new tunnel contracts so that event logs are fresh for each test
    const _oracleChild = await OracleChildTunnel.new(fxChild.address, finder.address);
    const _oracleRoot = await OracleRootTunnel.new(checkpointManager, fxRoot.address, finder.address);
    await _oracleChild.setFxRootTunnel(_oracleRoot.address, { from: owner });
    await _oracleRoot.setFxChildTunnel(_oracleChild.address, { from: owner });

    // Create Web3.eth.Contract versions of Tunnel contracts so that we can interact with them the same way
    // that the relayer bot does.
    oracleChild = new web3.eth.Contract(OracleChildTunnel.abi, _oracleChild.address);
    oracleRoot = new web3.eth.Contract(OracleRootTunnel.abi, _oracleRoot.address);

    // The OracleChildTunnel should stamp ",childRequester:<requester-address>,childChainId:<chain-id>" to the original
    // ancillary data.
    expectedStampedAncillaryData = utf8ToHex(
      `${hexToUtf8(testAncillaryData)},childRequester:${owner.substr(2).toLowerCase()},childChainId:${childChainId}`
    );

    spy = sinon.spy();
    spyLogger = winston.createLogger({
      level: "debug",
      transports: [new SpyTransport({ level: "debug" }, { spy: spy })],
    });
    gasEstimator = new GasEstimator(spyLogger);
    await gasEstimator.update();
    // Construct Matic PoS client that always successfully constructs a proof
    maticPosClient = {
      posRootChainManager: {
        customPayload: async () =>
          new Promise((resolve) => {
            resolve(utf8ToHex("Test proof"));
          }),
      },
    };
    // Construct Relayer that should relay messages without fail.
    relayer = new Relayer(spyLogger, owner, gasEstimator, maticPosClient, oracleChild, oracleRoot, web3, 0);
  });

  it("exits without error if no MessageSent events emitted", async function () {
    await relayer.relayMessage();
    assert.isTrue(lastSpyLogIncludes(spy, "No MessageSent events emitted by OracleChildTunnel"));
  });
  it("relays message successfully", async function () {
    // Emit new MessageSent event.
    await oracleChild.methods.requestPrice(testIdentifier, testTimestamp, testAncillaryData).send({ from: owner });
    const messageBytes = web3.eth.abi.encodeParameters(
      ["bytes32", "uint256", "bytes"],
      [testIdentifier, testTimestamp, expectedStampedAncillaryData]
    );
    const eventsEmitted = await oracleChild.getPastEvents("MessageSent", { fromBlock: 0 });
    assert.equal(eventsEmitted.length, 1);
    assert.equal(eventsEmitted[0].returnValues.message, messageBytes);

    // Relay message and check that it submitted transactions as expected.
    await relayer.relayMessage();
    const nonDebugEvents = spy.getCalls().filter((log: any) => log.lastArg.level !== "debug");
    assert.equal(nonDebugEvents.length, 1);
    assert.isTrue(lastSpyLogIncludes(spy, "Submitted relay proof"));
  });
  it("ignores events older than earliest polygon block to query", async function () {
    // Save block number for event so that we can configure Relayer to ignore it.
    const txn = await oracleChild.methods
      .requestPrice(testIdentifier, testTimestamp, testAncillaryData)
      .send({ from: owner });
    const messageBytes = web3.eth.abi.encodeParameters(
      ["bytes32", "uint256", "bytes"],
      [testIdentifier, testTimestamp, expectedStampedAncillaryData]
    );
    const eventsEmitted = await oracleChild.getPastEvents("MessageSent", { fromBlock: 0 });
    assert.equal(eventsEmitted.length, 1);
    assert.equal(eventsEmitted[0].returnValues.message, messageBytes);

    // Construct new Relayer with modified earliest block to query.
    const _relayer: any = new Relayer(
      spyLogger,
      owner,
      gasEstimator,
      maticPosClient,
      oracleChild,
      oracleRoot,
      web3,
      Number(txn.blockNumber + 1)
    );
    // Relay message and check that it ignores events as expected.
    await _relayer.relayMessage();
    const nonDebugEvents = spy.getCalls().filter((log: any) => log.lastArg.level !== "debug");
    assert.equal(nonDebugEvents.length, 0);
    assert.isTrue(lastSpyLogIncludes(spy, "No MessageSent events emitted by OracleChildTunnel"));
  });
  it("logs error when it fails to construct a proof", async function () {
    // Construct PosClient that always fails to construct a proof.
    const _maticPosClient: MaticPosClient = {
      posRootChainManager: {
        customPayload: async () =>
          new Promise((resolve, reject) => {
            reject(new Error("This error is always thrown"));
          }),
      },
    };
    const _relayer: any = new Relayer(
      spyLogger,
      owner,
      gasEstimator,
      _maticPosClient,
      oracleChild,
      oracleRoot,
      web3,
      0
    );

    await oracleChild.methods.requestPrice(testIdentifier, testTimestamp, testAncillaryData).send({ from: owner });

    // Relay message and check for error logs
    await _relayer.relayMessage();
    const nonDebugEvents = spy.getCalls().filter((log: any) => log.lastArg.level !== "debug");
    assert.equal(nonDebugEvents.length, 1);
    assert.isTrue(lastSpyLogIncludes(spy, "Failed to derive proof for MessageSent transaction hash"));
  });
  it("does not log error when proof fails to be constructed because it has not been checkpointed to mainnet yet", async function () {
    // Relayer emit DEBUG level logs for any errors thrown on proof construction that reference the transaction not
    // being checkpointed yet.
    const _maticPosClient: MaticPosClient = {
      posRootChainManager: {
        customPayload: async () =>
          new Promise((resolve, reject) => {
            reject(new Error("transaction has not been checkpointed"));
          }),
      },
    };
    const _relayer: any = new Relayer(
      spyLogger,
      owner,
      gasEstimator,
      _maticPosClient,
      oracleChild,
      oracleRoot,
      web3,
      0
    );

    await oracleChild.methods.requestPrice(testIdentifier, testTimestamp, testAncillaryData).send({ from: owner });

    // Relay message and check for error logs
    await _relayer.relayMessage();
    const nonDebugEvents = spy.getCalls().filter((log: any) => log.lastArg.level !== "debug");
    assert.equal(nonDebugEvents.length, 0);
    assert.isTrue(lastSpyLogIncludes(spy, "Failed to derive proof for MessageSent transaction hash"));
  });
  it("logs error when submitting proof to RootTunnel reverts unexpectedly", async function () {
    // Manually override RootTunnelMock such that receiveMessage() always reverts.
    await oracleRoot.methods.setRevertReceiveMessage(true).send({ from: owner });

    // Emit a MessageSent event and instruct relayer to relay the event.
    await oracleChild.methods.requestPrice(testIdentifier, testTimestamp, testAncillaryData).send({ from: owner });

    // Bot should attempt to submit a transaction to the RootTunnelMock that will revert
    await relayer.relayMessage();
    const nonDebugEvents = spy.getCalls().filter((log: any) => log.lastArg.level !== "debug");
    assert.equal(nonDebugEvents.length, 1);
    assert.isTrue(lastSpyLogIncludes(spy, "Failed to submit proof to root tunnel"));
  });
  it("does not log error when submitting proof to RootTunnel reverts because the proof has already been submitted", async function () {
    // Manually override RootTunnelMock such that receiveMessage() always reverts and the error message indicates that
    // the proof has already been submitted.
    await oracleRoot.methods.setRevertReceiveMessage(true).send({ from: owner });
    await oracleRoot.methods.setRevertErrorMessage("EXIT_ALREADY_PROCESSED").send({ from: owner });

    // Emit a MessageSent event and instruct relayer to relay the event.
    await oracleChild.methods.requestPrice(testIdentifier, testTimestamp, testAncillaryData).send({ from: owner });

    // Bot should attempt to submit a transaction to the RootTunnelMock that will revert
    await relayer.relayMessage();
    const nonDebugEvents = spy.getCalls().filter((log: any) => log.lastArg.level !== "debug");
    assert.equal(nonDebugEvents.length, 0);
    assert.isTrue(lastSpyLogIncludes(spy, "Failed to submit proof to root tunnel"));
  });
});

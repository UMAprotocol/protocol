import winston from "winston";
import { assert } from "chai";
import { Contract } from "web3-eth-contract";
import sinon from "sinon";
import { Relayer } from "../src/Relayer";
import { getAbi } from "@uma/contracts-node";
import { SpyTransport, GasEstimator, lastSpyLogIncludes } from "@uma/financial-templates-lib";
import { ZERO_ADDRESS, interfaceName, RegistryRolesEnum } from "@uma/common";

const { getContract, deployments, web3 } = require("hardhat");

const { utf8ToHex } = web3.utils;
const Finder = getContract("Finder");
const OracleChildTunnel = getContract("OracleChildTunnel");
const Registry = getContract("Registry");
const OracleRootTunnel = getContract("OracleRootTunnelMock");
const MockOracle = getContract("MockOracleAncillary");
const StateSync = getContract("StateSyncMock");
const FxChild = getContract("FxChildMock");
const FxRoot = getContract("FxRootMock");

// This function should return a bytes string.
type customPayloadFn = () => Promise<string>;
interface MaticPosClient {
  exitUtil: {
    buildPayloadForExit: customPayloadFn;
    isCheckPointed: () => Promise<boolean>;
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
    stateSync = await StateSync.new().send({ from: owner });
    fxRoot = await FxRoot.new(stateSync.options.address).send({ from: owner });
    fxChild = await FxChild.new(systemSuperUser).send({ from: owner });
    await fxChild.methods.setFxRoot(fxRoot.options.address).send({ from: owner });
    await fxRoot.methods.setFxChild(fxChild.options.address).send({ from: owner });

    // Set up mocked Oracle infrastructure
    finder = await Finder.new().send({ from: owner });
    mockOracle = await MockOracle.new(finder.options.address, ZERO_ADDRESS).send({ from: owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Oracle), mockOracle.options.address)
      .send({ from: owner });
    registry = await Registry.new().send({ from: owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Registry), registry.options.address)
      .send({ from: owner });
    await registry.methods.addMember(RegistryRolesEnum.CONTRACT_CREATOR, owner).send({ from: owner });
    await registry.methods.registerContract([], owner).send({ from: owner });
  });

  beforeEach(async function () {
    // Deploy new tunnel contracts so that event logs are fresh for each test
    oracleChild = await OracleChildTunnel.new(fxChild.options.address, finder.options.address).send({ from: owner });
    oracleRoot = await OracleRootTunnel.new(checkpointManager, fxRoot.options.address, finder.options.address).send({
      from: owner,
    });
    await oracleChild.methods.setFxRootTunnel(oracleRoot.options.address).send({ from: owner });
    await oracleRoot.methods.setFxChildTunnel(oracleChild.options.address).send({ from: owner });

    spy = sinon.spy();
    spyLogger = winston.createLogger({
      level: "debug",
      transports: [new SpyTransport({ level: "debug" }, { spy: spy })],
    });
    gasEstimator = new GasEstimator(spyLogger);
    await gasEstimator.update();
    // Construct Matic PoS client that always successfully constructs a proof
    maticPosClient = {
      exitUtil: {
        buildPayloadForExit: async () =>
          new Promise((resolve) => {
            resolve(utf8ToHex("Test proof"));
          }),
        isCheckPointed: async () => new Promise((resolve) => resolve(true)),
      },
    };

    // Save to hre.deployments so that client can fetch contract addresses via getAddress.
    deployments.save("OracleChildTunnel", { address: oracleChild.options.address, abi: getAbi("OracleChildTunnel") });
    deployments.save("OracleRootTunnel", { address: oracleChild.options.address, abi: getAbi("OracleRootTunnel") });

    // Construct Relayer that should relay messages without fail.
    relayer = new Relayer(spyLogger, owner, gasEstimator, maticPosClient, oracleChild, oracleRoot, web3, 0, 100);
  });

  it("exits without error if no MessageSent events emitted", async function () {
    await relayer.fetchAndRelayMessages();
    assert.isTrue(lastSpyLogIncludes(spy, "No MessageSent events emitted by OracleChildTunnel"));
  });
  it("relays message successfully", async function () {
    // Emit new MessageSent event.
    const txn = await oracleChild.methods
      .requestPrice(testIdentifier, testTimestamp, testAncillaryData)
      .send({ from: owner });
    const parentAncillaryData = await oracleChild.methods
      .compressAncillaryData(testAncillaryData, owner, txn.blockNumber)
      .call();
    const messageBytes = web3.eth.abi.encodeParameters(
      ["bytes32", "uint256", "bytes"],
      [testIdentifier, testTimestamp, parentAncillaryData]
    );
    const eventsEmitted = await oracleChild.getPastEvents("MessageSent", { fromBlock: 0 });
    assert.equal(eventsEmitted.length, 1);
    assert.equal(eventsEmitted[0].returnValues.message, messageBytes);

    // Relay message and check that it submitted transactions as expected.
    await relayer.fetchAndRelayMessages();
    const nonDebugEvents = spy.getCalls().filter((log: any) => log.lastArg.level !== "debug");
    assert.equal(nonDebugEvents.length, 1);
    assert.isTrue(lastSpyLogIncludes(spy, "Submitted relay proof"));
  });
  it("ignores events older than earliest polygon block to query", async function () {
    const txn = await oracleChild.methods
      .requestPrice(testIdentifier, testTimestamp, testAncillaryData)
      .send({ from: owner });
    const parentAncillaryData = await oracleChild.methods
      .compressAncillaryData(testAncillaryData, owner, txn.blockNumber)
      .call();
    const messageBytes = web3.eth.abi.encodeParameters(
      ["bytes32", "uint256", "bytes"],
      [testIdentifier, testTimestamp, parentAncillaryData]
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
      100,
      101
    );
    // Relay message and check that it ignores events as expected.
    await _relayer.fetchAndRelayMessages();
    const nonDebugEvents = spy.getCalls().filter((log: any) => log.lastArg.level !== "debug");
    assert.equal(nonDebugEvents.length, 0);
    assert.isTrue(lastSpyLogIncludes(spy, "No MessageSent events emitted by OracleChildTunnel"));
  });
  it("logs error when it fails to construct a proof", async function () {
    // Construct PosClient that always fails to construct a proof.
    const _maticPosClient: MaticPosClient = {
      exitUtil: {
        buildPayloadForExit: async () =>
          new Promise((_, reject) => {
            reject(new Error("This error is always thrown"));
          }),
        isCheckPointed: async () => new Promise((resolve) => resolve(true)),
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
      0,
      100
    );

    await oracleChild.methods.requestPrice(testIdentifier, testTimestamp, testAncillaryData).send({ from: owner });

    // Relay message and check for error logs
    await _relayer.fetchAndRelayMessages();
    const nonDebugEvents = spy.getCalls().filter((log: any) => log.lastArg.level !== "debug");
    assert.equal(nonDebugEvents.length, 1);
    assert.isTrue(lastSpyLogIncludes(spy, "Failed to derive proof for MessageSent transaction hash"));
  });
  it("block is not checkpointed yet", async function () {
    const _maticPosClient: MaticPosClient = {
      exitUtil: {
        buildPayloadForExit: async () =>
          new Promise((resolve) => {
            resolve(utf8ToHex("Test proof"));
          }),
        isCheckPointed: async () => new Promise((resolve) => resolve(false)),
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
      0,
      100
    );

    await oracleChild.methods.requestPrice(testIdentifier, testTimestamp, testAncillaryData).send({ from: owner });

    // Relay message and check for error logs
    await _relayer.fetchAndRelayMessages();
    const nonDebugEvents = spy.getCalls().filter((log: any) => log.lastArg.level !== "debug");
    assert.equal(nonDebugEvents.length, 0);
    assert.isTrue(lastSpyLogIncludes(spy, "block not checkpointed"));
  });
  it("logs error when submitting proof to RootTunnel reverts unexpectedly", async function () {
    // Manually override RootTunnelMock such that receiveMessage() always reverts.
    await oracleRoot.methods.setRevertReceiveMessage(true).send({ from: owner });

    // Emit a MessageSent event and instruct relayer to relay the event.
    await oracleChild.methods.requestPrice(testIdentifier, testTimestamp, testAncillaryData).send({ from: owner });

    // Bot should attempt to submit a transaction to the RootTunnelMock that will revert
    await relayer.fetchAndRelayMessages();
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

    // Bot should attempt to submit a transaction to the RootTunnelMock that will revert but not log anything.
    await relayer.fetchAndRelayMessages();
    const nonDebugEvents = spy.getCalls().filter((log: any) => log.lastArg.level !== "debug");
    assert.equal(nonDebugEvents.length, 0);
  });
});

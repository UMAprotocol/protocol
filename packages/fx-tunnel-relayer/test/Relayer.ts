import winston from "winston";
import { assert } from "chai";
import { Contract } from "web3-eth-contract";
import type Web3 from "web3";
import sinon from "sinon";
import { Relayer } from "../src/Relayer";
import { getAbi } from "@uma/contracts-node";
import { SpyTransport, lastSpyLogIncludes } from "@uma/financial-templates-lib";
import { ZERO_ADDRESS, interfaceName, RegistryRolesEnum } from "@uma/common";
import { ROOT_TUNNEL_CHUNKED_RELAYER_ABI } from "../src/chunkedRelayerAbi";
import { MAX_CHUNK_SIZE, chunkHex, splitExitPayload } from "../src/exitPayload";
import { buildExitPayload } from "./helpers/exitPayloadFixtures";

const { getContract, deployments, web3 } = require("hardhat");

const { toBN, toWei, utf8ToHex } = web3.utils;
const Finder = getContract("Finder");
const Multicall = getContract("Multicall3");
const OracleChildTunnel = getContract("OracleChildTunnel");
const Registry = getContract("Registry");
const OracleRootTunnel = getContract("OracleRootTunnelMock");
const MockOracle = getContract("MockOracleAncillary");
const StateSync = getContract("StateSyncMock");
const FxChild = getContract("FxChildMock");
const FxRoot = getContract("FxRootMock");

// This function should return a bytes string.
type customPayloadFn = (burnTxHash?: string, logEventSig?: string, isFast?: boolean, index?: number) => Promise<string>;
interface MaticPosClient {
  exitUtil: {
    buildPayloadForExit: customPayloadFn;
    isCheckPointed: () => Promise<boolean>;
    getChainBlockInfo: () => Promise<{ lastChildBlock: number; txBlockNumber: number }>;
  };
}
// Builds a child-chain web3 stub that only serves transaction receipts, which is all the Relayer reads from Polygon.
const createPolygonWeb3 = (getTransactionReceipt: (transactionHash: string) => Promise<any>): Web3 =>
  (({ eth: { getTransactionReceipt } } as unknown) as Web3);

// The RootTunnelChunkedRelayer artifact only exists once packages/core is compiled with the contract.
const chunkedRelayerArtifactAvailable = (() => {
  try {
    getContract("RootTunnelChunkedRelayer");
    return true;
  } catch {
    return false;
  }
})();

// Oversize exit payload (> 120000 bytes of receiveMessage calldata) whose body spans several chunks. All messages of
// one Polygon transaction share the block number, branch mask and receipt, so only the log index differs.
const OVERSIZE_LOG_COUNT = 140;
const buildOversizeProof = (logIndex: number) =>
  buildExitPayload({
    blockNumber: 64_123_456,
    branchMask: Buffer.from("0081c8", "hex"),
    logIndex,
    logCount: OVERSIZE_LOG_COUNT,
  }).proof;

// Stand-in for a RootTunnelChunkedRelayer: chunk addresses are derived from the chunk hash, storeChunk "deploys" by
// recording the chunk (served through a web3.eth.getCode stub) and relay records its arguments. Transactions go through
// runTransaction unchanged; only call/estimateGas/send are faked and encodeABI uses the real ABI.
interface FakeChunkedRelayer {
  contract: any;
  deployed: Map<string, string>;
  chunkAddressCalls: number;
  storeCalls: { pointer: string; calldataBytes: number }[];
  relayCalls: { prefix: string; chunks: string[]; suffix: string; calldataBytes: number }[];
  relayCallError?: Error;
  relayEstimatedGas: number;
}
const createFakeChunkedRelayer = (): FakeChunkedRelayer => {
  const encoder = new web3.eth.Contract(ROOT_TUNNEL_CHUNKED_RELAYER_ABI);
  const addressOf = (chunk: string): string =>
    web3.utils.toChecksumAddress("0x" + web3.utils.keccak256(chunk).slice(-40));
  let sendCount = 0;
  const sendable = (
    encoded: string,
    onSend: () => void,
    callResult: () => Promise<any>,
    estimatedGas: () => number = () => 100_000
  ) => ({
    encodeABI: () => encoded,
    call: callResult,
    estimateGas: async () => estimatedGas(),
    send: async () => {
      onSend();
      return { transactionHash: web3.utils.keccak256(web3.utils.numberToHex(++sendCount)) };
    },
  });
  const fake: FakeChunkedRelayer = {
    contract: { options: { address: "0x00000000000000000000000000000000000c4a7e" } },
    deployed: new Map(),
    chunkAddressCalls: 0,
    storeCalls: [],
    relayCalls: [],
    relayEstimatedGas: 600_000,
  };
  fake.contract.methods = {
    chunkAddress: (chunk: string) => ({
      call: async () => {
        fake.chunkAddressCalls++;
        return addressOf(chunk);
      },
    }),
    storeChunk: (chunk: string) => {
      const encoded = encoder.methods.storeChunk(chunk).encodeABI();
      return sendable(
        encoded,
        () => {
          fake.deployed.set(addressOf(chunk), chunk);
          fake.storeCalls.push({ pointer: addressOf(chunk), calldataBytes: (encoded.length - 2) / 2 });
        },
        async () => addressOf(chunk)
      );
    },
    relay: (prefix: string, chunks: string[], suffix: string) => {
      const encoded = encoder.methods.relay(prefix, chunks, suffix).encodeABI();
      return sendable(
        encoded,
        () => fake.relayCalls.push({ prefix, chunks, suffix, calldataBytes: (encoded.length - 2) / 2 }),
        async () => {
          if (fake.relayCallError) throw fake.relayCallError;
          return [];
        },
        () => fake.relayEstimatedGas
      );
    },
  };
  return fake;
};
describe("Relayer unit tests", function () {
  let spyLogger: any;
  let spy: any;
  let systemSuperUser: string;
  let checkpointManager: string;
  let owner: any;
  let maticPosClient: MaticPosClient;
  // Child-chain provider passed to the Relayer. It is distinct from the hardhat `web3` used for the parent chain so that
  // a regression reading Polygon data through the parent-chain instance fails these tests. Receipts are served from the
  // local network, where the child-chain contracts are deployed, and each lookup is recorded.
  let polygonWeb3: Web3;
  let polygonReceiptLookups: string[];
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
    // Construct Matic PoS client that always successfully constructs a proof
    maticPosClient = {
      exitUtil: {
        buildPayloadForExit: async () =>
          new Promise((resolve) => {
            resolve(utf8ToHex("Test proof"));
          }),
        isCheckPointed: async () => new Promise((resolve) => resolve(true)),
        getChainBlockInfo: async () => new Promise((resolve) => resolve({ lastChildBlock: 0, txBlockNumber: 0 })),
      },
    };

    polygonReceiptLookups = [];
    polygonWeb3 = createPolygonWeb3(async (transactionHash) => {
      polygonReceiptLookups.push(transactionHash);
      return web3.eth.getTransactionReceipt(transactionHash);
    });

    // Save to hre.deployments so that client can fetch contract addresses via getAddress.
    deployments.save("OracleChildTunnel", { address: oracleChild.options.address, abi: getAbi("OracleChildTunnel") });
    deployments.save("OracleRootTunnel", { address: oracleChild.options.address, abi: getAbi("OracleRootTunnel") });

    // Construct Relayer that should relay messages without fail.
    relayer = new Relayer(spyLogger, owner, maticPosClient, oracleChild, oracleRoot, web3, polygonWeb3, 0, 100);
  });

  afterEach(function () {
    sinon.restore();
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
  it("skips oversize calldata before fee lookup or send and warns once per message", async function () {
    const txn = await oracleChild.methods
      .requestPrice(testIdentifier, testTimestamp, testAncillaryData)
      .send({ from: owner });
    const proof = "0x" + "ab".repeat(120_000);
    maticPosClient.exitUtil.buildPayloadForExit = async () => proof;
    const fees = sinon.spy(relayer, "_getGasFees");
    await relayer.fetchAndRelayMessages();
    await relayer.fetchAndRelayMessages();
    assert.isFalse(fees.called);
    const warnings = spy.getCalls().filter((log: any) => log.lastArg.level === "warn");
    assert.lengthOf(warnings, 1);
    assert.equal(warnings[0].lastArg.transactionHash, txn.transactionHash);
    assert.equal(warnings[0].lastArg.messageIndex, 0);
    assert.equal(warnings[0].lastArg.calldataBytes, 120_068);
    assert.include(warnings[0].lastArg.message, "needs manual relay");
    assert.notInclude(JSON.stringify(spy.getCalls().map((call: any) => call.lastArg)), proof);
  });
  it("allows calldata exactly at the configured limit", async function () {
    await oracleChild.methods.requestPrice(testIdentifier, testTimestamp, testAncillaryData).send({ from: owner });
    const proof = utf8ToHex("Test proof");
    const size = (oracleRoot.methods.receiveMessage(proof).encodeABI().length - 2) / 2;
    const bounded = new Relayer(
      spyLogger,
      owner,
      maticPosClient,
      oracleChild,
      oracleRoot,
      web3,
      polygonWeb3,
      0,
      100,
      size
    );
    await bounded.fetchAndRelayMessages();
    assert.isTrue(lastSpyLogIncludes(spy, "Submitted relay proof"));
    assert.notInclude(JSON.stringify(spy.getCalls().map((call: any) => call.lastArg)), proof);
  });
  it("redacts proof and provider URL from construction errors", async function () {
    await oracleChild.methods.requestPrice(testIdentifier, testTimestamp, testAncillaryData).send({ from: owner });
    const proof = "0x" + "cd".repeat(150_000);
    maticPosClient.exitUtil.buildPayloadForExit = async () => {
      throw Object.assign(new Error("provider https://example.invalid/secret data=" + proof + "x".repeat(4000)), {
        data: proof,
      });
    };
    await relayer.fetchAndRelayMessages();
    const log = spy.getCall(-1).lastArg;
    assert.isAtMost(log.error.length, 2048);
    assert.notInclude(JSON.stringify(log), proof);
    assert.notInclude(JSON.stringify(log), "secret");
    assert.notProperty(log, "messageEvent");
    assert.notProperty(log, "chainBlockInfo");
    assert.equal(log.messageIndex, 0);
  });
  it("prices the relay transaction from the latest block's base fee", async function () {
    await oracleChild.methods.requestPrice(testIdentifier, testTimestamp, testAncillaryData).send({ from: owner });

    await relayer.fetchAndRelayMessages();
    assert.isTrue(lastSpyLogIncludes(spy, "Submitted relay proof"));

    // Fees are derived from the block that was latest when the relay was sent, i.e. the parent of the block it was mined
    // in: a 0.001 gwei priority fee and a max fee of 3x the base fee plus the priority fee, not doubled again on send.
    const relayTx: any = await web3.eth.getTransaction(spy.getCall(-1).lastArg.tx);
    const { baseFeePerGas } = await web3.eth.getBlock(relayTx.blockNumber - 1);
    const expectedMaxPriorityFeePerGas = toBN(toWei("0.001", "gwei"));
    assert.equal(relayTx.maxPriorityFeePerGas.toString(), expectedMaxPriorityFeePerGas.toString());
    assert.equal(
      relayTx.maxFeePerGas.toString(),
      toBN(baseFeePerGas).muln(3).add(expectedMaxPriorityFeePerGas).toString()
    );
  });
  it("relays all messages when a transaction contains multiple MessageSent events", async function () {
    // Bundle two price requests into a single transaction via a registered multicall contract so that one
    // transaction emits two MessageSent events.
    const multicall = await Multicall.new().send({ from: owner });
    await registry.methods.registerContract([], multicall.options.address).send({ from: owner });
    await multicall.methods
      .aggregate([
        [
          oracleChild.options.address,
          oracleChild.methods.requestPrice(testIdentifier, testTimestamp, utf8ToHex("request:1")).encodeABI(),
        ],
        [
          oracleChild.options.address,
          oracleChild.methods.requestPrice(testIdentifier, testTimestamp, utf8ToHex("request:2")).encodeABI(),
        ],
      ])
      .send({ from: owner });
    const eventsEmitted = await oracleChild.getPastEvents("MessageSent", { fromBlock: 0 });
    assert.equal(eventsEmitted.length, 2);
    assert.equal(eventsEmitted[0].transactionHash, eventsEmitted[1].transactionHash);

    // Record the message index passed to the proof builder for each relayed message: each message must be proven
    // at its own position among the transaction's MessageSent logs, not just the first one.
    const provenIndices: (number | undefined)[] = [];
    const _maticPosClient: MaticPosClient = {
      exitUtil: {
        buildPayloadForExit: async (_burnTxHash?: string, _logEventSig?: string, _isFast?: boolean, index?: number) => {
          provenIndices.push(index);
          return utf8ToHex("Test proof");
        },
        isCheckPointed: async () => new Promise((resolve) => resolve(true)),
        getChainBlockInfo: async () => new Promise((resolve) => resolve({ lastChildBlock: 0, txBlockNumber: 0 })),
      },
    };
    const _relayer: any = new Relayer(
      spyLogger,
      owner,
      _maticPosClient,
      oracleChild,
      oracleRoot,
      web3,
      polygonWeb3,
      0,
      100
    );
    await _relayer.fetchAndRelayMessages();

    assert.deepEqual(provenIndices, [0, 1]);
    // The receipt must be read from the child-chain provider, once per transaction.
    assert.deepEqual(polygonReceiptLookups, [eventsEmitted[0].transactionHash]);
    const infoEvents = spy.getCalls().filter((log: any) => log.lastArg.level === "info");
    assert.equal(infoEvents.length, 2);
    assert.isTrue(lastSpyLogIncludes(spy, "Submitted relay proof"));
  });
  it("logs error and continues when a MessageSent transaction receipt cannot be fetched", async function () {
    // Emit three MessageSent events, each in its own transaction.
    const txnHashes: string[] = [];
    for (const ancillaryData of ["request:1", "request:2", "request:3"]) {
      const txn = await oracleChild.methods
        .requestPrice(testIdentifier, testTimestamp, utf8ToHex(ancillaryData))
        .send({ from: owner });
      txnHashes.push(txn.transactionHash);
    }

    // The child-chain provider returns no receipt for the first transaction (e.g. after a reorg or while the node is
    // lagging) and fails the lookup for the second, but serves the third.
    const _polygonWeb3 = createPolygonWeb3(async (transactionHash) => {
      if (transactionHash === txnHashes[0]) return null;
      if (transactionHash === txnHashes[1]) throw new Error("Receipt lookup failed");
      return web3.eth.getTransactionReceipt(transactionHash);
    });
    const _relayer: any = new Relayer(
      spyLogger,
      owner,
      maticPosClient,
      oracleChild,
      oracleRoot,
      web3,
      _polygonWeb3,
      0,
      100
    );
    await _relayer.fetchAndRelayMessages();

    // Both failed lookups are logged, and the remaining message is still relayed.
    const errorEvents = spy.getCalls().filter((log: any) => log.lastArg.level === "error");
    assert.equal(errorEvents.length, 2);
    errorEvents.forEach((log: any) =>
      assert.include(log.lastArg.message, "Failed to fetch receipt for MessageSent transaction hash")
    );
    const infoEvents = spy.getCalls().filter((log: any) => log.lastArg.level === "info");
    assert.equal(infoEvents.length, 1);
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
      maticPosClient,
      oracleChild,
      oracleRoot,
      web3,
      polygonWeb3,
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
        getChainBlockInfo: async () => new Promise((resolve) => resolve({ lastChildBlock: 0, txBlockNumber: 0 })),
      },
    };
    const _relayer: any = new Relayer(
      spyLogger,
      owner,
      _maticPosClient,
      oracleChild,
      oracleRoot,
      web3,
      polygonWeb3,
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
        getChainBlockInfo: async () => new Promise((resolve) => resolve({ lastChildBlock: 0, txBlockNumber: 0 })),
      },
    };
    const _relayer: any = new Relayer(
      spyLogger,
      owner,
      _maticPosClient,
      oracleChild,
      oracleRoot,
      web3,
      polygonWeb3,
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
  it("bounds runTransaction errors and retains Polygon transaction and message identity", async function () {
    const txn = await oracleChild.methods
      .requestPrice(testIdentifier, testTimestamp, testAncillaryData)
      .send({ from: owner });
    const data = "0x" + "ab".repeat(120_000);
    const error = Object.assign(new Error(`RPC wss://example.invalid/api-secret data=${data} ${"x".repeat(3000)}`), {
      transaction: { data },
      proof: data,
    });
    const transaction = oracleRoot.methods.receiveMessage(utf8ToHex("Test proof"));
    sinon.stub(transaction, "call").rejects(error);
    sinon.stub(transaction, "estimateGas").resolves(100_000);
    const send = sinon.spy(transaction, "send");
    const method = sinon.stub(oracleRoot.methods, "receiveMessage").returns(transaction);
    try {
      await relayer.fetchAndRelayMessages();
      const log = spy.getCall(-1).lastArg;
      assert.include(log.message, "Failed to submit proof to root tunnel");
      assert.equal(log.transactionHash, txn.transactionHash);
      assert.equal(log.messageIndex, 0);
      assert.isAtMost(log.error.length, 2048);
      assert.include(log.error, "[redacted hex data]");
      assert.notInclude(JSON.stringify(log), data);
      assert.notInclude(JSON.stringify(log), "api-secret");
      assert.isFalse(send.called);
    } finally {
      method.restore();
    }
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

  describe("oversize proofs", function () {
    const logs = () => spy.getCalls().map((call: any) => call.lastArg);
    const logsAtLevel = (level: string) => logs().filter((log: any) => log.level === level);
    const assertNoPayloadDataInLogs = (proof: string) => {
      const serialized = JSON.stringify(logs());
      // Any 64-byte window of the payload body would reveal proof data.
      const { body } = splitExitPayload(proof);
      for (const chunk of chunkHex(body)) assert.notInclude(serialized, chunk.slice(2, 130));
      assert.notInclude(serialized, proof.slice(2, 130));
    };
    // Queries up to the current block: earlier tests in this file can push the chain past block 100.
    const relayerWith = async (fake?: FakeChunkedRelayer, maxCalldataBytes = 120_000, maxChunkedProofBytes?: number) =>
      new Relayer(
        spyLogger,
        owner,
        maticPosClient,
        oracleChild,
        oracleRoot,
        web3,
        polygonWeb3,
        0,
        await web3.eth.getBlockNumber(),
        maxCalldataBytes,
        fake?.contract,
        maxChunkedProofBytes
      );
    const stubGetCode = (fake: FakeChunkedRelayer) =>
      sinon.stub(web3.eth, "getCode").callsFake((async (address: string) => {
        const chunk = fake.deployed.get(address);
        return chunk === undefined ? "0x" : "0x00" + chunk.slice(2);
      }) as any);
    const stubProcessedExits = (result: boolean | Error) =>
      sinon.stub(oracleRoot.methods, "processedExits").returns({
        call: async () => {
          if (result instanceof Error) throw result;
          return result;
        },
      } as any);

    beforeEach(function () {
      maticPosClient.exitUtil.buildPayloadForExit = async (
        _hash?: string,
        _sig?: string,
        _fast?: boolean,
        index?: number
      ) => buildOversizeProof(index ?? 0);
    });

    it("fixture exceeds the calldata limit and spans several chunks", function () {
      const proof = buildOversizeProof(0);
      assert.isAbove((oracleRoot.methods.receiveMessage(proof).encodeABI().length - 2) / 2, 120_000);
      assert.isAbove(chunkHex(splitExitPayload(proof).body).length, 4);
    });

    it("prechecks processedExits and still warns once for unprocessed exits without a chunked relayer", async function () {
      const txn = await oracleChild.methods
        .requestPrice(testIdentifier, testTimestamp, testAncillaryData)
        .send({ from: owner });
      const processedExits = sinon.spy(oracleRoot.methods, "processedExits");
      const relayer = await relayerWith();
      await relayer.fetchAndRelayMessages();
      await relayer.fetchAndRelayMessages();

      const proof = buildOversizeProof(0);
      assert.isTrue(processedExits.calledWith(splitExitPayload(proof).exitHash));
      const warnings = logsAtLevel("warn");
      assert.lengthOf(warnings, 1);
      assert.include(warnings[0].message, "needs manual relay");
      assert.equal(warnings[0].transactionHash, txn.transactionHash);
      assert.equal(warnings[0].messageIndex, 0);
      assert.notProperty(warnings[0], "error");
      assertNoPayloadDataInLogs(proof);
    });

    it("does not warn about oversize exits that were already processed", async function () {
      await oracleChild.methods.requestPrice(testIdentifier, testTimestamp, testAncillaryData).send({ from: owner });
      stubProcessedExits(true);
      await (await relayerWith()).fetchAndRelayMessages();
      assert.lengthOf(
        logs().filter((log: any) => log.level !== "debug"),
        0
      );
      assert.isTrue(lastSpyLogIncludes(spy, "Oversize exit already processed"));
    });

    it("warns when the processedExits precheck fails without a chunked relayer", async function () {
      await oracleChild.methods.requestPrice(testIdentifier, testTimestamp, testAncillaryData).send({ from: owner });
      stubProcessedExits(new Error("rpc down"));
      await (await relayerWith()).fetchAndRelayMessages();
      const warnings = logsAtLevel("warn");
      assert.lengthOf(warnings, 1);
      assert.include(warnings[0].message, "needs manual relay");
    });

    it("stores chunks and relays through the chunked relayer", async function () {
      const txn = await oracleChild.methods
        .requestPrice(testIdentifier, testTimestamp, testAncillaryData)
        .send({ from: owner });
      const fake = createFakeChunkedRelayer();
      stubGetCode(fake);
      const fees = sinon.spy(Relayer.prototype, "_getGasFees");
      await (await relayerWith(fake)).fetchAndRelayMessages();

      const proof = buildOversizeProof(0);
      const split = splitExitPayload(proof);
      const chunks = chunkHex(split.body);
      assert.lengthOf(fake.storeCalls, chunks.length);
      fake.storeCalls.forEach(({ calldataBytes }) => assert.isAtMost(calldataBytes, 120_000));
      assert.lengthOf(fake.relayCalls, 1);
      const [relay] = fake.relayCalls;
      assert.isAtMost(relay.calldataBytes, 120_000);
      assert.equal(relay.prefix, split.prefix);
      assert.equal(relay.suffix, split.suffix);
      // The relayed pieces rebuild the exact proof.
      const rebuilt =
        relay.prefix +
        relay.chunks.map((p) => (fake.deployed.get(p) as string).slice(2)).join("") +
        relay.suffix.slice(2);
      assert.equal(rebuilt, proof);
      relay.chunks.forEach((p) => assert.isAtMost(((fake.deployed.get(p) as string).length - 2) / 2, MAX_CHUNK_SIZE));
      // One fee lookup per transaction.
      assert.equal(fees.callCount, chunks.length + 1);

      const infos = logsAtLevel("info");
      assert.lengthOf(infos, 1);
      assert.include(infos[0].message, "Submitted chunked relay proof");
      assert.equal(infos[0].polygonTransactionHash, txn.transactionHash);
      assert.equal(infos[0].messageIndex, 0);
      assert.equal(infos[0].chunkCount, chunks.length);
      assert.equal(infos[0].chunksStored, chunks.length);
      assert.equal(infos[0].chunksReused, 0);
      assert.isString(infos[0].tx);
      assert.lengthOf(logsAtLevel("warn"), 0);
      assert.lengthOf(logsAtLevel("error"), 0);
      assertNoPayloadDataInLogs(proof);
    });

    it("reuses chunks across messages of one transaction and across relayer instances", async function () {
      const multicall = await Multicall.new().send({ from: owner });
      await registry.methods.registerContract([], multicall.options.address).send({ from: owner });
      await multicall.methods
        .aggregate([
          [
            oracleChild.options.address,
            oracleChild.methods.requestPrice(testIdentifier, testTimestamp, utf8ToHex("request:1")).encodeABI(),
          ],
          [
            oracleChild.options.address,
            oracleChild.methods.requestPrice(testIdentifier, testTimestamp, utf8ToHex("request:2")).encodeABI(),
          ],
        ])
        .send({ from: owner });
      const fake = createFakeChunkedRelayer();
      const getCode = stubGetCode(fake);
      await (await relayerWith(fake)).fetchAndRelayMessages();

      const chunkCount = chunkHex(splitExitPayload(buildOversizeProof(0)).body).length;
      assert.lengthOf(fake.storeCalls, chunkCount);
      assert.lengthOf(fake.relayCalls, 2);
      assert.deepEqual(fake.relayCalls[0].chunks, fake.relayCalls[1].chunks);
      assert.equal(fake.relayCalls[0].suffix, splitExitPayload(buildOversizeProof(0)).suffix);
      assert.equal(fake.relayCalls[1].suffix, splitExitPayload(buildOversizeProof(1)).suffix);
      const infos = logsAtLevel("info");
      assert.deepEqual(
        infos.map((log: any) => [log.messageIndex, log.chunksStored, log.chunksReused]),
        [
          [0, chunkCount, 0],
          [1, 0, chunkCount],
        ]
      );
      // The second message reuses chunks from the in-memory cache without on-chain lookups.
      assert.equal(getCode.callCount, chunkCount);

      // A new relayer instance (e.g. the next serverless run) finds the chunks on chain and does not store them again.
      await (await relayerWith(fake)).fetchAndRelayMessages();
      assert.lengthOf(fake.storeCalls, chunkCount);
      assert.lengthOf(fake.relayCalls, 4);
      assert.equal(getCode.callCount, 2 * chunkCount);
    });

    it("does not store chunks for exits that were already processed", async function () {
      await oracleChild.methods.requestPrice(testIdentifier, testTimestamp, testAncillaryData).send({ from: owner });
      const fake = createFakeChunkedRelayer();
      stubGetCode(fake);
      stubProcessedExits(true);
      await (await relayerWith(fake)).fetchAndRelayMessages();
      assert.equal(fake.chunkAddressCalls, 0);
      assert.lengthOf(fake.storeCalls, 0);
      assert.lengthOf(fake.relayCalls, 0);
      assert.lengthOf(
        logs().filter((log: any) => log.level !== "debug"),
        0
      );
    });

    it("does not store chunks when the processedExits precheck fails", async function () {
      await oracleChild.methods.requestPrice(testIdentifier, testTimestamp, testAncillaryData).send({ from: owner });
      const fake = createFakeChunkedRelayer();
      stubGetCode(fake);
      stubProcessedExits(new Error("rpc down"));
      await (await relayerWith(fake)).fetchAndRelayMessages();
      assert.lengthOf(fake.storeCalls, 0);
      const errors = logsAtLevel("error");
      assert.lengthOf(errors, 1);
      assert.include(errors[0].error, "rpc down");
    });

    it("logs at debug level when the relay simulation reverts with EXIT_ALREADY_PROCESSED", async function () {
      await oracleChild.methods.requestPrice(testIdentifier, testTimestamp, testAncillaryData).send({ from: owner });
      const fake = createFakeChunkedRelayer();
      stubGetCode(fake);
      fake.relayCallError = new Error("execution reverted: FxRootTunnel: EXIT_ALREADY_PROCESSED");
      await (await relayerWith(fake)).fetchAndRelayMessages();
      assert.lengthOf(fake.relayCalls, 0);
      assert.lengthOf(
        logs().filter((log: any) => log.level !== "debug"),
        0
      );
      assert.isTrue(lastSpyLogIncludes(spy, "Exit proof already processed"));
    });

    it("logs a bounded, redacted error when the relay simulation reverts", async function () {
      await oracleChild.methods.requestPrice(testIdentifier, testTimestamp, testAncillaryData).send({ from: owner });
      const proof = buildOversizeProof(0);
      const fake = createFakeChunkedRelayer();
      stubGetCode(fake);
      fake.relayCallError = new Error(`execution reverted: FxRootTunnel: INVALID_RECEIPT_PROOF data=${proof}`);
      await (await relayerWith(fake)).fetchAndRelayMessages();
      const errors = logsAtLevel("error");
      assert.lengthOf(errors, 1);
      assert.equal(errors[0].message, "Chunked relay failed after storing chunks🚨");
      assert.include(errors[0].error, "INVALID_RECEIPT_PROOF");
      assert.include(errors[0].error, "[redacted hex data]");
      assert.equal(errors[0].messageIndex, 0);
      assertNoPayloadDataInLogs(proof);
    });

    it("warns instead of relaying when an oversize proof cannot be parsed", async function () {
      await oracleChild.methods.requestPrice(testIdentifier, testTimestamp, testAncillaryData).send({ from: owner });
      const proof = "0x" + "ab".repeat(120_000);
      maticPosClient.exitUtil.buildPayloadForExit = async () => proof;
      const fake = createFakeChunkedRelayer();
      stubGetCode(fake);
      await (await relayerWith(fake)).fetchAndRelayMessages();
      assert.equal(fake.chunkAddressCalls, 0);
      const warnings = logsAtLevel("warn");
      assert.lengthOf(warnings, 1);
      assert.include(warnings[0].message, "needs manual relay");
      assert.include(warnings[0].error, "Could not parse exit payload");
      assert.notInclude(JSON.stringify(logs()), proof.slice(2, 130));
    });

    it("refuses to send a storeChunk transaction above the calldata limit", async function () {
      await oracleChild.methods.requestPrice(testIdentifier, testTimestamp, testAncillaryData).send({ from: owner });
      const fake = createFakeChunkedRelayer();
      stubGetCode(fake);
      await (await relayerWith(fake, 20_000)).fetchAndRelayMessages();
      assert.lengthOf(fake.storeCalls, 0);
      assert.lengthOf(fake.relayCalls, 0);
      const errors = logsAtLevel("error");
      assert.lengthOf(errors, 1);
      assert.include(errors[0].error, "storeChunk calldata");
    });

    it("does not store chunks for proofs above MAX_CHUNKED_PROOF_BYTES and logs one error per message", async function () {
      const txn = await oracleChild.methods
        .requestPrice(testIdentifier, testTimestamp, testAncillaryData)
        .send({ from: owner });
      const proof = buildOversizeProof(0);
      const proofBytes = (proof.length - 2) / 2;
      const fake = createFakeChunkedRelayer();
      stubGetCode(fake);
      const relayer = await relayerWith(fake, 120_000, proofBytes - 1);
      await relayer.fetchAndRelayMessages();
      await relayer.fetchAndRelayMessages();

      assert.equal(fake.chunkAddressCalls, 0);
      assert.lengthOf(fake.storeCalls, 0);
      assert.lengthOf(fake.relayCalls, 0);
      const errors = logsAtLevel("error");
      assert.lengthOf(errors, 1);
      assert.equal(errors[0].message, "Proof too large to relay on Ethereum: needs DVM request outside the tunnel");
      assert.equal(errors[0].transactionHash, txn.transactionHash);
      assert.equal(errors[0].messageIndex, 0);
      assert.equal(errors[0].proofBytes, proofBytes);
      assert.lengthOf(logsAtLevel("warn"), 0);
      assertNoPayloadDataInLogs(proof);
    });

    it("relays proofs exactly at MAX_CHUNKED_PROOF_BYTES", async function () {
      await oracleChild.methods.requestPrice(testIdentifier, testTimestamp, testAncillaryData).send({ from: owner });
      const fake = createFakeChunkedRelayer();
      stubGetCode(fake);
      await (await relayerWith(fake, 120_000, (buildOversizeProof(0).length - 2) / 2)).fetchAndRelayMessages();
      assert.lengthOf(fake.relayCalls, 1);
      assert.lengthOf(logsAtLevel("error"), 0);
    });

    it("is silent for already processed exits above MAX_CHUNKED_PROOF_BYTES", async function () {
      await oracleChild.methods.requestPrice(testIdentifier, testTimestamp, testAncillaryData).send({ from: owner });
      const fake = createFakeChunkedRelayer();
      stubGetCode(fake);
      stubProcessedExits(true);
      await (await relayerWith(fake, 120_000, 1000)).fetchAndRelayMessages();
      assert.lengthOf(
        logs().filter((log: any) => log.level !== "debug"),
        0
      );
    });

    it("logs an error on every run when the relay would exceed the per-transaction gas cap", async function () {
      await oracleChild.methods.requestPrice(testIdentifier, testTimestamp, testAncillaryData).send({ from: owner });
      const fake = createFakeChunkedRelayer();
      stubGetCode(fake);
      // 14M gas passes simulation, but runTransaction's 1.25x gas limit (17.5M) is above the 16,777,216 cap.
      fake.relayEstimatedGas = 14_000_000;
      const chunkCount = chunkHex(splitExitPayload(buildOversizeProof(0)).body).length;
      await (await relayerWith(fake)).fetchAndRelayMessages();
      await (await relayerWith(fake)).fetchAndRelayMessages();

      assert.lengthOf(fake.storeCalls, chunkCount); // Stored once, reused on the second run.
      assert.lengthOf(fake.relayCalls, 0);
      const errors = logsAtLevel("error");
      assert.lengthOf(errors, 2);
      for (const error of errors) {
        assert.equal(error.message, "Chunked relay failed after storing chunks🚨");
        assert.include(error.error, "per-transaction gas cap");
        assert.equal(error.chunkCount, chunkCount);
        assert.equal(error.messageIndex, 0);
      }
      assert.equal(errors[0].chunksStored, chunkCount);
      assert.equal(errors[1].chunksReused, chunkCount);
      assert.lengthOf(logsAtLevel("info"), 0);
    });

    it("local ABI matches the RootTunnelChunkedRelayer artifact", function () {
      if (!chunkedRelayerArtifactAvailable) this.skip();
      // web3.eth.Contract adds fields such as `signature` and `constant` to the ABI objects it is given, so compare only
      // the fields that define the interface.
      const normalize = ({ type, name, inputs, outputs, stateMutability, anonymous }: any) =>
        JSON.parse(JSON.stringify({ type, name, inputs, outputs, stateMutability, anonymous }));
      const artifactAbi = getContract("RootTunnelChunkedRelayer").abi;
      for (const item of ROOT_TUNNEL_CHUNKED_RELAYER_ABI) {
        const match = artifactAbi.find((a: any) => a.type === item.type && a.name === item.name);
        assert.isDefined(match, `${item.type} ${item.name}`);
        assert.deepEqual(normalize(item), normalize(match), `${item.type} ${item.name}`);
      }
    });

    it("relays end to end through a deployed RootTunnelChunkedRelayer", async function () {
      if (!chunkedRelayerArtifactAvailable) this.skip();
      const ChunkedRelayer = getContract("RootTunnelChunkedRelayer");
      const deployed = await ChunkedRelayer.new(oracleRoot.options.address).send({ from: owner });
      const chunkedRelayer = new web3.eth.Contract(ROOT_TUNNEL_CHUNKED_RELAYER_ABI, deployed.options.address);
      assert.equal(await chunkedRelayer.methods.MAX_CHUNK_SIZE().call(), MAX_CHUNK_SIZE.toString());
      assert.equal(await chunkedRelayer.methods.rootTunnel().call(), oracleRoot.options.address);

      const multicall = await Multicall.new().send({ from: owner });
      await registry.methods.registerContract([], multicall.options.address).send({ from: owner });
      const aggregate = await multicall.methods
        .aggregate([
          [
            oracleChild.options.address,
            oracleChild.methods.requestPrice(testIdentifier, testTimestamp, utf8ToHex("request:1")).encodeABI(),
          ],
          [
            oracleChild.options.address,
            oracleChild.methods.requestPrice(testIdentifier, testTimestamp, utf8ToHex("request:2")).encodeABI(),
          ],
        ])
        .send({ from: owner });
      const fromBlock = aggregate.blockNumber + 1;
      const relayer = new Relayer(
        spyLogger,
        owner,
        maticPosClient,
        oracleChild,
        oracleRoot,
        web3,
        polygonWeb3,
        0,
        await web3.eth.getBlockNumber(),
        120_000,
        chunkedRelayer
      );
      await relayer.fetchAndRelayMessages();

      const chunkCount = chunkHex(splitExitPayload(buildOversizeProof(0)).body).length;
      const stored = await chunkedRelayer.getPastEvents("ChunkStored", { fromBlock });
      assert.lengthOf(stored, chunkCount);
      // OracleRootTunnelMock.receiveMessage emits ReceivedMessage(bytes indexed inputData): its topic is the payload
      // hash, so this checks that each rebuilt payload equals the proof built for that message.
      const received = await oracleRoot.getPastEvents("ReceivedMessage", { fromBlock });
      assert.deepEqual(
        received.map((e: any) => e.raw.topics[1]),
        [web3.utils.keccak256(buildOversizeProof(0)), web3.utils.keccak256(buildOversizeProof(1))]
      );
      const infos = logsAtLevel("info");
      assert.deepEqual(
        infos.map((log: any) => [log.messageIndex, log.chunksStored, log.chunksReused]),
        [
          [0, chunkCount, 0],
          [1, 0, chunkCount],
        ]
      );
      assert.lengthOf(logsAtLevel("error"), 0);
      for (const info of infos) {
        const receipt = await web3.eth.getTransactionReceipt(info.tx);
        assert.isTrue(receipt.status);
      }
      assertNoPayloadDataInLogs(buildOversizeProof(0));
    });
  });
});

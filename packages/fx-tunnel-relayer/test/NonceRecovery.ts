import { assert } from "chai";
import sinon from "sinon";
import { Relayer } from "../src/Relayer";

const { PagerDutyV2Transport } = require("@uma/logger/dist/logger/PagerDutyV2Transport");

// Exercise the real transaction runner and nonce retry helper with isolated RPC and delivery boundaries.
describe("Relayer nonce recovery", function () {
  let relayer: Relayer;
  let logger: any;
  let transaction: any;
  let pendingNonce: any;
  let resolveIncident: any;
  let exitUtil: any;
  let clock: any;
  const messageEvent: any = { transactionHash: "0xABC", blockNumber: 10, logIndex: 4 };
  const expectedKey = "fx-tunnel-relayer:0xroot:0xabc:4";

  function broadcast(submissionError?: Error, receiptError?: Error, status = true): any {
    let resolveReceipt: any;
    let rejectReceipt: any;
    const receipt: any = new Promise((resolve, reject) => {
      resolveReceipt = resolve;
      rejectReceipt = reject;
    });
    receipt.on = (name: string, callback: (value: any) => void) => {
      if (name === "transactionHash" && !submissionError)
        Promise.resolve().then(() => {
          callback("0xrelay");
          if (receiptError) rejectReceipt(receiptError);
          else resolveReceipt({ status, transactionHash: "0xrelay" });
        });
      if (name === "error" && submissionError)
        Promise.resolve().then(() => {
          callback(submissionError);
          rejectReceipt(submissionError);
        });
      return receipt;
    };
    return receipt;
  }

  beforeEach(function () {
    clock = sinon.useFakeTimers();
    const transport = new PagerDutyV2Transport({ level: "error" }, { integrationKey: "test-only" });
    resolveIncident = sinon.stub(transport, "resolveIncident").resolves();
    logger = {
      debug: sinon.stub(),
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
      transports: [transport],
      writableLength: 0,
      readableLength: 0,
    };
    let nextNonce = 4;
    pendingNonce = sinon.spy((request: any, callback: any) => {
      assert.deepEqual(request.params, ["sender", "pending"]);
      callback(null, { result: `0x${(nextNonce++).toString(16)}` });
    });
    const web3: any = {
      eth: { getChainId: async () => 1 },
      currentProvider: { send: pendingNonce },
      utils: { toHex: (value: number) => `0x${value.toString(16)}`, toDecimal: (value: string) => parseInt(value, 16) },
      nonces: { sender: 999 },
    };
    transaction = {
      call: sinon.stub().resolves(),
      estimateGas: sinon.stub().resolves(100),
      send: sinon.stub().callsFake(() => broadcast()),
    };
    exitUtil = {
      isCheckPointed: sinon.stub().resolves(true),
      getChainBlockInfo: sinon.stub().resolves({}),
      buildPayloadForExit: sinon.stub().resolves("0xproof"),
    };
    relayer = new Relayer(
      logger,
      "sender",
      { getCurrentFastPrice: () => ({ maxFeePerGas: "10", maxPriorityFeePerGas: "1" }) },
      { exitUtil },
      {} as any,
      { options: { address: "0xRoot" }, methods: { receiveMessage: () => transaction } } as any,
      web3,
      {} as any,
      0,
      100
    );
  });

  afterEach(() => sinon.restore());

  it("rechecks the proof and pending nonce after a rejection, then resolves only the recovered message", async function () {
    transaction.send.onCall(0).callsFake(() => broadcast(new Error("nonce too low")));
    const result = relayer._relayMessage(messageEvent, 0);
    await clock.tickAsync(45500);
    await result;
    assert.equal(transaction.call.callCount, 2);
    assert.equal(transaction.send.callCount, 2);
    assert.deepEqual(
      transaction.send.getCalls().map((call: any) => call.args[0].nonce),
      [4, 5]
    );
    assert.equal(pendingNonce.callCount, 2);
    assert.equal(logger.warn.callCount, 1);
    assert.equal(logger.error.callCount, 0);
    sinon.assert.calledOnceWithExactly(resolveIncident, expectedKey, undefined);
    sinon.assert.callOrder(resolveIncident, logger.info);
  });

  it("pages once after exactly three failed submissions with a stable per-message key", async function () {
    transaction.send.callsFake(() => broadcast(new Error("replacement transaction underpriced")));
    const result = relayer._relayMessage(messageEvent, 0);
    await clock.tickAsync(45500);
    await result;
    assert.equal(transaction.send.callCount, 3);
    assert.equal(logger.warn.callCount, 2);
    assert.equal(logger.error.callCount, 1);
    assert.equal(logger.error.firstCall.args[0].pagerDutyDedupKey, expectedKey);
    assert.equal(resolveIncident.callCount, 0);
  });

  it("resolves after another sender completes the exit during a nonce retry", async function () {
    transaction.send.onCall(0).callsFake(() => broadcast(new Error("nonce too low")));
    transaction.call.onCall(1).rejects(new Error("execution reverted: EXIT_ALREADY_PROCESSED"));
    const result = relayer._relayMessage(messageEvent, 0);
    await clock.tickAsync(45500);
    await result;
    assert.equal(transaction.send.callCount, 1);
    assert.equal(logger.error.callCount, 0);
    sinon.assert.calledOnceWithExactly(resolveIncident, expectedKey, undefined);
  });

  it("uses the same incident key across runs and distinct keys for messages in one transaction", async function () {
    transaction.send.callsFake(() => broadcast(new Error("nonce too low")));
    const failed = relayer._relayMessage(messageEvent, 0);
    await clock.tickAsync(45500);
    await failed;
    const failureKey = logger.error.firstCall.args[0].pagerDutyDedupKey;
    transaction.call.rejects(new Error("EXIT_ALREADY_PROCESSED"));
    await relayer._relayMessage(messageEvent, 0);
    await relayer._relayMessage({ ...messageEvent, logIndex: 7 }, 1);
    assert.equal(resolveIncident.firstCall.args[0], failureKey);
    assert.equal(resolveIncident.secondCall.args[0], "fx-tunnel-relayer:0xroot:0xabc:7");
  });

  for (const message of ["request timeout", "already known", "execution reverted: invalid proof"]) {
    it(`does not retry or resolve an ambiguous/unrelated error: ${message}`, async function () {
      transaction.send.callsFake(() => broadcast(new Error(message)));
      await relayer._relayMessage(messageEvent, 0);
      assert.equal(transaction.send.callCount, 1);
      assert.equal(logger.error.callCount, 1);
      assert.equal(resolveIncident.callCount, 0);
    });
  }

  it("does not resubmit a receipt failure even if it contains a nonce rejection code", async function () {
    const error = Object.assign(new Error("nonce too low"), { code: "NONCE_EXPIRED" });
    transaction.send.callsFake(() => broadcast(undefined, error));
    await relayer._relayMessage(messageEvent, 0);
    assert.equal(transaction.send.callCount, 1);
    assert.equal(logger.error.callCount, 1);
    assert.equal(resolveIncident.callCount, 0);
  });

  it("does not resolve an unsuccessful receipt", async function () {
    transaction.send.callsFake(() => broadcast(undefined, undefined, false));
    await relayer._relayMessage(messageEvent, 0);
    assert.equal(logger.error.callCount, 1);
    assert.equal(resolveIncident.callCount, 0);
  });

  it("does not resolve skipped/uncheckpointed messages or unknown RPC errors", async function () {
    exitUtil.isCheckPointed.resolves(false);
    await relayer._relayMessage(messageEvent, 0);
    assert.equal(transaction.send.callCount, 0);
    assert.equal(resolveIncident.callCount, 0);
    exitUtil.isCheckPointed.rejects(new Error("RPC unavailable"));
    const error = await relayer._relayMessage(messageEvent, 0).catch((error) => error);
    assert.equal(error.message, "RPC unavailable");
    assert.equal(resolveIncident.callCount, 0);
  });

  it("retains proof-failure paging without marking the message recovered", async function () {
    exitUtil.buildPayloadForExit.rejects(new Error("proof unavailable"));
    await relayer._relayMessage(messageEvent, 0);
    assert.equal(logger.error.firstCall.args[0].pagerDutyDedupKey, expectedKey);
    assert.equal(transaction.send.callCount, 0);
    assert.equal(resolveIncident.callCount, 0);
  });

  it("awaits recovery delivery before reporting success", async function () {
    let finishRecovery: any;
    resolveIncident.callsFake(
      () =>
        new Promise<void>((resolve) => {
          finishRecovery = resolve;
        })
    );
    const result = relayer._relayMessage(messageEvent, 0);
    await clock.tickAsync(0);
    assert.equal(resolveIncident.callCount, 1);
    assert.equal(logger.info.callCount, 0);
    finishRecovery();
    await result;
    assert.equal(logger.info.callCount, 1);
  });

  it("keeps a confirmed exit successful if PagerDuty resolution fails", async function () {
    resolveIncident.rejects(new Error("PagerDuty unavailable"));
    await relayer._relayMessage(messageEvent, 0);
    assert.equal(logger.warn.callCount, 1);
    assert.equal(logger.error.callCount, 0);
    assert.equal(logger.info.callCount, 1);
    sinon.assert.callOrder(logger.warn, logger.info);
  });
});

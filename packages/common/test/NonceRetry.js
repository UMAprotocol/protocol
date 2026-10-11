const { assert } = require("chai");
const sinon = require("sinon");
const { isNonceConflict, retryOnNonceConflict } = require("../dist/NonceRetry");

describe("NonceRetry", function () {
  afterEach(() => sinon.restore());

  it("recognizes explicit codes and nested web3 rejection messages without reading transaction payloads", function () {
    for (const error of [
      { code: "NONCE_EXPIRED" },
      { transactionHash: "0xlocallycomputed", code: "NONCE_EXPIRED" },
      { code: "REPLACEMENT_UNDERPRICED" },
      new Error("Returned error: nonce too low"),
      { error: { error: new Error("replacement transaction underpriced") } },
    ])
      assert.isTrue(isNonceConflict(error));
    const error = { error: { code: "NONCE_EXPIRED" }, toJSON: () => assert.fail("Must not serialize errors") };
    error.error.error = error;
    assert.isTrue(isNonceConflict(error));
    assert.isFalse(isNonceConflict({ transaction: { data: "nonce too low" } }));
  });

  it("rejects ambiguous broadcasts, receipts, simulations, reverts, and unrelated errors", function () {
    for (const error of [
      undefined,
      new Error("already known"),
      new Error("nonce too high"),
      new Error("insufficient funds"),
      { code: "TIMEOUT", error: { code: "NONCE_EXPIRED" } },
      { code: "NONCE_EXPIRED", error: new Error("request timed out") },
      { code: "NONCE_EXPIRED", error: new Error("already known") },
      { code: "CALL_EXCEPTION", error: new Error("nonce too low") },
      { type: "call", message: "nonce too low" },
      { receipt: {}, code: "NONCE_EXPIRED" },
      { transactionHash: "0x123", code: "TIMEOUT" },
      new Error("execution reverted: nonce too low"),
    ])
      assert.isFalse(isNonceConflict(error));
  });

  it("retries with bounded 15s/30s delays and jitter, then returns the recovered result", async function () {
    const clock = sinon.useFakeTimers();
    sinon.stub(Math, "random").returns(1 - Number.EPSILON);
    const operation = sinon.stub();
    operation.onCall(0).rejects(Object.assign(new Error("rejected"), { code: "NONCE_EXPIRED" }));
    operation.onCall(1).rejects(new Error("replacement transaction underpriced"));
    operation.onCall(2).resolves("complete");
    const onRetry = sinon.spy();
    const result = retryOnNonceConflict(operation, onRetry);
    await clock.tickAsync(15249);
    assert.equal(operation.callCount, 1);
    await clock.tickAsync(1);
    assert.equal(operation.callCount, 2);
    await clock.tickAsync(30249);
    assert.equal(operation.callCount, 2);
    await clock.tickAsync(1);
    assert.equal(await result, "complete");
    assert.equal(operation.callCount, 3);
    assert.deepEqual(
      onRetry.getCalls().map((call) => call.args[1]),
      [1, 2]
    );
  });

  it("rethrows the final rejection after exactly three attempts", async function () {
    const clock = sinon.useFakeTimers();
    const error = new Error("nonce too low");
    const operation = sinon.stub().rejects(error);
    const result = retryOnNonceConflict(operation).catch((caught) => caught);
    await clock.tickAsync(45500);
    assert.strictEqual(await result, error);
    assert.equal(operation.callCount, 3);
  });

  it("does not retry an uncertain broadcast", async function () {
    const error = Object.assign(new Error("request timeout"), { code: "TIMEOUT" });
    const operation = sinon.stub().rejects(error);
    const onRetry = sinon.spy();
    assert.strictEqual(await retryOnNonceConflict(operation, onRetry).catch((caught) => caught), error);
    assert.equal(operation.callCount, 1);
    assert.equal(onRetry.callCount, 0);
  });
});

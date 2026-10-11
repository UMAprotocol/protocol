const { assert } = require("chai");
const sinon = require("sinon");
const { runTransaction } = require("../dist/TransactionUtils");

describe("runTransaction uncached nonce", function () {
  it("uses fresh pending nonces (including zero) after a rejected send without reading or changing the cache", async function () {
    const nonces = [0, 9];
    const providerSend = sinon.spy((request, callback) => {
      assert.deepEqual(request.params, ["sender", "pending"]);
      callback(null, { result: `0x${nonces.shift().toString(16)}` });
    });
    const web3 = {
      eth: { getChainId: async () => 1 },
      currentProvider: { send: providerSend },
      utils: { toHex: (value) => `0x${value.toString(16)}`, toDecimal: (value) => parseInt(value, 16) },
    };
    Object.defineProperty(web3, "nonces", {
      get: () => assert.fail("Uncached submissions must not read the nonce cache"),
      set: () => {
        assert.fail("Uncached submissions must not write the nonce cache");
      },
    });
    const rejected = new Error("nonce too low");
    const transaction = {
      call: sinon.stub().resolves("ok"),
      estimateGas: sinon.stub().resolves(100),
      send: sinon.stub(),
    };
    transaction.send.onCall(0).rejects(rejected);
    transaction.send.onCall(1).resolves({ status: true, transactionHash: "0xaccepted" });
    const submit = () =>
      runTransaction({
        web3,
        transaction,
        transactionConfig: { from: "sender", gasPrice: "1", nonce: 999 },
        useCachedNonce: false,
      });
    assert.strictEqual(await submit().catch((error) => error), rejected);
    await submit();
    assert.deepEqual(
      transaction.send.getCalls().map((call) => call.args[0].nonce),
      [0, 9]
    );
    assert.equal(transaction.call.callCount, 2);
    assert.equal(providerSend.callCount, 2);
  });

  it("preserves optimistic cache advancement for callers using the default mode", async function () {
    // Load an isolated module with non-test argv, since the established cached path disables itself in tests.
    const modulePath = require.resolve("../dist/TransactionUtils");
    const originalModule = require.cache[modulePath];
    const originalArgv = process.argv;
    let runCachedTransaction;
    try {
      process.argv = ["node", "nonce-cache-regression"];
      delete require.cache[modulePath];
      runCachedTransaction = require(modulePath).runTransaction;
    } finally {
      process.argv = originalArgv;
      require.cache[modulePath] = originalModule;
    }
    const web3 = {
      eth: { getChainId: async () => 1, getTransactionCount: async () => 5 },
      currentProvider: { send: (_request, callback) => callback(null, { result: "0x5" }) },
      utils: { toHex: (value) => `0x${value.toString(16)}`, toDecimal: (value) => parseInt(value, 16) },
      nonces: { sender: 7 },
    };
    const transaction = {
      call: sinon.stub().resolves(),
      estimateGas: sinon.stub().resolves(100),
      send: sinon.stub().resolves({ status: true, transactionHash: "0xaccepted" }),
    };
    await runCachedTransaction({ web3, transaction, transactionConfig: { from: "sender", gasPrice: "1" } });
    assert.equal(transaction.send.firstCall.args[0].nonce, 8);
    assert.equal(web3.nonces.sender, 8);
  });
});

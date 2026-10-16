const { strict: assert } = require("assert");
const { BigNumber, constants, utils } = require("ethers");
require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "commonjs", esModuleInterop: true } });
const {
  ADDRESSES,
  AMOUNT,
  EXPLANATION,
  polygonCalls,
  proposalTransactions,
  assertProposal,
  assertStartingState,
  verifyPolygonReceipts,
  proposalId,
  rootInterface,
  storeInterface,
  tokenInterface,
  childInterface,
} = require("../src/admin-proposals/refund-polygon-proposer-and-transfer-withdrawer/common");

const {
  STATE_RECEIVER,
  stateInterface,
  decodeStateSyncMessages,
  verifyStateCommits,
  findPolygonReceipts,
} = require("../src/admin-proposals/refund-polygon-proposer-and-transfer-withdrawer/stateSync");

const explanation = utils.hexlify(utils.toUtf8Bytes(EXPLANATION));
const contracts = (withdrawer = ADDRESSES.multisig, balance = AMOUNT) => ({
  store: { getMember: async (role) => (role === 0 ? ADDRESSES.child : withdrawer) },
  token: { balanceOf: async () => balance },
});

function receipts(amount = AMOUNT) {
  return polygonCalls().map((call, i) => {
    const result = { status: 1, transactionHash: utils.hexZeroPad(utils.hexlify(i + 1), 32), logs: [] };
    const add = (address, iface, name, args) => {
      result.logs.push({
        address,
        ...iface.encodeEventLog(iface.getEvent(name), args),
        blockNumber: 100 + i,
        logIndex: result.logs.length,
        transactionHash: result.transactionHash,
      });
    };
    if (i === 1) add(ADDRESSES.token, tokenInterface, "Transfer", [ADDRESSES.store, ADDRESSES.child, amount]);
    if (i === 2) add(ADDRESSES.token, tokenInterface, "Transfer", [ADDRESSES.child, ADDRESSES.recipient, amount]);
    add(ADDRESSES.child, childInterface, "ExecutedGovernanceTransaction", [call.to, call.data]);
    return result;
  });
}

const stateIds = [101, 102, 103, 104].map(BigNumber.from);
function batchedReceipt() {
  const receipt = { status: 1, gasUsed: BigNumber.from(0), transactionHash: utils.hexZeroPad("0x42", 32), logs: [] };
  const commit = (id, success) => ({
    address: STATE_RECEIVER,
    ...stateInterface.encodeEventLog(stateInterface.getEvent("StateCommitted"), [id, success]),
  });
  // Include unrelated system messages and token logs in the same synthetic transaction.
  receipt.logs.push(commit(99, false), { address: constants.AddressZero, topics: [], data: "0x" });
  receipts().forEach((r, i) => receipt.logs.push(...r.logs, commit(stateIds[i], true)));
  receipt.logs.push(commit(105, true));
  receipt.logs.forEach((log, i) =>
    Object.assign(log, { blockNumber: 100, logIndex: i, transactionHash: receipt.transactionHash })
  );
  return receipt;
}

function l1Receipt() {
  return {
    status: 1,
    logs: polygonCalls().map((call, i) => ({
      address: ADDRESSES.proposer, // fixture state sender
      ...stateInterface.encodeEventLog(stateInterface.getEvent("StateSynced"), [
        stateIds[i],
        ADDRESSES.child, // fixture FxChild
        utils.defaultAbiCoder.encode(
          ["address", "address", "bytes"],
          [ADDRESSES.root, ADDRESSES.child, utils.defaultAbiCoder.encode(["address", "bytes"], [call.to, call.data])]
        ),
      ]),
    })),
  };
}

describe("Polygon proposer refund and withdrawer handover", function () {
  it("encodes the fixed refund and exclusive-role replacement in four root tunnel relays", function () {
    const transactions = proposalTransactions();
    assert.equal(transactions.length, 4);
    const decoded = transactions.map((tx) => {
      assert.equal(tx.to, "0x4F490F4835B3693A8874aee87D7CC242c25DCCAf");
      assert(BigNumber.from(tx.value).isZero());
      return rootInterface.decodeFunctionData("relayGovernance", tx.data);
    });
    assert.equal(decoded[0].to, "0xE58480CA74f1A819faFd777BEDED4E2D5629943d");
    const firstRole = storeInterface.decodeFunctionData("resetMember", decoded[0].data);
    assert.equal(firstRole[0].toString(), "1");
    assert.equal(firstRole[1], "0xb4AeaD497FCbEAA3C37919032d42C29682f46376");
    assert.equal(decoded[1].to, decoded[0].to);
    const withdrawal = storeInterface.decodeFunctionData("withdrawErc20", decoded[1].data);
    assert.equal(withdrawal[0], "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174");
    assert.equal(withdrawal[1].toString(), "37875000000");
    assert.equal(decoded[2].to, withdrawal[0]);
    const payment = tokenInterface.decodeFunctionData("transfer", decoded[2].data);
    assert.equal(payment[0], "0xa0B6210f5B522b97bbcE9B8E617627105c0e3891");
    assert.equal(payment[1].toString(), "37875000000");
    assert.equal(decoded[3].to, decoded[0].to);
    const lastRole = storeInterface.decodeFunctionData("resetMember", decoded[3].data);
    assert.equal(lastRole[0].toString(), "1");
    assert.equal(lastRole[1], "0x6ee4D971142afadEa1828445124D6137080B4146");
  });

  it("rejects a different, reordered, or partially executed proposal", function () {
    assertProposal(proposalTransactions(), explanation);
    const cases = [
      proposalTransactions().slice(0, 3),
      proposalTransactions().reverse(),
      proposalTransactions().map((tx, i) => (i === 0 ? { ...tx, value: 1 } : tx)),
      proposalTransactions().map((tx, i) => (i === 0 ? { ...tx, to: constants.AddressZero } : tx)),
      proposalTransactions().map((tx, i) => (i === 2 ? { ...tx, data: "0x" } : tx)),
    ];
    cases.forEach((transactions) => assert.throws(() => assertProposal(transactions, explanation)));
    assert.throws(() => assertProposal(proposalTransactions(), "0x"));
  });

  it("requires an explicit valid proposal ID", function () {
    const previous = process.env.PROPOSAL_ID;
    try {
      for (const value of [undefined, "", "-1", "1.5", "abc", "9007199254740992"]) {
        if (value === undefined) delete process.env.PROPOSAL_ID;
        else process.env.PROPOSAL_ID = value;
        assert.throws(proposalId);
      }
      process.env.PROPOSAL_ID = "123";
      assert.equal(proposalId(), 123);
    } finally {
      if (previous === undefined) delete process.env.PROPOSAL_ID;
      else process.env.PROPOSAL_ID = previous;
    }
  });

  it("rejects an unexpected initial withdrawer or insufficient funds", async function () {
    await assertStartingState(contracts(ADDRESSES.proposerWallet));
    await assert.rejects(assertStartingState(contracts()), /Unexpected initial Store withdrawer/);
    await assert.rejects(assertStartingState(contracts(ADDRESSES.proposerWallet, AMOUNT.sub(1))), /Insufficient Store/);
  });

  it("verifies all four relays, payment events and the final role without relying on current balances", async function () {
    await verifyPolygonReceipts(contracts(ADDRESSES.multisig, BigNumber.from(0)), receipts().reverse());
  });

  it("rejects missing, failed and duplicate relay receipts", async function () {
    await assert.rejects(verifyPolygonReceipts(contracts(), receipts().slice(0, 3)), /all four/);
    const failed = receipts();
    failed[2].status = 0;
    await assert.rejects(verifyPolygonReceipts(contracts(), failed), /transaction failed/);
    const duplicate = receipts();
    await assert.rejects(verifyPolygonReceipts(contracts(), [...duplicate, duplicate[0]]), /Duplicate/);
  });

  it("rejects a successful call with no token transfer, the wrong amount, or an unrelated token", async function () {
    const noTransfer = receipts();
    noTransfer[2].logs.shift();
    await assert.rejects(verifyPolygonReceipts(contracts(), noTransfer), /exactly one USDC.e transfer/);
    await assert.rejects(verifyPolygonReceipts(contracts(), receipts(AMOUNT.sub(1))), /Incorrect refund amount/);
    const unrelatedToken = receipts();
    unrelatedToken[2].logs[0].address = ADDRESSES.votingToken;
    await assert.rejects(verifyPolygonReceipts(contracts(), unrelatedToken), /exactly one USDC.e transfer/);
  });

  it("rejects altered governance calls and execution in the wrong order", async function () {
    const altered = receipts();
    Object.assign(
      altered[3].logs[0],
      childInterface.encodeEventLog(childInterface.getEvent("ExecutedGovernanceTransaction"), [
        ADDRESSES.store,
        storeInterface.encodeFunctionData("resetMember", [1, ADDRESSES.proposerWallet]),
      ])
    );
    await assert.rejects(verifyPolygonReceipts(contracts(), altered), /Unexpected Polygon calldata/);
    const reordered = receipts();
    reordered[3].logs[0].blockNumber = 99;
    await assert.rejects(verifyPolygonReceipts(contracts(), reordered), /Unexpected Polygon calldata/);
  });

  it("rejects a refund that leaves governance or the HSM as withdrawer", async function () {
    for (const withdrawer of [ADDRESSES.child, ADDRESSES.proposerWallet]) {
      await assert.rejects(verifyPolygonReceipts(contracts(withdrawer), receipts()), /sole withdrawer/);
    }
  });
  it("verifies four messages batched into one system receipt with unrelated logs", async function () {
    const receipt = batchedReceipt();
    verifyStateCommits([receipt], stateIds);
    await verifyPolygonReceipts(contracts(), [receipt]);
  });

  it("rejects failed, absent, duplicate, reordered and wrong-emitter state commits despite receipt status 1", function () {
    const commitTopic = stateInterface.getEventTopic("StateCommitted");
    for (const mutation of ["failed", "missing", "duplicate", "order", "emitter"]) {
      const receipt = batchedReceipt();
      const index = receipt.logs.findIndex(
        (log) => log.topics[0] === commitTopic && stateInterface.parseLog(log).args.stateId.eq(102)
      );
      const log = receipt.logs[index];
      if (mutation === "failed")
        Object.assign(log, stateInterface.encodeEventLog(stateInterface.getEvent("StateCommitted"), [102, false]));
      if (mutation === "missing") receipt.logs.splice(index, 1);
      if (mutation === "duplicate") receipt.logs.push({ ...log });
      if (mutation === "order") log.logIndex = 0;
      if (mutation === "emitter") log.address = ADDRESSES.child;
      assert.throws(() => verifyStateCommits([receipt], stateIds));
    }
  });

  it("still rejects missing child execution events when a system receipt has status 1", async function () {
    const receipt = batchedReceipt();
    const index = receipt.logs.findIndex(
      (log) => log.topics[0] === childInterface.getEventTopic("ExecutedGovernanceTransaction")
    );
    receipt.logs.splice(index, 1);
    await assert.rejects(verifyPolygonReceipts(contracts(), [receipt]), /all four/);
  });

  it("authenticates the L1 sender, FxChild, root, child and exact ordered governance payloads", function () {
    const decode = (receipt) => decodeStateSyncMessages(receipt, ADDRESSES.proposer, ADDRESSES.child);
    assert.deepEqual(
      decode(l1Receipt()).map((message) => message.id.toString()),
      stateIds.map(String)
    );
    for (const mutation of ["status", "sender", "receiver", "root", "child", "payload", "order", "duplicate"]) {
      const receipt = l1Receipt();
      const log = receipt.logs[0];
      if (mutation === "status") receipt.status = 0;
      if (mutation === "sender") log.address = constants.AddressZero;
      if (mutation === "order") receipt.logs.reverse();
      if (mutation === "duplicate") receipt.logs[1] = log;
      if (["receiver", "root", "child", "payload"].includes(mutation)) {
        const args = stateInterface.parseLog(log).args;
        const [root, child, data] = utils.defaultAbiCoder.decode(["address", "address", "bytes"], args.data);
        Object.assign(
          log,
          stateInterface.encodeEventLog(stateInterface.getEvent("StateSynced"), [
            args.id,
            mutation === "receiver" ? constants.AddressZero : args.contractAddress,
            utils.defaultAbiCoder.encode(
              ["address", "address", "bytes"],
              [
                mutation === "root" ? constants.AddressZero : root,
                mutation === "child" ? constants.AddressZero : child,
                mutation === "payload" ? "0x" : data,
              ]
            ),
          ])
        );
      }
      assert.throws(() => decode(receipt), mutation);
    }
  });

  it("discovers distinct system receipts by ID across bounded block queries", async function () {
    const receipt = batchedReceipt();
    const queries = [];
    const fetched = [];
    const provider = {
      getLogs: async (filter) => {
        queries.push(filter);
        return filter.fromBlock === 2000
          ? receipt.logs.filter((log) => log.topics[0] === filter.topics[0] && filter.topics[1].includes(log.topics[1]))
          : [];
      },
      getTransactionReceipt: async (hash) => {
        fetched.push(hash);
        return receipt;
      },
    };
    assert.deepEqual(await findPolygonReceipts(provider, stateIds, 0, 4500), [receipt]);
    assert.deepEqual(
      queries.map(({ fromBlock, toBlock }) => [fromBlock, toBlock]),
      [
        [0, 1999],
        [2000, 3999],
      ]
    );
    assert.deepEqual(fetched, [receipt.transactionHash]);
    assert.equal(queries[0].address, STATE_RECEIVER);
    await assert.rejects(
      findPolygonReceipts({ ...provider, getLogs: async () => [] }, stateIds, 0, 100),
      /State syncs not found/
    );
    await assert.rejects(
      findPolygonReceipts({ ...provider, getTransactionReceipt: async () => null }, stateIds, 2000, 2100),
      /receipt not found/
    );
  });
});

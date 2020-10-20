const test = require("tape");
const lodash = require("lodash");
const { AttributionHistory, EmpBalancesHistory } = require("../libs/processors");
const logs = require("../datasets/uUSDwETH-DEC-logs");
const transactions = require("../datasets/uUSDwETH-DEC-transactions");
const { DecodeLog, DecodeTransaction } = require("../libs/contracts");
const { abi } = require("../../core/build/contracts/ExpiringMultiParty");

test("AttributionHistory", t => {
  let processor;
  t.test("init", t => {
    processor = AttributionHistory();
    t.ok(processor);
    t.ok(processor.history);
    t.ok(processor.attributions);
    t.end();
  });
  t.test("process events", t => {
    const events = lodash.times(100, i => {
      return {
        blockNumber: i + 1,
        args: ["useraddr " + (i % 13), "affiliateaddr " + (i % 3), (i * 100).toString()]
      };
    });
    events.forEach(e => processor.handleEvent(e.blockNumber, e.args));

    lodash.times(100, i => {
      const snapshot = processor.history.lookup(i + 1);
      console.log("snapshot", snapshot);
      t.ok(snapshot.attributions);
      t.equal(snapshot.blockNumber, i + 1);
    });

    t.end();
  });
  t.test("process Dataset", t => {
    // create a new AttributionHistory
    attributionsHistory = AttributionHistory();
    decode = DecodeTransaction(abi);
    console.log("transactions", transactions);

    transactions.forEach(transaction => {
      try {
        console.log("pre-decode", transaction);
        transaction = decode(transaction, { blockNumber: transaction.block_number });
        console.log("Decoded tx", transaction);
        attributionsHistory.handleTransaction(transaction.blockNumber, transaction);
        // attributionsHistory.handleEvent(transaction.blockNumber, transaction);
      } catch (err) {
        // decoding transaction error, abi probably missing an event
        console.log("error decoding transaction:", err);
      }
    });

    transactions.forEach(e => processor.handelTransaction(e.blockNumber, e.args));

    lodash.times(100, i => {
      const snapshot = processor.history.lookup(i + 1);
      console.log("snapshot", snapshot);
      t.ok(snapshot.attributions);
      t.equal(snapshot.blockNumber, i + 1);
    });

    t.end();
  });
});
test("Process Datset", t => {
  let balancesHistory, attributionsHistory, decode;
  t.test("init", t => {
    balancesHistory = EmpBalancesHistory();
    attributionsHistory = AttributionHistory();
    decode = DecodeLog(abi);
    t.ok(balancesHistory);
    t.ok(attributionsHistory);
    t.end();
  });
  t.test("balances", t => {
    logs.forEach(log => {
      try {
        log = decode(log, { blockNumber: log.block_number });
        balancesHistory.handleEvent(log.blockNumber, log);
      } catch (err) {
        // decoding log error, abi probably missing an event
        console.log("error decoding log:", err);
      }
    });
    t.ok(balancesHistory.balances.collateral.snapshot());
    t.ok(balancesHistory.balances.tokens.snapshot());
    t.end();
  });
});

const test = require("tape");
const lodash = require("lodash");
const { AttributionHistory, EmpBalancesHistory } = require("../libs/processors");
const logs = require("../datasets/uUSDwETH-DEC-logs");
const transactions = require("../datasets/uUSDwETH-DEC-transactions");
const { DecodeLog, decodeAttribution, DecodeTransaction } = require("../libs/contracts");
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
  t.test("process Dataset", t => {
    // create a new AttributionHistory
    attributionsHistory = AttributionHistory();
    decode = DecodeTransaction(abi);
    const allowedTransactions = ["create", "deposit", "depositTo"];

    transactions.forEach(transaction => {
      try {
        const decoded = decode(transaction, {
          // the transaction handler requires these fields which are on the raw transaction data
          blockNumber: transaction.block_number,
          fromAddress: transaction.from_address,
          input: transaction.input
        });
        // filter transactions we shouldnt process, could probably just do this in the handlers too
        if (!allowedTransactions.includes(decoded.name)) return;
        attributionsHistory.handleTransaction(decoded.blockNumber, decoded);
      } catch (err) {
        // decoding transaction error, abi probably missing an event
        console.log("error decoding transaction:", err);
      }
    });
    t.ok(attributionsHistory.history.length());
    // shows all snapshots
    // console.log(JSON.stringify(attributionsHistory.history.history,undefined,2))
    t.end();
  });
});
// TODO: add more tests for EmpBalances, EmpBalanceHistory

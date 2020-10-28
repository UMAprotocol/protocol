const { assert } = require("chai");
const { AttributionHistory } = require("../libs/processors");
const transactions = require("../datasets/uUSDwETH-DEC-transactions");
const { DecodeTransaction } = require("../libs/contracts");
const { abi } = require("../../core/build/contracts/ExpiringMultiParty");

describe("AttributionHistory", function() {
  let processor;
  it("init", function() {
    processor = AttributionHistory();
    assert.ok(processor);
    assert.ok(processor.history);
    assert.ok(processor.attributions);
  });
  it("process Dataset", function() {
    this.timeout(10000);
    // create a new AttributionHistory
    const attributionsHistory = AttributionHistory();
    const decode = DecodeTransaction(abi);
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
    assert.ok(attributionsHistory.history.length());
    // shows all snapshots
    // console.log(JSON.stringify(attributionsHistory.history.history,undefined,2))
  });
});
// TODO: add more tests for EmpBalances, EmpBalanceHistory

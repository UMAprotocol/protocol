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
  // this test needs to be updated
  // t.test("process events", t => {
  //   const events = lodash.times(100, i => {
  //     return {
  //       blockNumber: i + 1,
  //       args: ["useraddr " + (i % 13), "affiliateaddr " + (i % 3), ((i + 1)).toString()]
  //     };
  //   });
  //   events.forEach(e => processor.handleEvent(e.blockNumber, e.args));

  //   lodash.times(100, i => {
  //     const snapshot = processor.history.lookup(i + 1);
  //     console.log("snapshot", snapshot);
  //     t.ok(snapshot.attributions);
  //     t.equal(snapshot.blockNumber, i + 1);
  //   });

  //   t.end();
  // });
  t.test("process Dataset", t => {
    // create a new AttributionHistory
    attributionsHistory = AttributionHistory();
    decode = DecodeTransaction(abi);
    console.log("transactions", transactions);
    const allowedTransactions = ['create','deposit','depositTo']

    transactions.forEach(transaction => {
      try {
        console.log("pre-decode", transaction);
        const decoded = decode(transaction, { 
          // the transaction handler requires these fields which are on the raw transaction data
          blockNumber: transaction.block_number,
          fromAddress:transaction.from_address,
          input:transaction.input 
        });
        // filter transactions we shouldnt process, could probably just do this in the handlers too
        if(!allowedTransactions.includes(decoded.name)) return
        console.log("Decoded tx", decoded);
        attributionsHistory.handleTransaction(decoded.blockNumber, decoded)
      } catch (err) {
        // decoding transaction error, abi probably missing an event
        console.log("error decoding transaction:", err);
      }
    });
    t.ok(attributionsHistory.history.length())
    // shows all snapshots
    // console.log(JSON.stringify(attributionsHistory.history.history,undefined,2))
    t.end();
  });
});
// test("Process Both Datsets", t => {
//   let balancesHistory, attributionsHistory, decodeLog, decodeTx;
//   t.test("init", t => {
//     balancesHistory = EmpBalancesHistory();
//     attributionsHistory = AttributionHistory();
//     decodeLog = DecodeLog(abi);
//     decodeTx = DecodeTransaction(abi);
//     t.ok(balancesHistory);
//     t.ok(attributionsHistory);
//     t.end();
//   });
//   t.test("balances", t => {
//     logs.forEach(log => {
//       try {
//         log = decodeLog(log, { blockNumber: log.block_number });
//         balancesHistory.handleEvent(log.blockNumber, log);
//       } catch (err) {
//         // decoding log error, abi probably missing an event
//         console.log("error decoding log:", err);
//       }
//     });
//     t.ok(balancesHistory.balances.collateral.snapshot());
//     t.ok(balancesHistory.balances.tokens.snapshot());
//     t.end();
//   });
//   t.test("process transactions", t => {
//     transactions.forEach(tx => {
//       try {
//         console.log(tx)
//         const attribution = decodeAttribution(tx.input)
//         const decoded = decodeTx({data:tx.input,value:tx.value})
//         console.log(tx,attribution,decoded)
//         // const result = decodetx({data:tx.input,value:tx.value},{input:tx.input,blockNumber:tx.block_number})
//       } catch (err) {
//         // decoding log error, abi probably missing an event
//         console.log("error decoding log:", err);
//       }
//     });
//     t.end();
//   });
// });

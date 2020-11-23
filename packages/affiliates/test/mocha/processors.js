// TODO: This needs to be updated to have a generated dataset through libs/dataset
const Path = require("path");
const { assert } = require("chai");

const { getAbi } = require("@uma/core");

const { AttributionHistory, EmpBalances, EmpBalancesHistory } = require("../../libs/processors");
const transactions = require("../datasets/tagged-transactions/0xaBBee9fC7a882499162323EEB7BF6614193312e3.json");
const { DecodeLog, DecodeTransaction } = require("../../libs/contracts");
const { mocks } = require("../../libs/datasets");

const datasetPath = Path.join(__dirname, "../datasets/set1");
const params = require(Path.join(datasetPath, "/config.json"));
const abi = getAbi("ExpiringMultiParty");

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
  });
});
describe("EmpBalances", function() {
  let balances, queries, decode;
  it("inits", function() {
    balances = EmpBalances();
    decode = DecodeLog(abi);
    queries = mocks.Queries(datasetPath);
    assert(balances);
    assert(queries);
  });
  it("process dataset", async function() {
    await queries
      .streamLogsByContract(params.empContracts[0])
      .map(log => {
        return decode(log, { blockNumber: log.block_number, blockTimestamp: log.block_timestamp });
      })
      .doto(log => balances.handleEvent(log))
      .last()
      .toPromise(Promise);
    assert(balances.collateral);
    const collateral = balances.collateral.snapshot();
    assert(Object.keys(collateral).length);
    const tokens = balances.tokens.snapshot();
    assert(Object.keys(tokens).length);
  });
});

describe("EmpBalancesHistory", function() {
  let history, queries, decode;
  it("inits", function() {
    history = EmpBalancesHistory();
    decode = DecodeLog(abi);
    queries = mocks.Queries(datasetPath);
    assert(history);
    assert(queries);
  });
  it("process dataset", async function() {
    let start, end;
    await queries
      .streamLogsByContract(params.empContracts[0])
      .map(log => {
        return decode(log, { blockNumber: log.block_number, blockTimestamp: log.block_timestamp });
      })
      .doto(log => {
        if (start == null) start = log.blockNumber;
        end = log.blockNumber;
      })
      .doto(log => history.handleEvent(log.blockNumber, log))
      .last()
      .toPromise(Promise);
    history.finalize();
    assert(history.balances.collateral);
    const collateral = history.balances.collateral.snapshot();
    assert(Object.keys(collateral).length);
    const tokens = history.balances.tokens.snapshot();
    assert(Object.keys(tokens).length);

    // lookup balances in the middle of range
    const midsnapshot = history.history.lookup(Math.floor((end - start) / 2) + start);
    assert(midsnapshot.collateral);
    assert(midsnapshot.tokens);
    const endsnapshot = history.history.get(end);
    assert(endsnapshot.collateral);
    assert(endsnapshot.tokens);
    const startsnapshot = history.history.get(start);
    assert(startsnapshot.collateral);
    assert(startsnapshot.tokens);
  });
});

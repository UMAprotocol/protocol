// TODO: This needs to be updated to have a generated dataset through libs/dataset
const Path = require("path");
const { assert } = require("chai");

const { getAbi } = require("@uma/core");
const { getWeb3 } = require("@uma/common");

const { EmpAttributions, EmpBalances, EmpBalancesHistory } = require("../../libs/processors");
const { DecodeLog, GetInputLength } = require("../../libs/contracts");
const { mocks } = require("../../libs/datasets");

const datasetPath = Path.join(__dirname, "../datasets/set1");
const params = require(Path.join(datasetPath, "/config.json"));
const abi = getAbi("ExpiringMultiParty", "1.2.0");
const web3 = getWeb3();

describe("EmpAttributions", function() {
  let attributions;
  it("inits", function() {
    attributions = EmpAttributions(abi, "defaultAddress");
    assert(attributions);
  });
  it("handles an encoded create transaction", function() {
    const length = GetInputLength(abi)("create");
    attributions.handleTransaction({
      name: "create",
      input: web3.utils.randomHex(length / 8) + "9a9dcd6b52b45a78cd13b395723c245dabfbab71",
      from_address: "user",
      args: ["1", "1"]
    });
    const result = attributions.attributions.snapshot();
    assert(result.user);
    assert(result.user["0x9a9dcd6b52b45a78cd13b395723c245dabfbab71"]);
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

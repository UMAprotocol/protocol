const { BigQuery } = require("@google-cloud/bigquery");
const Queries = require('../libs/bigquery')
const moment = require("moment");
const highland = require("highland");
const assert = require("assert");
const { DecodeLog } = require("../libs/contracts");
const { abi } = require("../../core/build/contracts/ExpiringMultiParty");
const { EmpBalances, EmpBalancesHistory } = require("../libs/processors");

// uUSDwETH-DEC
const empContract = "0x3605Ec11BA7bD208501cbb24cd890bC58D2dbA56";
const start = moment('2020-9-20','YYYY-MM-DD').valueOf()
const end = moment('2020-10-10','YYYY-MM-DD').valueOf()
const client = new BigQuery();
const queries = Queries({client})

async function runTest() {
  // query starting before emp launch
  const stream = await queries.streamLogsByContract(empContract,start,end)
  const decode = DecodeLog(abi);
  const balancesHistory = EmpBalancesHistory();

  await highland(stream)
    // .doto(console.log)
    .map(log => {
      try {
        return decode(log, { blockNumber: log.block_number, blockTimestamp:log.block_timestamp });
      } catch (err) {
        // decoding log error, abi probably missing an event
        console.log("error decoding log:", err);
      }
    })
    .compact()

    .doto(log => {
      try {
        balancesHistory.handleEvent(log.blockNumber, log);
      } catch (err) {
        console.log(err, log);
      }
    })
    .last()
    .toPromise(Promise);

  console.log("blocks updated count", balancesHistory.history.length());

  // quick sanity check to make sure snapshots were generated from the first 10 blocks
  const checkblocks = balancesHistory.history.history.slice(0, 10).map(x=>x.blockNumber);
  checkblocks.forEach(blockNumber => {
    const result = balancesHistory.history.lookup(blockNumber);
    console.log(result);
  });

  // show the latest balances
  // console.log(balances.collateral.snapshot())
  // console.log(balances.tokens.snapshot())
}

runTest()
  .then(console.log)
  .catch(console.log);

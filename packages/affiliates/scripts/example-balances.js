const { BigQuery } = require("@google-cloud/bigquery");
const Queries = require("../libs/bigquery");
const highland = require("highland");
const { DecodeLog } = require("../libs/contracts");
const { getAbi } = require("@uma/core");
const { EmpBalancesHistory, EmpBalances } = require("../libs/processors");
const { empContracts } = require("../test/datasets/set1");

const abi = getAbi("ExpiringMultiParty");
const empContract = empContracts[2]; // pxUSD-OCT2020
const client = new BigQuery();
const queries = Queries({ client });

async function runTest() {
  // query starting before emp launch
  const stream = await queries.streamAllLogsByContract(empContract);
  const decode = DecodeLog(abi);
  const balancesHistory = EmpBalancesHistory();
  const balances = EmpBalances();

  await highland(stream)
    .map((log) => {
      try {
        return decode(log, { blockNumber: log.block_number, blockTimestamp: log.block_timestamp });
      } catch (err) {
        // decoding log error, abi probably missing an event
        console.log("error decoding log:", err);
      }
    })
    .compact()
    .doto((log) => {
      try {
        balancesHistory.handleEvent(log.blockNumber, log);
        balances.handleEvent(log);
      } catch (err) {
        console.log(err, log);
      }
    })
    .last()
    .toPromise(Promise);

  console.log("blocks updated count", balancesHistory.history.length());

  // quick sanity check to make sure snapshots were generated from the first 10 blocks
  const checkblocks = balancesHistory.history.history.slice(0, 10).map((x) => x.blockNumber);
  checkblocks.forEach((blockNumber) => {
    const result = balancesHistory.history.lookup(blockNumber);
    console.log(result);
  });

  // show the latest balances
  // console.log(balances.collateral.snapshot())
  // console.log(balances.tokens.snapshot())
}

runTest().then(console.log).catch(console.log);

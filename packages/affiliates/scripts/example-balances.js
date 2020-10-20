const { BigQuery } = require("@google-cloud/bigquery");
const moment = require("moment");
const highland = require("highland");
const assert = require("assert");
const { DecodeLog } = require("../libs/contracts");
const { abi } = require("../../core/build/contracts/ExpiringMultiParty");
const { EmpBalances, EmpBalancesHistory } = require("../libs/processors");

// uUSDwETH Synthetic Token Expiring  uUSDwETH-DEC
const empContract = "0xD16c79c8A39D44B2F3eB45D2019cd6A42B03E2A9";

function makeQuery(contract, start, end = Date.now()) {
  assert(contract, "requires contract");
  assert(start, "requires start");
  start = moment(start).format("YYYY-MM-DD hh:mm:ss");
  end = moment(end).format("YYYY-MM-DD hh:mm:ss");
  return `
    SELECT *
    FROM
      bigquery-public-data.crypto_ethereum.logs
    WHERE
      block_timestamp > TIMESTAMP('${start}')
      AND block_timestamp < TIMESTAMP('${end}')
      AND LOWER(address)=LOWER('0x3605Ec11BA7bD208501cbb24cd890bC58D2dbA56')
    ORDER BY block_timestamp ASC;
    `;
}

const client = new BigQuery();

async function runTest() {
  // query starting before emp launch
  const query = makeQuery(empContract, moment("9/20/2020", "MM/DD/YYYY").valueOf());
  const stream = await client.createQueryStream({ query });
  const decode = DecodeLog(abi);
  const balancesHistory = EmpBalancesHistory();

  await highland(stream)
    // .doto(console.log)
    .map(log => {
      try {
        return decode(log, { blockNumber: log.block_number });
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

  console.log("blocks updated count", balancesHistory.blocks.length);
  const checkblocks = balancesHistory.blocks.slice(0, 10);
  checkblocks.forEach(blockNumber => {
    const result = balancesHistory.history.lookup(blockNumber);
    console.log(result);
  });

  // console.log(balances.collateral.snapshot())
  // console.log(balances.tokens.snapshot())
}

runTest()
  .then(console.log)
  .catch(console.log);

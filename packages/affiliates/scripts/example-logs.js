const { BigQuery } = require("@google-cloud/bigquery");
const moment = require("moment");
const highland = require("highland");
const assert = require("assert");

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
  // returns a node read stream
  const query = makeQuery(
    empContract,
    moment("10/1/2020", "MM/DD/YYYY").valueOf(),
    moment("10/2/2020", "MM/DD/YYYY").valueOf()
  );
  const stream = await client.createQueryStream({ query });

  return (
    highland(stream)
      // .doto(console.log)
      .collect()
      .toPromise(Promise)
  );

  // console.log(balances.getCollateral().snapshot())
  // console.log(balances.getTokens().snapshot())
}

runTest().then(console.log).catch(console.log);

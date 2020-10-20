const { BigQuery } = require("@google-cloud/bigquery");
const moment = require("moment");
const highland = require("highland");
const assert = require("assert");
const Path = require("path");
const fs = require("fs");

// uUSDwETH Synthetic Token Expiring  uUSDwETH-DEC
const empContract = "0xD16c79c8A39D44B2F3eB45D2019cd6A42B03E2A9";
const dir = Path.join(__dirname, "../datasets/uUSDwETH-DEC-logs.json");

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
  const query = makeQuery(empContract, moment("9/25/2020", "MM/DD/YYYY").valueOf());

  const queryStream = highland(await client.createQueryStream({ query }))
    .map(JSON.stringify)
    .intersperse(",\n");
  const writeStream = fs.createWriteStream(dir);

  return new Promise((res, rej) => {
    highland(["[\n", queryStream])
      .append("]\n")
      .flatten()
      .pipe(writeStream)
      .on("done", res);
  });
}

runTest()
  .then(console.log)
  .catch(console.log);

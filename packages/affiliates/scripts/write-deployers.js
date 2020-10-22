// Generates a sample deployers file uUSDwETH-DEC-deployers.json containing logs sent to the emp factor used to find the
// creator of a given EMP.

const { BigQuery } = require("@google-cloud/bigquery");
const moment = require("moment");
const highland = require("highland");
const assert = require("assert");
const Path = require("path");
const fs = require("fs");

const empCreator = "0x9A077D4fCf7B26a0514Baa4cff0B481e9c35CE87";

const dir = Path.join(__dirname, "../datasets/uUSDwETH-DEC-deployers.json");

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
      AND LOWER(address)=LOWER('${contract}')
    ORDER BY block_timestamp ASC;
    `;
}

const client = new BigQuery();

async function runTest() {
  // returns a node read stream
  const query = makeQuery(
    empCreator,
    moment("9/20/2020", "MM/DD/YYYY").valueOf(),
    moment("10/20/2020", "MM/DD/YYYY").valueOf()
  );

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

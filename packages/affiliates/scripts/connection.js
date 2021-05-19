const { BigQuery } = require("@google-cloud/bigquery");
const highland = require("highland");

const query = `
SELECT *
FROM
  bigquery-public-data.crypto_ethereum.traces
WHERE
  block_timestamp > TIMESTAMP('2020-10-06')
  AND LOWER(to_address)=LOWER('0x3605Ec11BA7bD208501cbb24cd890bC58D2dbA56');
`;

const client = new BigQuery();

async function runTest() {
  // returns a node read stream
  const stream = await client.createQueryStream({ query });
  // highland wraps a stream and adds utilities simlar to lodash
  // https://caolan.github.io/highland/
  return (
    highland(stream)
      // this filters based on matts scheme for matching attribution tag
      // but we could easily do any type of scheme with JS filtering
      .filter(({ input }) => {
        return input.match(/f{64}0{24}.{40}$/);
      })
      // from here you can map or reduce or whatever you need for down stream processing
      // we are just going to "collect" stream into an array for display
      .collect()
      // emit the stream as a promise when the stream ends
      // this is the start of a data pipeline so you can imagine
      // this could also "pipe" into some other processing pipeline or write to a file
      .toPromise(Promise)
  );
}

runTest().then(console.log).catch(console.log);

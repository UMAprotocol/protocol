const {BigQuery} = require('@google-cloud/bigquery')
const highland = require('highland')


const query = `
SELECT *
FROM
  bigquery-public-data.crypto_ethereum.logs
WHERE
  block_timestamp > TIMESTAMP('2020-10-06')
  AND LOWER(address)=LOWER('0x3605Ec11BA7bD208501cbb24cd890bC58D2dbA56');
`

const client = new BigQuery();

async function runTest(){
  // returns a node read stream
  const stream = await client.createQueryStream({query})
  // highland wraps a stream and adds utilities simlar to lodash
  // https://caolan.github.io/highland/
  return highland(stream)
    .collect()
    // emit the stream as a promise when the stream ends
    // this is the start of a data pipeline so you can imagine 
    // this could also "pipe" into some other processing pipeline or write to a file
    .toPromise(Promise)

}

runTest().then(console.log).catch(console.log)




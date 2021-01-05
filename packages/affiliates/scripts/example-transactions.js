const { BigQuery } = require("@google-cloud/bigquery");
const highland = require("highland");
const Queries = require("../libs/bigquery");
const moment = require("moment");
const { getAbi } = require("@uma/core");
const { DecodeTransaction, GetInputLength } = require("../libs/contracts");

// uGAS-MAR21
const contract = "0xfa3aa7ee08399a4ce0b4921c85ab7d645ccac669";
const start = moment("2020-12-20", "YYYY-MM-DD").valueOf();
const end = moment("2020-12-23", "YYYY-MM-DD").valueOf();

const client = new BigQuery();
const queries = Queries({ client });
const empAbi = getAbi("ExpiringMultiParty");

async function runTest() {
  // returns a node read stream
  const stream = await queries.streamTransactionsByContract(contract, start, end);
  const decode = DecodeTransaction(empAbi);
  const inputLength = GetInputLength(empAbi)("create") / 4 + 2; // convert bits to hex and + 2 for 0x
  // highland wraps a stream and adds utilities simlar to lodash
  // https://caolan.github.io/highland/
  return (
    highland(stream)
      // this filters based on matts scheme for matching attribution tag
      // but we could easily do any type of scheme with JS filtering
      .map(x => decode(x, x))
      .filter(x => x.name == "create")
      .map(x => x.input.slice(inputLength))
      .collect()
      // emit the stream as a promise when the stream ends
      // this is the start of a data pipeline so you can imagine
      // this could also "pipe" into some other processing pipeline or write to a file
      .toPromise(Promise)
  );
}

runTest()
  .then(console.log)
  .catch(console.log);

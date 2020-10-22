// Generates a sample deployers file uUSDwETH-DEC-deployers.json containing logs sent to the emp factor used to find the
// creator of a given EMP.

const { BigQuery } = require("@google-cloud/bigquery");
const Queries = require('../libs/bigquery')
const moment = require("moment");
const highland = require("highland");
const assert = require("assert");
const Path = require("path");
const fs = require("fs");

const empCreator = "0x9A077D4fCf7B26a0514Baa4cff0B481e9c35CE87";
const dir = Path.join(__dirname, "../datasets/uUSDwETH-DEC-deployers.json");
const start = moment("9/20/2020", "MM/DD/YYYY").valueOf()
const end = moment("10/20/2020", "MM/DD/YYYY").valueOf()

const client = new BigQuery();
const queries = Queries({client})

async function runTest() {
  const data = await queries.getLogsByContract(empCreator,start,end)
  fs.writeFileSync(dir,JSON.stringify(data,null,2));
}

runTest()
  .then(console.log)
  .catch(console.log);

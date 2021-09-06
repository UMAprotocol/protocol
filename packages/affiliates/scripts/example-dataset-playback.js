const highland = require("highland");

const Datasets = require("../libs/datasets");
const { DecodeLog } = require("../libs/contracts");
const Path = require("path");
const datasetPath = Path.join(__dirname, "../test/datasets/set1");
const params = require(Path.join(datasetPath, "/config.json"));
const { getAbi } = require("@uma/contracts-node");

const { Queries } = Datasets.mocks;
const queries = Queries(datasetPath);
const empCreatorAbi = getAbi("ExpiringMultiPartyCreator");

const { empCreator } = params;

async function run() {
  const logstream = queries.streamLogsByContract(empCreator);
  const decode = DecodeLog(empCreatorAbi);
  await highland(logstream)
    .doto((log) => {
      const result = decode(log);
      console.log(result.name, result.args, log);
    })
    .resume();
}

run().then(console.log).catch(console.log);

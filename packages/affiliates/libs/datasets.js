const highland = require("highland");
const lodash = require("lodash");
const moment = require("moment");

const fs = require("fs");
const assert = require("assert");
const Path = require("path");
const mkdirp = require("mkdirp");

// put this into csv form
const SerializeObject = (props = []) => obj => {
  return props.map(prop => lodash.get(obj, prop, "")).join(",");
};
// read from csv into object
const DeserializeRow = (props = []) => row => {
  return row.split(",").reduce((result, val, i) => {
    lodash.set(result, props[i], val.trim());
    return result;
  }, {});
};

const SerializeCsvStream = (props = []) => stream => {
  const dataStream = highland(stream).map(SerializeObject(props));
  return highland([props.join(","), dataStream])
    .flatten()
    .map(x => x + "\n");
};
const DeserializeCsvStream = props => stream => {
  // include header line if props are included, ie drop first line
  const drop = props ? 1 : 0;
  const result = highland(stream)
    // splits newlines by defaults
    .split()
    .drop(drop)
    .map(line => {
      if (props == null) {
        props = line.split(",");
      } else {
        return line;
      }
    })
    .compact()
    .map(line => {
      return DeserializeRow(props)(line);
    });
  return result;
};

// each class may serialize differently
// Blocks serialized as a csv to keep filesize small and short
function Blocks() {
  return {
    serialize: SerializeCsvStream(["timestamp.value", "number"]),
    deserialize: DeserializeCsvStream()
  };
}
// These cant be serialized to csvs unfortunatley due to datastructure incompatibility
function Logs() {
  return {
    // this cant be put into csv with nested arrays
    serialize(stream) {
      return highland(stream).map(x => JSON.stringify(x) + "\n");
    },
    deserialize(stream) {
      return highland(stream)
        .split()
        .compact()
        .map(JSON.parse);
    }
  };
}
function Transactions() {
  return {
    // this cant be put into csv with nested arrays
    serialize(stream) {
      return highland(stream).map(x => JSON.stringify(x) + "\n");
    },
    deserialize(stream) {
      return highland(stream)
        .split()
        .compact()
        .map(JSON.parse);
    }
  };
}
function Coingecko() {
  function serialize(charts) {
    return JSON.stringify(charts);
  }
  function deserialize(stream) {
    return highland(stream)
      .reduce("", (result, next) => {
        return result + next;
      })
      .map(JSON.parse);
  }
  return {
    serialize,
    deserialize
  };
}
function SynthPrices() {
  function serialize(charts) {
    return JSON.stringify(charts);
  }
  function deserialize(stream) {
    return highland(stream)
      .reduce("", (result, next) => {
        return result + next;
      })
      .map(JSON.parse);
  }
  return {
    serialize,
    deserialize
  };
}

function Dataset(basePath, { queries, coingecko, synthPrices }) {
  assert(basePath, "requires dataset basePath");
  assert(queries, "requires queries");
  assert(coingecko, "requires coingecko");
  assert(synthPrices, "requires synthPrices");

  function blocks({ start, end, select = ["timestamp", "number"] }, path) {
    const fileName = Path.join(path, "blocks.csv");
    const writeStream = fs.createWriteStream(fileName);
    const dataStream = queries.streamBlocks(start, end, select);
    return new Promise(res => {
      Blocks()
        .serialize(dataStream)
        .pipe(writeStream)
        .on("close", res);
    });
  }
  function allLogs({ contract, select }, path) {
    const fileName = Path.join(path, `logs_${contract}.txt`);
    const writeStream = fs.createWriteStream(fileName);
    const dataStream = queries.streamAllLogsByContract(contract, select);
    return new Promise(res => {
      Logs()
        .serialize(dataStream)
        .pipe(writeStream)
        .on("close", res);
    });
  }
  function logs({ start, end, contract, select }, path) {
    const fileName = Path.join(path, `logs_${contract}.txt`);
    const writeStream = fs.createWriteStream(fileName);
    const dataStream = queries.streamLogsByContract(contract, start, end, select);
    return new Promise(res => {
      Logs()
        .serialize(dataStream)
        .pipe(writeStream)
        .on("close", res);
    });
  }
  function transactions({ start, end, contract, select }, path) {
    const fileName = Path.join(path, `transactions_${contract}.txt`);
    const writeStream = fs.createWriteStream(fileName);
    const dataStream = queries.streamTransactionsByContract(contract, start, end, select);
    return new Promise(res => {
      Transactions()
        .serialize(dataStream)
        .pipe(writeStream)
        .on("close", res);
    });
  }
  async function saveCoingeckoPrices({ start, end, contract, currency = "usd" }, path) {
    const fileName = Path.join(path, `coingecko_${contract}_${currency}.txt`);
    const prices = await coingecko.getHistoricContractPrices(contract, currency, start, end);
    fs.writeFileSync(fileName, Coingecko().serialize(prices));
  }
  async function saveSynthPrices({ start, end, contract }, path) {
    const fileName = Path.join(path, `synthprices_${contract}.txt`);
    const prices = await synthPrices.getHistoricSynthPrices(contract, start, end);
    fs.writeFileSync(fileName, Coingecko().serialize(prices));
  }

  async function saveObject(object, name, path) {
    const fileName = Path.join(path, `${name}.json`);
    fs.writeFileSync(fileName, JSON.stringify(object, null, 2));
  }

  async function save(name, config) {
    const { empCreator, empContracts, collateralTokens, start, end } = config;
    assert(empCreator, "requires empCreator address");
    assert(empContracts, "requires empContracts array");
    assert(collateralTokens, "requires collateralTokens");
    assert(start, "requires start time");
    assert(end, "requires end time");
    const path = Path.join(basePath, name);
    await mkdirp(path);
    await Promise.all([
      ...collateralTokens.map(contract => saveCoingeckoPrices({ start, end, contract }, path)),
      ...empContracts.map(contract => saveSynthPrices({ start, end, contract }, path)),
      // we need all events to recreate balances
      ...empContracts.map(contract => allLogs({ contract }, path)),
      // we need all events to get all emps deployed
      allLogs({ contract: empCreator }, path),
      blocks({ start, end }, path),
      saveObject(config, "config", path)
    ]);
    return path;
  }

  return {
    save,
    utils: {
      blocks,
      logs,
      allLogs,
      transactions,
      saveCoingeckoPrices,
      saveSynthPrices
    }
  };
}

// Mock SynthPrices
function MockSynthPrices(basePath) {
  // copies interface in libs/synthPrices
  function getHistoricSynthPrices(address, start = 0, end = Date.now()) {
    assert(address, "requires contract address");
    start = start / 1000;
    end = end / 1000;
    const path = Path.join(basePath, `synthprices_${address}.txt`);
    const readStream = fs.createReadStream(path);
    return SynthPrices()
      .deserialize(readStream)
      .toPromise(Promise)
      .then(result => {
        return result.filter(([time]) => {
          return time >= start && time <= end;
        });
      });
  }
  return {
    getHistoricSynthPrices
  };
}
// Mock coingecko
function MockCoingecko(basePath) {
  // copies interface in libs/coingecko
  function getHistoricContractPrices(address, currency = "usd", start = 0, end = Date.now()) {
    assert(address, "requires contract address");
    const path = Path.join(basePath, `coingecko_${address}_${currency}.txt`);
    const readStream = fs.createReadStream(path);
    return Coingecko()
      .deserialize(readStream)
      .toPromise(Promise)
      .then(result => {
        return result.filter(([time]) => {
          return time >= start && time <= end;
        });
      });
  }
  return {
    getHistoricContractPrices
  };
}
// Mock big query queries
function MockQueries(basePath) {
  function streamLogsByContract(address) {
    const path = Path.join(basePath, `logs_${address}.txt`);
    const readStream = fs.createReadStream(path);
    return Logs().deserialize(readStream);
  }
  function getLogsByContract(address) {
    return streamLogsByContract(address)
      .collect()
      .toPromise(Promise);
  }
  function getAllLogsByContract(address) {
    return streamLogsByContract(address)
      .collect()
      .toPromise(Promise);
  }
  function streamAllLogsByContract(address) {
    return streamLogsByContract(address);
  }
  function streamBlocks(start = 0, end = Date.now()) {
    const path = Path.join(basePath, "blocks.csv");
    const readStream = fs.createReadStream(path);
    return Blocks()
      .deserialize(readStream)
      .filter(block => {
        const blockTime = moment(block.timestamp.value).valueOf();
        return blockTime >= start && blockTime < end;
      });
  }
  function getBlocks(start = 0, end = Date.now()) {
    return streamBlocks(start, end)
      .collect()
      .toPromise(Promise);
  }
  return {
    streamLogsByContract,
    streamAllLogsByContract,
    getLogsByContract,
    getAllLogsByContract,
    streamBlocks,
    getBlocks
  };
}

module.exports = {
  Dataset,
  mocks: {
    Queries: MockQueries,
    Coingecko: MockCoingecko,
    SynthPrices: MockSynthPrices
  },
  serializers: {
    Blocks,
    Transactions,
    Logs,
    Coingecko,
    SynthPrices
  },
  utils: {
    SerializeCsvStream,
    DeserializeCsvStream,
    SerializeObject,
    DeserializeRow
  }
};

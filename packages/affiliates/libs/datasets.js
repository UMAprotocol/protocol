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

function Dataset(basePath, { queries, coingecko }) {
  assert(basePath, "requires dataset basePath");
  assert(queries, "requires queries");
  assert(coingecko, "requires coingecko");

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
  async function prices({ start, end, contract, currency = "usd" }, path) {
    const fileName = Path.join(path, `coingecko_${contract}_${currency}.txt`);
    const prices = await coingecko.chart(contract, currency, start, end);
    fs.writeFileSync(fileName, Coingecko().serialize(prices));
  }
  async function save(name, config) {
    const { empCreator, empContracts, syntheticTokens, start, end } = config;
    assert(empCreator, "requires empCreator address");
    assert(empContracts, "requires empContracts array");
    assert(syntheticTokens, "requires syntheticTokens");
    assert(start, "requires start time");
    assert(end, "requires end time");
    const path = Path.join(basePath, name);
    await mkdirp(path);
    await Promise.all([
      ...syntheticTokens.map(contract => prices({ start, end, contract }, path)),
      ...empContracts.map(contract => logs({ start, end, contract }, path)),
      logs({ start, end, contract: empCreator }, path),
      blocks({ start, end }, path)
    ]);
    return path;
  }

  return {
    save,
    utils: {
      blocks,
      logs,
      transactions,
      prices
    }
  };
}

// Mock coingecko
function MockCoingecko(basePath) {
  function chart(address) {
    const path = Path.join(basePath, `coingecko_${address}.txt`);
    const readStream = fs.createReadStream(path);
    return Coingecko()
      .deserialize(readStream)
      .toPromise(Promise);
  }
  return {
    chart
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
  function streamBlocks(start, end) {
    const path = Path.join(basePath, "blocks.csv");
    const readStream = fs.createReadStream(path);
    return Blocks()
      .deserialize(readStream)
      .filter(block => {
        const blockTime = moment(block.timestamp.value).valueOf();
        return blockTime >= start && blockTime <= end;
      });
  }
  function getBlocks(start, end) {
    return streamBlocks(start, end)
      .collect()
      .toPromise(Promise);
  }
  return {
    streamLogsByContract,
    getLogsByContract,
    streamBlocks,
    getBlocks
  };
}

module.exports = {
  Dataset,
  mocks: {
    Queries: MockQueries,
    Coingecko: MockCoingecko
  },
  serializers: {
    Blocks,
    Transactions,
    Logs,
    Coingecko
  },
  utils: {
    SerializeCsvStream,
    DeserializeCsvStream,
    SerializeObject,
    DeserializeRow
  }
};

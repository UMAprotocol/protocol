// Mocks that allow you to inject in your datasets as arrays/objects for testing. This is different from
// dataset mocks which load mocked data from a file. This allows you to pass in custom data.
// This was going to be used for simple testing but its too difficult to mock transaction data.
const highland = require("highland");
const assert = require("assert");

// Mocking the big query library.
// Pass in blocks as an array of blocks
// Pass in logs as logs[contractAddress] = [{...log data}]
function Queries({ blocks = [], logs = {} }) {
  function streamAllLogsByContract(address) {
    return highland(getAllLogsByContract(address));
  }
  function getAllLogsByContract(address) {
    assert(logs[address], "no logs for address: " + address);
    return logs[address];
  }
  function streamLogsByContract(address, start, end) {
    return highland(getLogsByContract(address, start, end));
  }
  function getLogsByContract(address, start, end) {
    assert(logs[address], "no logs for address: " + address);
    return logs[address].filter((x) => {
      return x.block_timestamp >= start && x.block_timestamp <= end;
    });
  }
  function streamBlocks(start, end) {
    return highland(getBlocks(start, end));
  }
  function getBlocks(start, end) {
    return blocks.filter((x) => {
      return x.timestamp >= start && x.timestamp <= end;
    });
  }
  return {
    streamLogsByContract,
    streamAllLogsByContract,
    streamBlocks,
    getBlocks,
    getLogsByContract,
    getAllLogsByContract,
  };
}
function Coingecko({ prices = {} }) {
  return {
    getHistoricContractPrices(address, currency, start, end) {
      assert(prices[address], "no prices found for address: " + address);
      return prices[address].filter((x) => {
        return x[0] >= start && x[0] <= end;
      });
    },
  };
}

function SynthPrices({ prices = {} }) {
  return {
    getHistoricSynthPrices(address, start, end) {
      assert(prices[address], "no prices found for address: " + address);
      return prices[address].filter((x) => {
        return x[0] >= start && x[0] <= end;
      });
    },
  };
}

module.exports = { Coingecko, SynthPrices, Queries };

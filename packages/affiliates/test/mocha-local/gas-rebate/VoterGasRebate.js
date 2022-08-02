// How to run:
// 0) Start ganache (testnet or mainnet-fork doesn't matter, this test does not send any txns):
//     - ganache-cli -p 9545 -e 10000000000 -l 9000000
// 1) Truffle test:
//     - yarn truffle test ./packages/affiliates/test/truffle/gas-rebate/VoterGasRebate.js

const hre = require("hardhat");

// This signals to some of our infrastructure that this is a test environment.
global.web3 = hre.web3;
global.hre = hre;

const { assert } = require("chai");
const Main = require("../../../gas-rebate/VoterGasRebate");

describe("Gas Rebate: index.js", function () {
  let testStartBlock;
  before(async () => {
    testStartBlock = await web3.eth.getBlockNumber();
    // Mine 3 blocks so there are multiple blocks in history:
    await web3.currentProvider.send({ jsonrpc: "2.0", method: "evm_mine", id: 12345 }, () => {});
    await web3.currentProvider.send({ jsonrpc: "2.0", method: "evm_mine", id: 12345 }, () => {});
    await web3.currentProvider.send({ jsonrpc: "2.0", method: "evm_mine", id: 12345 }, () => {});
  });
  describe("getHistoricalGasPrice", function () {
    it("Returns an array: {timestamp, avgGwei}", async function () {
      const prices = await Main.getHistoricalGasPrice(testStartBlock, testStartBlock + 2);
      assert.isTrue(prices.length > 0);
      prices.forEach((px) => {
        assert.isTrue(px.timestamp >= 0, "timestamp is negative");
        assert.isTrue(Number(px.avgGwei) > 0, "price is not positive");
      });
    });
  });

  describe("getHistoricalUmaEthPrice", function () {
    it("Returns an array: {timestamp, avgPx}", async function () {
      const gasPrices = await Main.getHistoricalGasPrice(testStartBlock, testStartBlock + 2);
      const umaPrices = await Main.getHistoricalUmaEthPrice(gasPrices);
      assert.isTrue(umaPrices.length > 0);
      umaPrices.forEach((px) => {
        assert.isTrue(px.timestamp >= 0, "timestamp is negative");
        assert.isTrue(Number(px.avgPx) > 0, "price is not positive");
      });
    });
  });

  describe("getDataForTimestamp", function () {
    const mockData = [
      { timestamp: 1, val: 1 },
      { timestamp: 3, val: 3 },
      { timestamp: 2, val: 2 },
    ];

    it("Lookup timestamp before earliest timestamp, return earliest", function () {
      // 0 < 1, 1 is earliest `timestamp`
      const result = Main.getDataForTimestamp(mockData, 0);
      assert.equal(result.val, 1);
    });
    it("Lookup timestamp after latest timestamp, return latest", function () {
      // 4 > 3, 4 is latest `timestamp`
      const result = Main.getDataForTimestamp(mockData, 4);
      assert.equal(result.val, 3);
    });
    it("Lookup timestamp in range, return correct timestamp", function () {
      const result = Main.getDataForTimestamp(mockData, 2);
      assert.equal(result.val, 2);
    });
  });
});

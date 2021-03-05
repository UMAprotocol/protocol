// How to run:
// 0) Start ganache (testnet or mainnet-fork doesn't matter, this test does not send any txns):
//     - ganache-cli -p 9545 -e 10000000000 -l 9000000
// 1) Truffle test:
//     - yarn truffle test ./packages/affiliates/test/truffle/gas-rebate/VoterGasRebate.js

const Main = require("../../../gas-rebate/VoterGasRebate");

contract("Gas Rebate: index.js", function() {
  // Oct-13-2020, early in the Commit period for Admin 16 vote
  const TEST_START_BLOCK = 11045000;
  // Oct-16-2020, 1 full day after reveal period ends for Admin 16, so it contains some claim-rewards events
  const TEST_END_BLOCK = 11070000;

  describe("getHistoricalGasPrice", function() {
    it("Returns an array: {timestamp, avgGwei}", async function() {
      const prices = await Main.getHistoricalGasPrice(TEST_START_BLOCK, TEST_END_BLOCK);
      assert.isTrue(prices.length > 0);
      prices.forEach(px => {
        assert.isTrue(px.timestamp >= 0, "timestamp is negative");
        assert.isTrue(Number(px.avgGwei) > 0, "price is not positive");
      });
    });
  });

  describe("getHistoricalUmaEthPrice", function() {
    it("Returns an array: {timestamp, avgPx}", async function() {
      const gasPrices = await Main.getHistoricalGasPrice(TEST_START_BLOCK, TEST_END_BLOCK);
      const umaPrices = await Main.getHistoricalUmaEthPrice(gasPrices);
      assert.isTrue(umaPrices.length > 0);
      umaPrices.forEach(px => {
        assert.isTrue(px.timestamp >= 0, "timestamp is negative");
        assert.isTrue(Number(px.avgPx) > 0, "price is not positive");
      });
    });
  });

  describe("getDataForTimestamp", function() {
    const mockData = [
      { timestamp: 1, val: 1 },
      { timestamp: 3, val: 3 },
      { timestamp: 2, val: 2 }
    ];

    it("Lookup timestamp before earliest timestamp, return earliest", function() {
      // 0 < 1, 1 is earliest `timestamp`
      const result = Main.getDataForTimestamp(mockData, 0);
      assert.equal(result.val, 1);
    });
    it("Lookup timestamp after latest timestamp, return latest", function() {
      // 4 > 3, 4 is latest `timestamp`
      const result = Main.getDataForTimestamp(mockData, 4);
      assert.equal(result.val, 3);
    });
    it("Lookup timestamp in range, return correct timestamp", function() {
      const result = Main.getDataForTimestamp(mockData, 2);
      assert.equal(result.val, 2);
    });
  });
});

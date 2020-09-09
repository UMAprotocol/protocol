const Main = require("./index");

const { fromWei, toBN, toWei } = web3.utils;

contract("Gas Rebate: index.js", function() {
  // Aug 29 2020, beginning of Admin 10 Vote
  const TEST_START_BLOCK = 10752294;
  // September 2 2020, 1 full day after reveal period ends for Admin 10, so it contains some claim-rewards events
  const TEST_END_BLOCK = 10778455;
  const REBATE_LABEL = 9999;

  describe("getHistoricalEthPrice", function() {
    it("Returns an array: {timestamp, avgPx}", async function() {
      const prices = await Main.getHistoricalEthPrice(TEST_START_BLOCK, TEST_END_BLOCK);
      assert.isTrue(prices.length > 0);
      prices.forEach(px => {
        assert.isTrue(px.timestamp >= 0, "timestamp is negative");
        assert.isTrue(Number(px.avgPx) > 0, "price is not positive");
      });
    });
  });

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

  describe("getUmaPrice", function() {
    it("Returns an array: {timestamp, avgGwei}", async function() {
      const price = await Main.getUmaPrice();
      assert.isTrue(price > 0);
    });
  });

  describe("calculateRebate", function() {
    beforeEach(async function() {
      this.dailyAvgGasPrices = await Main.getHistoricalGasPrice(TEST_START_BLOCK, TEST_END_BLOCK);
      this.dailyAvgEthPrices = await Main.getHistoricalEthPrice(TEST_START_BLOCK, TEST_END_BLOCK);
      this.currentUmaPrice = await Main.getUmaPrice();
    });
    it("Expect both reveal and claim rebates and outputs are reasonable", async function() {
      const result = await Main.calculateRebate({
        rebateNumber: REBATE_LABEL,
        startBlock: TEST_START_BLOCK,
        endBlock: TEST_END_BLOCK,
        dailyAvgEthPrices: this.dailyAvgEthPrices,
        dailyAvgGasPrices: this.dailyAvgGasPrices,
        currentUmaPrice: this.currentUmaPrice,
        debug: true
      });

      const revealRebates = result.revealRebates;
      const claimRebates = result.claimRebates;

      assert.isTrue(Object.keys(revealRebates.rebateReceipts).length > 0, "Test period should have reveals");
      assert.isTrue(Object.keys(claimRebates.rebateReceipts).length > 0, "Test period should have claims");
      assert.equal(result.rebateOutput.rebate, REBATE_LABEL);
      assert.equal(result.rebateOutput.fromBlock, TEST_START_BLOCK);
      assert.equal(result.rebateOutput.toBlock, TEST_END_BLOCK);

      // Ball park estimate for gas used is ~150k gas for both reveal+commits and claims
      const avgGasUsedReveals =
        Number(revealRebates.totals.totalGasUsed) / Object.keys(revealRebates.rebateReceipts).length;
      const avgGasUsedClaims =
        Number(claimRebates.totals.totalGasUsed) / Object.keys(claimRebates.rebateReceipts).length;
      assert.isTrue(avgGasUsedReveals >= 75000 && avgGasUsedReveals <= 225000);
      assert.isTrue(avgGasUsedClaims >= 75000 && avgGasUsedClaims <= 225000);

      // Ball park estimate for ETH spent assumes gas price in gwei is between 30 and 500 gas
      const lowerLimitEthSpentReveals = toBN(toWei("30", "gwei")).mul(toBN(revealRebates.totals.totalGasUsed));
      const upperLimitEthSpentReveals = toBN(toWei("500", "gwei")).mul(toBN(revealRebates.totals.totalGasUsed));
      const lowerLimitEthSpentClaims = toBN(toWei("30", "gwei")).mul(toBN(claimRebates.totals.totalGasUsed));
      const upperLimitEthSpentClaims = toBN(toWei("500", "gwei")).mul(toBN(claimRebates.totals.totalGasUsed));
      assert.isTrue(
        Number(revealRebates.totals.totalEthSpent) >= Number(fromWei(lowerLimitEthSpentReveals.toString())) &&
          Number(revealRebates.totals.totalEthSpent) <= Number(fromWei(upperLimitEthSpentReveals.toString()))
      );
      assert.isTrue(
        Number(claimRebates.totals.totalEthSpent) >= Number(fromWei(lowerLimitEthSpentClaims.toString())) &&
          Number(claimRebates.totals.totalEthSpent) <= Number(fromWei(upperLimitEthSpentClaims.toString()))
      );

      // Ball park estimate for UMA to repay uses the lower and upper ETH spent approximations, assuming
      // ETH is between $200 and $800
      const ethToUmaLowerLimit = toBN(toWei("200"))
        .mul(Main.SCALING_FACTOR)
        .div(this.currentUmaPrice);
      const ethToUmaUpperLimit = toBN(toWei("800"))
        .mul(Main.SCALING_FACTOR)
        .div(this.currentUmaPrice);
      const lowerLimitUmaRebateReveals = lowerLimitEthSpentReveals.mul(ethToUmaLowerLimit).div(Main.SCALING_FACTOR);
      const upperLimitUmaRebateReveals = upperLimitEthSpentReveals.mul(ethToUmaUpperLimit).div(Main.SCALING_FACTOR);
      const lowerLimitUmaRebateClaims = lowerLimitEthSpentClaims.mul(ethToUmaLowerLimit).div(Main.SCALING_FACTOR);
      const upperLimitUmaRebateClaims = upperLimitEthSpentClaims.mul(ethToUmaUpperLimit).div(Main.SCALING_FACTOR);
      console.log(lowerLimitUmaRebateReveals.toString(), upperLimitUmaRebateReveals.toString());
      assert.isTrue(
        Number(revealRebates.totals.totalUmaRepaid) >= Number(fromWei(lowerLimitUmaRebateReveals.toString())) &&
          Number(revealRebates.totals.totalUmaRepaid) <= Number(fromWei(upperLimitUmaRebateReveals.toString()))
      );
      assert.isTrue(
        Number(claimRebates.totals.totalUmaRepaid) >= Number(fromWei(lowerLimitUmaRebateClaims.toString())) &&
          Number(claimRebates.totals.totalUmaRepaid) <= Number(fromWei(upperLimitUmaRebateClaims.toString()))
      );

      // Test that rebate output (the one used to submit the disperse.app txn) is equal to the sum of the reveal
      // and claim debug logs
      const umaToPayAccount = result.rebateOutput.shareHolderPayout;
      let sum = 0;
      Object.keys(umaToPayAccount).forEach(account => {
        sum += result.rebateOutput.shareHolderPayout[account];
      });
      assert.equal(
        Math.round(sum),
        Math.round(Number(revealRebates.totals.totalUmaRepaid) + Number(claimRebates.totals.totalUmaRepaid)),
        "Total UMA to rebate does not equal sum of reveal and claim events' UMA to rebate"
      );
      assert.equal(
        Object.keys(umaToPayAccount).length,
        Object.keys(revealRebates.rebateReceipts).length,
        "# of total shareholders to rebate is not greater than # of total reveal events to rebate"
      );
    });
    it("Reveal only, no claim rebates", async function() {
      const result = await Main.calculateRebate({
        rebateNumber: REBATE_LABEL,
        startBlock: TEST_START_BLOCK,
        endBlock: TEST_END_BLOCK,
        dailyAvgEthPrices: this.dailyAvgEthPrices,
        dailyAvgGasPrices: this.dailyAvgGasPrices,
        currentUmaPrice: this.currentUmaPrice,
        debug: true,
        revealOnly: true
      });

      const revealRebates = result.revealRebates;
      const claimRebates = result.claimRebates;

      assert.isTrue(Object.keys(revealRebates.rebateReceipts).length > 0, "Test period should have reveals");
      assert.equal(claimRebates, null, "Should not fetch claims");
    });
    it("Claim only, no reveal rebates", async function() {
      const result = await Main.calculateRebate({
        rebateNumber: REBATE_LABEL,
        startBlock: TEST_START_BLOCK,
        endBlock: TEST_END_BLOCK,
        dailyAvgEthPrices: this.dailyAvgEthPrices,
        dailyAvgGasPrices: this.dailyAvgGasPrices,
        currentUmaPrice: this.currentUmaPrice,
        debug: true,
        claimOnly: true
      });

      const revealRebates = result.revealRebates;
      const claimRebates = result.claimRebates;

      assert.isTrue(Object.keys(claimRebates.rebateReceipts).length > 0, "Test period should have claims");
      assert.equal(revealRebates, null, "Should not fetch reveals");
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

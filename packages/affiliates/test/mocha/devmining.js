const { DevMining } = require("../../libs/affiliates");
const lodash = require("lodash");
const { assert } = require("chai");
const { getAbi } = require("@uma/core");
const { Prices } = require("../../libs/models");
// Dataset based mocks that know how to load data from files. This is not the same as the libs/mocks file.
const { mocks } = require("../../libs/datasets");
const Path = require("path");

const empAbi = getAbi("ExpiringMultiParty", "1.2.0");

const { EmpBalancesHistory } = require("../../libs/processors");

const datasetPath = Path.join(__dirname, "../datasets/set1");
const params = require(Path.join(datasetPath, "/config.json"));

const { getWeb3 } = require("@uma/common");
const web3 = getWeb3();
const { toWei } = web3.utils;

const {
  empContracts,
  empDeployers,
  collateralTokens,
  collateralTokenDecimals,
  syntheticTokenDecimals,
  startingTimestamp,
  endingTimestamp
} = params;
const devRewardsToDistribute = "50000";
// mocks
const { Queries, Coingecko, SynthPrices } = mocks;

describe("DevMining Rewards", function() {
  describe("CalculateRewards Simple Data", function() {
    let balanceHistories, params, totalRewards, affiliates;
    beforeEach(function() {
      const queries = Queries(datasetPath);
      const coingecko = Coingecko(datasetPath);
      const synthPrices = SynthPrices(datasetPath);
      affiliates = DevMining({
        queries,
        defaultEmpAbi: empAbi,
        coingecko,
        synthPrices
      });

      function makePricesWithValue(count) {
        return [makePrices(count), affiliates.utils.calculateValue];
      }
      function makePrices(count) {
        return Prices(
          lodash.times(count, i => {
            // [timestamp, price]: we ensure price here is not 0 so that calculations come out whole
            return [i, toWei((i + 1).toString()).toString()];
          })
        );
      }
      const startTime = 0;
      const endTime = 10;
      // emp white list now contains empaddress, reward payout address
      const empWhitelist = [
        ["a", "aa"],
        ["b", "bb"],
        ["c", "cc"],
        ["d", "dd"]
      ];
      balanceHistories = empWhitelist.map(([x]) => [x, EmpBalancesHistory()]);
      totalRewards = "100";

      params = {
        startTime,
        endTime,
        empWhitelist,
        snapshotSteps: 1,
        collateralTokenPrices: empWhitelist.map(() => makePrices(endTime - startTime)),
        collateralTokenDecimals: empWhitelist.map(() => 18),
        syntheticTokenPricesWithValueCalculation: empWhitelist.map(() => makePricesWithValue(endTime - startTime)),
        syntheticTokenDecimals: empWhitelist.map(() => 18),
        blocks: lodash.times(endTime - startTime, i => ({ timestamp: i, number: i })),
        balanceHistories,
        totalRewards
      };
    });
    it("should give full rewards to a single emp with balance", function() {
      // add some balance histories to the emp contracts. this is really what ends up adjusting the distribution.
      // this adds a single balance history event starting at time 0 for the first emp
      balanceHistories[0][1].handleEvent(0, {
        name: "PositionCreated",
        // creating a position for address "aa" with 2 collateral 1 synthetic
        args: ["aa", "2", "1"],
        blockTimestamp: 0
      });
      balanceHistories[0][1].finalize();
      const result = affiliates.utils.calculateRewards(params);
      assert.equal(result.empPayouts["a"], totalRewards);
    });
    it("should split rewards equally between equally funded emps", function() {
      // update balance history for emp a user aa
      balanceHistories[0][1].handleEvent(0, {
        name: "PositionCreated",
        // creating a position for address "aa" with 2 collateral 1 synthetic
        args: ["aa", "2", "1"],
        blockTimestamp: 0
      });
      balanceHistories[0][1].finalize();

      // update balance history for emp b user bb
      balanceHistories[1][1].handleEvent(0, {
        name: "PositionCreated",
        // creating a position for address "bb" with 2 collateral 1 synthetic
        args: ["bb", "2", "1"],
        blockTimestamp: 0
      });
      balanceHistories[1][1].finalize();

      const result = affiliates.utils.calculateRewards(params);
      assert.equal(result.empPayouts["a"], totalRewards / 2);
      assert.equal(result.empPayouts["b"], totalRewards / 2);
    });
    it("should split rewards pro rata between emp with different funding sizes", function() {
      // update balance history for emp a user aa
      balanceHistories[0][1].handleEvent(0, {
        name: "PositionCreated",
        // creating a position for address "aa" with 10 collateral 1 synthetic
        args: ["aa", "10", "1"],
        blockTimestamp: 0
      });
      balanceHistories[0][1].finalize();

      // update balance history for emp b user bb
      balanceHistories[1][1].handleEvent(0, {
        name: "PositionCreated",
        // creating a position for address "bb" with 10 collateral 3 synthetic
        args: ["bb", "10", "3"],
        blockTimestamp: 0
      });
      balanceHistories[1][1].finalize();

      // EMP A should be rewarded less than B since less synth is minted for the same collateral
      // In this case B should be reward 3/4 and A should be rewarded 1/4
      const result = affiliates.utils.calculateRewards(params);
      assert.equal(result.empPayouts["a"], totalRewards / 4);
      assert.equal(result.empPayouts["b"], (totalRewards * 3) / 4);
    });
    it("should work with an emp which had balance and expired", function() {
      // update balance history for emp a user aa: balanceHistories[0][1] 0 = emp index, 1 = balanceHistory
      balanceHistories[0][1].handleEvent(0, {
        name: "PositionCreated",
        // creating a position for address "aa" with 2 collateral 1 synthetic
        args: ["aa", "2", "1"],
        blockTimestamp: 0
      });
      balanceHistories[0][1].finalize();

      // update balance history for emp b user bb
      balanceHistories[1][1].handleEvent(0, {
        name: "PositionCreated",
        // creating a position for address "aa" with 2 collateral 1 synthetic
        args: ["bb", "2", "1"],
        blockTimestamp: 0
      });
      // have "bb" settle expired position. Essentially drains emp B at time 5
      balanceHistories[1][1].handleEvent(4, {
        name: "SettleExpiredPosition",
        // settle a position (withdraw) for address "bb" with 2 collateral 1 synthetic
        args: ["bb", "2", "1"],
        blockTimestamp: 0
      });
      balanceHistories[1][1].finalize();

      // if emp a has a position of 1 for 10 blocks, and b position of 1 for 4 steps, we should see rewards:
      // a share: 80% (.5 + .5 + .5 + .5) + 6 vs b share: 20% (.5 + .5 + .5 + .5)
      // For the first 4 blocks each contract spits rewards per block. Giving each 20%. From there emp
      // b ends and all funds are withdrawn while emp a continue earning 100% of rewards, giving it 80% of shares.
      const result = affiliates.utils.calculateRewards(params);
      assert.equal(result.empPayouts["a"], 80);
      assert.equal(result.empPayouts["b"], 20);
    });
    it("should not reward emps that expire during the reward period", function() {
      // add balance at block 0 for first emp
      balanceHistories[0][1].handleEvent(0, {
        name: "PositionCreated",
        // creating a position for address "a" with 2 collateral 1 synthetic
        args: ["a", "2", "1"],
        blockTimestamp: 0
      });
      // add balance for second emp
      balanceHistories[1][1].handleEvent(0, {
        name: "PositionCreated",
        // creating a position for address "a" with 2 collateral 1 synthetic
        args: ["a", "2", "1"],
        blockTimestamp: 0
      });
      // create position at block 1 for first emp
      balanceHistories[0][1].handleEvent(1, {
        name: "PositionCreated",
        args: ["b", "2", "1"],
        blockTimestamp: 1
      });
      // create positionat block 1 for second emp
      balanceHistories[1][1].handleEvent(1, {
        name: "PositionCreated",
        args: ["b", "2", "1"],
        blockTimestamp: 1
      });
      // now we will also expire emp 2, rendering its latest value unrecordded
      balanceHistories[1][1].handleEvent(1, {
        name: "ContractExpired",
        args: [],
        blockTimestamp: 1
      });
      balanceHistories[0][1].finalize();
      balanceHistories[1][1].finalize();
      // Run for 2 blocks, [0-2)
      const startTime = 0;
      const endTime = 2;
      const changeParams = {
        ...params,
        startTime,
        endTime,
        blocks: lodash.times(endTime - startTime, i => ({ timestamp: i, number: i }))
      };
      // We should record 50% / 50% contribution for both at block 0
      // and 100% / 0% contribution at block 1.
      const result = affiliates.utils.calculateRewards(changeParams);
      assert.equal(result.empPayouts["a"], 75);
      // B expired at block 1, so it should have lower rewards proportionally
      assert.equal(result.empPayouts["b"], 25);
    });
  });
  describe("running dataset 1", function() {
    let affiliates;
    before(function() {
      const queries = Queries(datasetPath);
      const coingecko = Coingecko(datasetPath);
      const synthPrices = SynthPrices(datasetPath);
      affiliates = DevMining({
        queries,
        defaultEmpAbi: empAbi,
        coingecko,
        synthPrices
      });
    });
    it("getAllBalanceHistory", async function() {
      this.timeout(10000);
      // this function requires input contracts with their abi in the form of [[empAddress,empAbi]], which is why we map and return [contract]
      const result = await affiliates.utils.getAllBalanceHistories(
        empContracts.map(contract => [contract, empAbi]),
        startingTimestamp,
        endingTimestamp
      );
      assert.equal(result.length, empContracts.length);
      result.forEach(([address, history]) => {
        assert.ok(address);
        assert.ok(history);
        assert.ok(history.history.length());
      });
    });
    it("getCoingeckoPriceHistory", async function() {
      this.timeout(10000);
      const [, address] = collateralTokens;
      const result = await affiliates.utils.getCoingeckoPriceHistory(
        address,
        "usd",
        startingTimestamp,
        endingTimestamp
      );
      assert.ok(result.prices.length);
    });
    it("getSyntheticPriceHistory", async function() {
      this.timeout(10000);
      const [, address] = empContracts;
      const result = await affiliates.utils.getSyntheticPriceHistory(address, startingTimestamp, endingTimestamp);
      assert.ok(result.prices.length);
    });
    it("getBlocks", async function() {
      this.timeout(30000);
      const result = await affiliates.utils.getBlocks(startingTimestamp, startingTimestamp + 60 * 1000 * 5);
      assert.ok(result.length);
      const [first] = result;
      assert(first.timestamp > 0);
      assert(first.number > 0);
    });
    it("calculateValue", async function() {
      // these are all stable coins so they should roughly be around 1 dollar
      // epsilon is high because variations could be nearly a dollar in any direction
      const epsilon = 10n ** 17n;
      const target = 10n ** 18n;
      // btc example
      let result = affiliates.utils.calculateValue(target, "15437.012543625458", "65019421301142", 8, 18).toString();
      let diff = BigInt(result) - target;
      assert(diff > 0 ? diff : -diff < epsilon);
      // eth example
      result = affiliates.utils.calculateValue(target, "452.1007409061987", "2201527860335072", 18, 18).toString();
      diff = BigInt(result) - target;
      assert(diff > 0 ? diff : -diff < epsilon);
      // perlin example
      result = affiliates.utils
        .calculateValue(target, "0.021647425848012932", "45829514207149404216", 18, 18)
        .toString();
      diff = BigInt(result) - target;
      assert(diff > 0 ? diff : -diff < epsilon);
    });
    it("calculateValueFromUsd", async function() {
      // these are all stable coins so they should roughly be around 1 dollar
      // epsilon is high because variations could be nearly a dollar in any direction
      let target = 10n ** 18n;
      const syntheticPrice = 26.358177384415466;
      let result = affiliates.utils.calculateValueFromUsd(target, 0, syntheticPrice, 18, 18).toString();
      assert.equal(result, toWei(syntheticPrice.toFixed(18)));

      target = 10n ** 8n;
      result = affiliates.utils.calculateValueFromUsd(target, 0, syntheticPrice, 0, 8).toString();
      assert.equal(result, toWei(syntheticPrice.toFixed(18)));
    });
    it("getBalanceHistory", async function() {
      this.timeout(10000);
      const result = await affiliates.utils.getBalanceHistory(
        empContracts[0],
        startingTimestamp,
        endingTimestamp,
        empAbi
      );
      assert.ok(result);
      assert.ok(result.history.length());
    });
    it("getCoingeckoPriceHistory", async function() {
      this.timeout(10000);
      const [, address] = collateralTokens;
      const result = await affiliates.utils.getCoingeckoPriceHistory(
        address,
        "usd",
        startingTimestamp,
        endingTimestamp
      );
      assert.ok(result.prices.length);
    });
    it("getSyntheticPriceHistory", async function() {
      this.timeout(10000);
      const [, address] = empContracts;
      const result = await affiliates.utils.getSyntheticPriceHistory(address, startingTimestamp, endingTimestamp);
      assert.ok(result.prices.length);
    });
    it("getBlocks", async function() {
      this.timeout(30000);
      const result = await affiliates.utils.getBlocks(startingTimestamp, startingTimestamp + 60 * 1000 * 5);
      assert.ok(result.length);
      const [first] = result;
      assert(first.timestamp > 0);
      assert(first.number > 0);
    });
    it("calculateRewards", async function() {
      this.timeout(1000000);
      // small value to give floating math some wiggle room
      const epsilon = 0.001;

      const result = await affiliates.getRewards({
        totalRewards: devRewardsToDistribute,
        startTime: startingTimestamp,
        endTime: endingTimestamp,
        empWhitelist: lodash.zip(
          empContracts,
          empDeployers,
          empContracts.map(() => empAbi)
        ),
        collateralTokens: collateralTokens,
        collateralTokenDecimals: collateralTokenDecimals,
        syntheticTokenDecimals: syntheticTokenDecimals
      });

      assert.equal(Object.keys(result.deployerPayouts).length, 2); // There should be 2 deployers for the 3 EMPs.
      assert.equal(Object.keys(result.empPayouts).length, empContracts.length); // There should be 3 emps

      assert.isBelow(
        // compare floats with an epsilon
        Math.abs(
          Object.values(result.deployerPayouts).reduce((total, value) => {
            return Number(total) + Number(value);
          }, 0) - Number(devRewardsToDistribute)
        ),
        epsilon
      ); // the total rewards distributed should equal the number specified
      assert.isBelow(
        Math.abs(
          Object.values(result.empPayouts).reduce((total, value) => {
            return Number(total) + Number(value);
          }, 0) - Number(devRewardsToDistribute)
        ),
        epsilon
      ); // the total rewards distributed should equal the number specified
    });
  });
});

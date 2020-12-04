const { DeployerRewards } = require("../../libs/affiliates");
const lodash = require("lodash");
const { assert } = require("chai");
const { getAbi } = require("@uma/core");
const { Prices } = require("../../libs/models");
// Dataset based mocks that know how to load data from files. This is not the same as the libs/mocks file.
const { mocks } = require("../../libs/datasets");
const Path = require("path");

const empAbi = getAbi("ExpiringMultiParty");
const empCreatorAbi = getAbi("ExpiringMultiPartyCreator");

const { EmpBalancesHistory } = require("../../libs/processors");

const datasetPath = Path.join(__dirname, "../datasets/set1");
const params = require(Path.join(datasetPath, "/config.json"));

const { getWeb3 } = require("@uma/common");
const web3 = getWeb3();
const { toWei } = web3.utils;

const {
  empCreator,
  empContracts,
  collateralTokens,
  collateralTokenDecimals,
  syntheticTokenDecimals,
  startingTimestamp,
  endingTimestamp
} = params;
const devRewardsToDistribute = "50000";
// mocks
const { Queries, Coingecko, SynthPrices } = mocks;

describe("DeployerRewards", function() {
  describe("CalculateRewards Simple Data", function() {
    let balanceHistories, params, totalRewards, affiliates;
    beforeEach(function() {
      const queries = Queries(datasetPath);
      const coingecko = Coingecko(datasetPath);
      const synthPrices = SynthPrices(datasetPath);
      affiliates = DeployerRewards({
        queries,
        empAbi: empAbi,
        empCreatorAbi: empCreatorAbi,
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
      const empWhitelist = ["a", "b", "c", "d", "e", "f"];
      balanceHistories = empWhitelist.map(x => [x, EmpBalancesHistory()]);
      const empDeployers = empWhitelist.map(x => [x, { deployer: x + x }]);
      totalRewards = "100";

      params = {
        startTime,
        endTime,
        empWhitelist,
        empCreatorAddress: "creator",
        snapshotSteps: 1,
        collateralTokenPrices: empWhitelist.map(() => makePrices(endTime - startTime)),
        collateralTokenDecimals: empWhitelist.map(() => 18),
        syntheticTokenPricesWithValueCalculation: empWhitelist.map(() => makePricesWithValue(endTime - startTime)),
        syntheticTokenDecimals: empWhitelist.map(() => 18),
        blocks: lodash.times(endTime - startTime, i => ({ timestamp: i, number: i })),
        balanceHistories,
        empDeployers,
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
        // creating a position for address "bb" with 2 collateral 1 synthetic
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
  });
  describe("running dataset 1", function() {
    let affiliates;
    before(function() {
      const queries = Queries(datasetPath);
      const coingecko = Coingecko(datasetPath);
      const synthPrices = SynthPrices(datasetPath);
      affiliates = DeployerRewards({
        queries,
        empAbi,
        empCreatorAbi,
        coingecko,
        synthPrices
      });
    });
    it("getAllBalanceHistory", async function() {
      this.timeout(10000);
      const result = await affiliates.utils.getAllBalanceHistories(empContracts, startingTimestamp, endingTimestamp);
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
    it("getEmpDeployerHistory", async function() {
      this.timeout(10000);
      const result = await affiliates.utils.getEmpDeployerHistory(empCreator, startingTimestamp);
      assert(result.length);
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
      const target = 10n ** 18n;
      const syntheticPrice = 26.358177384415466;
      let result = affiliates.utils.calculateValueFromUsd(target, 0, syntheticPrice, 18, 18).toString();
      assert.equal(result, toWei(syntheticPrice.toFixed(18)));

      result = affiliates.utils.calculateValueFromUsd(target, 0, syntheticPrice, 0, 8).toString();
      assert.equal(result, toWei(syntheticPrice.toFixed(18)));
    });
    it("getBalanceHistory", async function() {
      this.timeout(10000);
      const result = await affiliates.utils.getBalanceHistory(empContracts[0], startingTimestamp, endingTimestamp);
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
    it("getEmpDeployerHistory", async function() {
      this.timeout(10000);
      const result = await affiliates.utils.getEmpDeployerHistory(empCreator, startingTimestamp);
      assert(result.length);
    });
    it("calculateRewards", async function() {
      this.timeout(1000000);
      // small value to give floating math some wiggle room
      const epsilon = 0.001;

      const result = await affiliates.getRewards({
        totalRewards: devRewardsToDistribute,
        startTime: startingTimestamp,
        endTime: endingTimestamp,
        empWhitelist: empContracts,
        empCreatorAddress: empCreator,
        collateralTokens: collateralTokens,
        collateralTokenDecimals: collateralTokenDecimals,
        syntheticTokenDecimals: syntheticTokenDecimals
      });

      assert.equal(Object.keys(result.deployerPayouts).length, 2); // There should be 2 deplorers for the 3 EMPs.
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

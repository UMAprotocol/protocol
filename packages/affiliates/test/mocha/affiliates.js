const { DeployerRewards } = require("../../libs/affiliates");
const { assert } = require("chai");
const { getAbi } = require("@uma/core");
const { mocks } = require("../../libs/datasets");
const Path = require("path");

const empAbi = getAbi("ExpiringMultiParty");
const empCreatorAbi = getAbi("ExpiringMultiPartyCreator");
const datasetPath = Path.join(__dirname, "../datasets/set1");
const params = require(Path.join(datasetPath, "/config.json"));
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

const { getWeb3 } = require("@uma/common");
const web3 = getWeb3();
const { toWei } = web3.utils;

describe("DeployerRewards", function() {
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
  it("getBalanceHistory", async function() {
    this.timeout(10000);
    const result = await affiliates.utils.getBalanceHistory(empContracts[0], startingTimestamp, endingTimestamp);
    assert.ok(result);
    assert.ok(result.history.length());
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
    const result = await affiliates.utils.getCoingeckoPriceHistory(address, "usd", startingTimestamp, endingTimestamp);
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
    result = affiliates.utils.calculateValue(target, "0.021647425848012932", "45829514207149404216", 18, 18).toString();
    diff = BigInt(result) - target;
    assert(diff > 0 ? diff : -diff < epsilon);
  });
  it("calculateValueFromUsd", async function() {
    // these are all stable coins so they should roughly be around 1 dollar
    // epsilon is high because variations could be nearly a dollar in any direction
    const target = 10n ** 18n;
    const syntheticPrice = 26.358177384415466
    let result = affiliates.utils.calculateValueFromUsd(target, 0, syntheticPrice, 18, 18).toString();
    assert.equal(result,toWei(syntheticPrice.toFixed(18)))

    result = affiliates.utils.calculateValueFromUsd(target, 0, syntheticPrice, 0, 8).toString();
    assert.equal(result,toWei(syntheticPrice.toFixed(18)))
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

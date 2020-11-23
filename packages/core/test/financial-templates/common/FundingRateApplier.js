const { interfaceName } = require("@uma/common");
const { assert } = require("chai");
const truffleAssert = require("truffle-assertions");

// Tested Contract
const FundingRateApplier = artifacts.require("FundingRateApplierTest");
const MockFundingRateStore = artifacts.require("MockFundingRateStore");

// Helper contracts
const Finder = artifacts.require("Finder");
const Timer = artifacts.require("Timer");

const { toWei, toBN, utf8ToHex } = web3.utils;

contract("FundingRateApplier", function() {
  let fpFinder;
  let mockFundingRateStore;
  let timer;

  beforeEach(async () => {
    fpFinder = await Finder.deployed();
    timer = await Timer.deployed();
    mockFundingRateStore = await MockFundingRateStore.new(timer.address);
    await fpFinder.changeImplementationAddress(utf8ToHex(interfaceName.FundingRateStore), mockFundingRateStore.address);
  });

  it("Construction parameters set properly", async () => {
    let fundingRateApplier = await FundingRateApplier.new(fpFinder.address, timer.address, { rawValue: "0" });

    assert.equal(await fundingRateApplier.cumulativeFundingRateMultiplier(), toWei("1"));
  });

  it("Computation of effective funding rate and its effect on the cumulative multiplier is correct", async () => {
    let fundingRateApplier = await FundingRateApplier.new(fpFinder.address, timer.address, { rawValue: "0" });

    // Funding rate of 0.15% charged over 20 seconds on a starting multiplier of 1:
    // Effective Rate: 0.0015 * 20 = 0.03, funding rate is positive so add 1 => 1.03
    // Cumulative Multiplier: 1 * 1.03 = 1.03
    const test1 = await fundingRateApplier.calculateEffectiveFundingRate(
      20,
      { rawValue: toWei("0.0015") },
      { rawValue: toWei("1") }
    );
    assert.equal(test1[0].rawValue, toWei("1.03"));
    assert.equal(test1[1].rawValue, toWei("0.03"));

    // Previous test but change the starting multiplier to 1.05:
    // Effective Rate: 0.0015 * 20 = 0.03, funding rate is positive so add 1 => 1.03
    // Cumulative Multiplier: 1.05 * 1.03 = 1.0815
    const test2 = await fundingRateApplier.calculateEffectiveFundingRate(
      20,
      { rawValue: toWei("0.0015") },
      { rawValue: toWei("1.05") }
    );
    assert.equal(test2[0].rawValue, toWei("1.0815"));
    assert.equal(test2[1].rawValue, toWei("0.03"));

    // Previous test but change the funding rate to -0.15%:
    // Effective Rate: -0.0015 * 20 = -0.03, funding rate is negative so subtract from 1 => 0.97
    // Cumulative Multiplier: 1.05 * 0.97 = 1.0185
    const test3 = await fundingRateApplier.calculateEffectiveFundingRate(
      20,
      { rawValue: toWei("-0.0015") },
      { rawValue: toWei("1.05") }
    );
    assert.equal(test3[0].rawValue, toWei("1.0185"));
    assert.equal(test3[1].rawValue, toWei("-0.03"));

    // Previous test but change the funding rate to 0% meaning that the multiplier shouldn't change:
    // Effective Rate: 0 * 20 = 0, funding rate is neutral so no change to the cumulative multiplier.
    // Cumulative Multiplier: 1.05 * 1 = 1.05
    const test4 = await fundingRateApplier.calculateEffectiveFundingRate(
      20,
      { rawValue: toWei("0") },
      { rawValue: toWei("1.05") }
    );
    assert.equal(test4[0].rawValue, toWei("1.05"));
    assert.equal(test4[1].rawValue, toWei("0"));
  });
  it("Applying positive and negative effective funding rates sets state and emits events correctly", async () => {
    let fundingRateApplier = await FundingRateApplier.new(fpFinder.address, timer.address, { rawValue: "0" });
    let startingTime = await timer.getCurrentTime();

    // Set a positive funding rate of 1.01 in the store and apply it for a period
    // of 5 seconds. New funding rate should be (1 + 0.01 * 5) * 1 = 1.05
    await mockFundingRateStore.setFundingRate(fundingRateApplier.address, await timer.getCurrentTime(), {
      rawValue: toWei("0.01")
    });
    await timer.setCurrentTime(startingTime.add(toBN(5)).toString());
    startingTime = await timer.getCurrentTime();
    const applyPositiveRate = await fundingRateApplier.applyFundingRate();
    let newFundingRateMultiplier = await fundingRateApplier.cumulativeFundingRateMultiplier();
    assert.equal(newFundingRateMultiplier, toWei("1.05"));
    truffleAssert.eventEmitted(applyPositiveRate, "NewFundingRate", ev => {
      return (
        ev.newMultiplier == toWei("1.05") &&
        ev.updateTime == startingTime.toString() &&
        ev.paymentPeriod == "5" &&
        ev.latestFundingRate == toWei("0.01") &&
        ev.periodRate == toWei("0.05")
      );
    });

    // Set a negative funding rate of 0.98 in the store and apply it for a period
    // of 5 seconds. New funding rate should be (1 - 0.02 * 5) * 1.05 = 0.9 * 1.05 = 0.945
    await mockFundingRateStore.setFundingRate(fundingRateApplier.address, await timer.getCurrentTime(), {
      rawValue: toWei("-0.02")
    });
    await timer.setCurrentTime(startingTime.add(toBN(5)).toString());
    startingTime = await timer.getCurrentTime();
    const applyNegativeRate = await fundingRateApplier.applyFundingRate();
    newFundingRateMultiplier = await fundingRateApplier.cumulativeFundingRateMultiplier();
    assert.equal(newFundingRateMultiplier, toWei("0.945"));
    truffleAssert.eventEmitted(applyNegativeRate, "NewFundingRate", ev => {
      return (
        ev.newMultiplier == toWei("0.945") &&
        ev.updateTime == startingTime.toString() &&
        ev.paymentPeriod == "5" &&
        ev.latestFundingRate == toWei("-0.02") &&
        ev.periodRate == toWei("-0.1")
      );
    });

    // Set a neutral funding rate in the store and verify that the multiplier
    // does not change.
    await mockFundingRateStore.setFundingRate(fundingRateApplier.address, await timer.getCurrentTime(), {
      rawValue: toWei("0")
    });
    await timer.setCurrentTime(startingTime.add(toBN(5)).toString());
    startingTime = await timer.getCurrentTime();
    const applyDefaultRate = await fundingRateApplier.applyFundingRate();
    newFundingRateMultiplier = await fundingRateApplier.cumulativeFundingRateMultiplier();
    assert.equal(newFundingRateMultiplier, toWei("0.945"));
    truffleAssert.eventEmitted(applyDefaultRate, "NewFundingRate", ev => {
      return (
        ev.newMultiplier == toWei("0.945") &&
        ev.updateTime == startingTime.toString() &&
        ev.paymentPeriod == "5" &&
        ev.latestFundingRate == toWei("0") &&
        ev.periodRate == toWei("0")
      );
    });
  });
});

const { interfaceName } = require("@uma/common");
const { assert } = require("chai");
const truffleAssert = require("truffle-assertions");

// Tested Contract
const FundingRateApplier = artifacts.require("FundingRateApplier");
const MockFundingRateStore = artifacts.require("MockFundingRateStore");

// Helper contracts
const Finder = artifacts.require("Finder");
const Timer = artifacts.require("Timer");

const { toWei, toBN, utf8ToHex } = web3.utils;

contract("FundingRateApplier", function() {
  let finder;
  let mockFundingRateStore;
  let timer;

  const identifier = "TEST_IDENTIFIER";

  beforeEach(async () => {
    finder = await Finder.deployed();
    timer = await Timer.deployed();
    mockFundingRateStore = await MockFundingRateStore.new(timer.address);
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.FundingRateStore), mockFundingRateStore.address);
  });

  it("Construction parameters set properly", async () => {
    let fundingRateApplier = await FundingRateApplier.new(
      { rawValue: toWei("1") },
      finder.address,
      timer.address,
      utf8ToHex(identifier)
    );

    assert.equal(await fundingRateApplier.cumulativeFundingRateMultiplier(), toWei("1"));
    assert.equal(await fundingRateApplier.fpFinder(), finder.address);
  });

  it("Apply positive and negative effective funding rates", async () => {
    let fundingRateApplier = await FundingRateApplier.new(
      { rawValue: toWei("1") },
      finder.address,
      timer.address,
      utf8ToHex(identifier)
    );
    let startingTime = await timer.getCurrentTime();

    // Set a positive funding rate of 1.01 in the store and apply it for a period
    // of 5 seconds. New funding rate should be (1 + 0.01 * 5) * 1 = 1.05
    await mockFundingRateStore.setFundingRate(utf8ToHex(identifier), await timer.getCurrentTime(), {
      rawValue: toWei("1.01")
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
        ev.latestFundingRate == toWei("1.01") &&
        ev.effectiveFundingRateForPaymentPeriod == toWei("1.05")
      );
    });

    // Set a negative funding rate of 0.98 in the store and apply it for a period
    // of 5 seconds. New funding rate should be (1 - 0.02 * 5) * 1.05 = 0.9 * 1.05 = 0.945
    await mockFundingRateStore.setFundingRate(utf8ToHex(identifier), await timer.getCurrentTime(), {
      rawValue: toWei("0.98")
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
        ev.latestFundingRate == toWei("0.98") &&
        ev.effectiveFundingRateForPaymentPeriod == toWei("0.9")
      );
    });

    // Set a neutral funding rate in the store and verify that the multiplier
    // does not change.
    await mockFundingRateStore.setFundingRate(utf8ToHex(identifier), await timer.getCurrentTime(), {
      rawValue: toWei("1")
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
        ev.latestFundingRate == toWei("1") &&
        ev.effectiveFundingRateForPaymentPeriod == toWei("1")
      );
    });
  });
});

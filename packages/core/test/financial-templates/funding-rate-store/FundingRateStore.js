// External libs
const { toWei, utf8ToHex: toHex } = web3.utils;

// Local libs
const { didContractThrow } = require("@uma/common");
const { assert } = require("chai");

// Tested Contract
const FundingRateStore = artifacts.require("FundingRateStore");

// Helper Contracts
const Timer = artifacts.require("Timer");

// Helper functions.
async function incrementTime(contract, amount) {
  const currentTime = await contract.getCurrentTime();
  await contract.setCurrentTime(Number(currentTime) + amount);
}

contract("FundingRateStore", function(accounts) {
  let timer;
  let fundingRateStore;
  let account1 = accounts[0];

  const liveness = 7200;

  beforeEach(async () => {
    timer = await Timer.deployed();
    fundingRateStore = await FundingRateStore.new(liveness, timer.address);
  });

  it("Liveness check", async function() {
    assert(await didContractThrow(FundingRateStore.new(0, timer.address)));
  });

  it("Initial Funding Rate of 0", async function() {
    const identifier = toHex("initial-rate");
    assert.equal((await fundingRateStore.getFundingRateForIdentifier(identifier)).rawValue.toString(), "0");
  });

  describe("Unexpired Proposal", function() {
    const identifier = toHex("unexpired-proposal");
    beforeEach(async () => {
      await fundingRateStore.propose(identifier, { rawValue: toWei("0.01") }, { from: account1 });
      await incrementTime(fundingRateStore, liveness - 1);
    });

    it("Initial rate persists", async function() {
      assert.equal((await fundingRateStore.getFundingRateForIdentifier(identifier)).rawValue.toString(), "0");
    });

    it("New proposal not allowed", async function() {
      assert(
        await didContractThrow(fundingRateStore.propose(identifier, { rawValue: toWei("0.01") }, { from: account1 }))
      );
    });
  });

  describe("Expired Proposal", function() {
    const identifier = toHex("expired-proposal");
    beforeEach(async () => {
      await fundingRateStore.propose(identifier, { rawValue: toWei("0.01") }, { from: account1 });
      await incrementTime(fundingRateStore, liveness);
    });

    it("New rate is retrieved", async function() {
      assert.equal((await fundingRateStore.getFundingRateForIdentifier(identifier)).rawValue.toString(), toWei("0.01"));
    });

    it("New proposal allowed", async function() {
      await fundingRateStore.propose(identifier, { rawValue: toWei("-0.01") }, { from: account1 });

      // Double check that existing value still persists even after a fresh proposal.
      assert.equal((await fundingRateStore.getFundingRateForIdentifier(identifier)).rawValue.toString(), toWei("0.01"));
    });
  });
});

// External libs
const { toWei, utf8ToHex: toHex } = web3.utils;

// Local libs
const { didContractThrow } = require("@uma/common");
const { assert } = require("chai");

// Tested Contract
const FundingRateStore = artifacts.require("FundingRateStore");

// Helper Contracts
const Timer = artifacts.require("Timer");

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

  it("Unexpired proposal", async function() {
    const identifier = toHex("unexpired-proposal");
    await fundingRateStore.propose(identifier, { rawValue: toWei("0.01") }, { from: account1 });
  });
});

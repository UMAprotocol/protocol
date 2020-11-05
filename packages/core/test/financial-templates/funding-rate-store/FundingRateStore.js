// External libs
const { toWei, utf8ToHex: toHex } = web3.utils;

// Local libs
const { didContractThrow } = require("@uma/common");
const { assert } = require("chai");

// Tested Contract
const FundingRateStore = artifacts.require("FundingRateStore");

// Helper Contracts
const Timer = artifacts.require("Timer");
const Token = artifacts.require("ExpandedERC20");

// Helper functions.
async function incrementTime(contract, amount) {
  const currentTime = await contract.getCurrentTime();
  await contract.setCurrentTime(Number(currentTime) + amount);
}

contract("FundingRateStore", function(accounts) {
  let timer;
  let fundingRateStore;

  const account1 = accounts[0];
  const derivative = accounts[1];

  const liveness = 7200;

  beforeEach(async () => {
    timer = await Timer.deployed();
    fundingRateStore = await FundingRateStore.new({ rawValue: "0" }, { rawValue: "0" }, liveness, timer.address);
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

  describe("Fees", function() {
    it("Construction check and basic compute fees test", async function() {
      // Set funding rate fee to 10%
      fundingRateStore = await FundingRateStore.new(
        { rawValue: toWei("0.1") },
        { rawValue: toWei("0") },
        liveness,
        timer.address
      );
      assert.equal((await fundingRateStore.fixedFundingRateFeePerSecondPerPfc()).toString(), toWei("0.1"));
      assert.equal((await fundingRateStore.weeklyDelayFeePerSecondPerPfc()).toString(), toWei("0"));

      // Deployer should hold both the owner and withdrawer roles.
      assert.equal(await fundingRateStore.getMember(0), account1);
      assert.equal(await fundingRateStore.getMember(1), account1);

      let pfc = { rawValue: toWei("2") };

      // Wait one second, then check fees are correct
      let fees = await fundingRateStore.computeFundingRateFee(100, 101, pfc);
      assert.equal(fees.fundingRateFee.toString(), toWei("0.2"));
      assert.equal(fees.latePenalty.toString(), "0");

      // Wait 10 seconds, then check fees are correct
      fees = await fundingRateStore.computeFundingRateFee(100, 110, pfc);
      assert.equal(fees.fundingRateFee.toString(), toWei("2"));
    });
    it("Check for illegal params", async function() {
      // Disallow endTime < startTime.
      assert(await didContractThrow(fundingRateStore.computeFundingRateFee(2, 1, 10)));

      // Disallow setting fees higher than 100%.
      assert(
        await didContractThrow(
          FundingRateStore.new({ rawValue: toWei("1") }, { rawValue: "0" }, liveness, timer.address)
        )
      );

      // Disallow setting late fees >= 100%.
      assert(
        await didContractThrow(
          FundingRateStore.new({ rawValue: "0" }, { rawValue: toWei("1") }, liveness, timer.address)
        )
      );
    });
    it("Weekly delay fees", async function() {
      // Add weekly delay fee and confirm
      fundingRateStore = await FundingRateStore.new(
        { rawValue: toWei("0") },
        { rawValue: toWei("0.5") },
        liveness,
        timer.address
      );
      assert.equal((await fundingRateStore.weeklyDelayFeePerSecondPerPfc()).toString(), toWei("0.5"));
    });
    it("Pay fees in ERC20 token", async function() {
      fundingRateStore = await FundingRateStore.new(
        { rawValue: toWei("0") },
        { rawValue: toWei("0") },
        liveness,
        timer.address
      );

      const firstMarginToken = await Token.new("UMA", "UMA", 18, { from: account1 });
      const secondMarginToken = await Token.new("UMA2", "UMA2", 18, { from: account1 });

      // Mint 100 tokens of each to the contract and verify balances.
      await firstMarginToken.addMember(1, account1, { from: account1 });
      await firstMarginToken.mint(derivative, toWei("100"), { from: account1 });
      let firstTokenBalanceInStore = await firstMarginToken.balanceOf(fundingRateStore.address);
      let firstTokenBalanceInDerivative = await firstMarginToken.balanceOf(derivative);
      assert.equal(firstTokenBalanceInStore, 0);
      assert.equal(firstTokenBalanceInDerivative, toWei("100"));

      await secondMarginToken.addMember(1, account1, { from: account1 });
      await secondMarginToken.mint(derivative, toWei("100"), { from: account1 });
      let secondTokenBalanceInStore = await secondMarginToken.balanceOf(fundingRateStore.address);
      let secondTokenBalanceInDerivative = await secondMarginToken.balanceOf(derivative);
      assert.equal(secondTokenBalanceInStore, 0);
      assert.equal(secondTokenBalanceInDerivative, toWei("100"));

      // Pay 10 of the first margin token to the store and verify balances.
      let feeAmount = toWei("10");
      await firstMarginToken.approve(fundingRateStore.address, feeAmount, { from: derivative });
      await fundingRateStore.payFundingRateFeesErc20(
        firstMarginToken.address,
        { rawValue: feeAmount },
        { from: derivative }
      );
      firstTokenBalanceInStore = await firstMarginToken.balanceOf(fundingRateStore.address);
      firstTokenBalanceInDerivative = await firstMarginToken.balanceOf(derivative);
      assert.equal(firstTokenBalanceInStore.toString(), toWei("10"));
      assert.equal(firstTokenBalanceInDerivative.toString(), toWei("90"));

      // Pay 20 of the second margin token to the store and verify balances.
      feeAmount = toWei("20");
      await secondMarginToken.approve(fundingRateStore.address, feeAmount, { from: derivative });
      await fundingRateStore.payFundingRateFeesErc20(
        secondMarginToken.address,
        { rawValue: feeAmount },
        { from: derivative }
      );
      secondTokenBalanceInStore = await secondMarginToken.balanceOf(fundingRateStore.address);
      secondTokenBalanceInDerivative = await secondMarginToken.balanceOf(derivative);
      assert.equal(secondTokenBalanceInStore.toString(), toWei("20"));
      assert.equal(secondTokenBalanceInDerivative.toString(), toWei("80"));

      // Withdraw 15 (out of 20) of the second margin token and verify balances.
      await fundingRateStore.withdrawErc20(secondMarginToken.address, toWei("15"), { from: account1 });
      let secondTokenBalanceInOwner = await secondMarginToken.balanceOf(account1);
      secondTokenBalanceInStore = await secondMarginToken.balanceOf(fundingRateStore.address);
      assert.equal(secondTokenBalanceInOwner.toString(), toWei("15"));
      assert.equal(secondTokenBalanceInStore.toString(), toWei("5"));

      // Only owner can withdraw.
      assert(
        await didContractThrow(
          fundingRateStore.withdrawErc20(secondMarginToken.address, toWei("5"), { from: derivative })
        )
      );

      // Can't withdraw more than the balance.
      assert(
        await didContractThrow(
          fundingRateStore.withdrawErc20(secondMarginToken.address, toWei("100"), { from: account1 })
        )
      );

      // Withdraw remaining amounts and verify balancse.
      await fundingRateStore.withdrawErc20(firstMarginToken.address, toWei("10"), { from: account1 });
      await fundingRateStore.withdrawErc20(secondMarginToken.address, toWei("5"), { from: account1 });

      let firstTokenBalanceInOwner = await firstMarginToken.balanceOf(account1);
      firstTokenBalanceInStore = await firstMarginToken.balanceOf(fundingRateStore.address);
      assert.equal(firstTokenBalanceInOwner.toString(), toWei("10"));
      assert.equal(firstTokenBalanceInStore.toString(), toWei("0"));

      secondTokenBalanceInOwner = await secondMarginToken.balanceOf(account1);
      secondTokenBalanceInStore = await secondMarginToken.balanceOf(fundingRateStore.address);
      assert.equal(secondTokenBalanceInOwner.toString(), toWei("20"));
      assert.equal(secondTokenBalanceInStore.toString(), toWei("0"));
    });

    it("Basic late penalty", async function() {
      const lateFeeRate = toWei("0.0001");
      const regularFeeRate = toWei("0.0002");
      fundingRateStore = await FundingRateStore.new(
        { rawValue: regularFeeRate },
        { rawValue: lateFeeRate },
        liveness,
        timer.address
      );
      assert.equal((await fundingRateStore.weeklyDelayFeePerSecondPerPfc()).toString(), lateFeeRate);

      const startTime = await fundingRateStore.getCurrentTime();

      const secondsPerWeek = 604800;

      // 1 week late -> 1x lateFeeRate.
      await fundingRateStore.setCurrentTime(startTime.addn(secondsPerWeek));

      // The period is 100 seconds long and the pfc is 100 units of collateral. This means that the fee amount should
      // effectively be scaled by 1000.
      let { latePenalty, fundingRateFee } = await fundingRateStore.computeFundingRateFee(
        startTime,
        startTime.addn(100),
        {
          rawValue: toWei("100")
        }
      );

      // Regular fee is double the per week late fee. So after 1 week, the late fee should be 1 and the regular should be 2.
      assert.equal(latePenalty.rawValue.toString(), toWei("1"));
      assert.equal(fundingRateFee.rawValue.toString(), toWei("2"));

      // 3 weeks late -> 3x lateFeeRate.
      await fundingRateStore.setCurrentTime(startTime.addn(secondsPerWeek * 3));

      ({ latePenalty, fundingRateFee } = await fundingRateStore.computeFundingRateFee(startTime, startTime.addn(100), {
        rawValue: toWei("100")
      }));

      // Regular fee is double the per week late fee. So after 3 weeks, the late fee should be 3 and the regular should be 2.
      assert.equal(latePenalty.rawValue.toString(), toWei("3"));
      assert.equal(fundingRateFee.rawValue.toString(), toWei("2"));
    });

    it("Late penalty based on current time", async function() {
      fundingRateStore = await FundingRateStore.new(
        { rawValue: toWei("0") },
        { rawValue: toWei("0.1") },
        liveness,
        timer.address
      );

      const startTime = await fundingRateStore.getCurrentTime();

      const secondsPerWeek = 604800;

      // Set current time to 1 week in the future to ensure the fee gets charged.
      await fundingRateStore.setCurrentTime((await fundingRateStore.getCurrentTime()).addn(secondsPerWeek));

      // Pay for a short period a week ago. Even though the endTime is < 1 week past the start time, the currentTime
      // should cause the late fee to be charged.
      const { latePenalty } = await fundingRateStore.computeFundingRateFee(startTime, startTime.addn(1), {
        rawValue: toWei("1")
      });

      // Payment is 1 week late, but the penalty is 10% per second of the period. Since the period is only 1 second,
      // we should see a 10% late fee.
      assert.equal(latePenalty.rawValue, toWei("0.1"));
    });
  });
});

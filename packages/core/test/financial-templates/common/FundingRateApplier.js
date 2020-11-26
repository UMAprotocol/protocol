const { interfaceName, didContractThrow } = require("@uma/common");
const { assert } = require("chai");
const truffleAssert = require("truffle-assertions");

// Tested Contract
const FundingRateApplier = artifacts.require("FundingRateApplierTest");

// Helper contracts
const OptimisticOracle = artifacts.require("OptimisticOracle");
const MockOracle = artifacts.require("MockOracle");
const Finder = artifacts.require("Finder");
const Timer = artifacts.require("Timer");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const Token = artifacts.require("ExpandedERC20");
const AddressWhitelist = artifacts.require("AddressWhitelist");

const { toWei, utf8ToHex } = web3.utils;

contract("FundingRateApplier", function(accounts) {
  // Single-deploy contracts.
  let finder;
  let timer;
  let collateralWhitelist;

  // Per-test contracts.
  let mockOracle;
  let optimisticOracle;
  let collateral;
  let fundingRateApplier;

  // Params
  const liveness = 7200;
  const rewardRate = toWei("0.000001"); // 1 percent every 10_000 seconds.
  const bondPercentage = toWei("0.01"); // 1 percent.
  const identifier = utf8ToHex("Test Identifier");
  const initialUserBalance = toWei("100");
  const defaultProposal = toWei("0.0000001"); // 1 percent every 100_000 seconds.
  const delay = 10000; // 10_000 seconds.
  let startTime;
  let currentTime;

  // Accounts.
  const owner = accounts[0];
  const other = accounts[1];
  const disputer = accounts[2];

  before(async () => {
    finder = await Finder.deployed();
    timer = await Timer.deployed();
    collateralWhitelist = await AddressWhitelist.deployed();

    // Approve identifier.
    const identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.addSupportedIdentifier(identifier);
  });

  beforeEach(async () => {
    finder = await Finder.deployed();
    timer = await Timer.deployed();

    // Set up a fresh mock oracle in the finder.
    mockOracle = await MockOracle.new(finder.address, timer.address);
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.Oracle), mockOracle.address);

    // Set up a fresh optimistic oracle in the finder.
    optimisticOracle = await OptimisticOracle.new(liveness, finder.address, timer.address);
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.OptimisticOracle), optimisticOracle.address);

    // Set up a fresh collateral currency to use.
    collateral = await Token.new("Wrapped Ether", "WETH", 18);
    await collateral.addMember(1, owner);
    await collateral.mint(owner, initialUserBalance);
    await collateral.mint(other, initialUserBalance);
    await collateral.mint(disputer, initialUserBalance);
    await collateralWhitelist.addToWhitelist(collateral.address);

    // Set up the funding rate applier.
    fundingRateApplier = await FundingRateApplier.new(
      { rawValue: bondPercentage },
      { rawValue: rewardRate },
      identifier,
      collateral.address,
      finder.address,
      timer.address
    );

    // Mint the funding rate applier the same number of tokens as the users for ease of math.
    await collateral.mint(fundingRateApplier.address, initialUserBalance);

    // Approve the funding rate applier to spend the owner and other's funds.
    await collateral.approve(fundingRateApplier.address, toWei("100000000"), { from: owner });
    await collateral.approve(fundingRateApplier.address, toWei("100000000"), { from: other });

    // Approve the optimistic oracle to spend the disputer's funds.
    await collateral.approve(optimisticOracle.address, toWei("100000000"), { from: disputer });

    startTime = (await fundingRateApplier.getCurrentTime()).toNumber();
    currentTime = startTime;
  });

  it("Computation of effective funding rate and its effect on the cumulative multiplier is correct", async () => {
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

  it("Initial 0 funding rate", async () => {
    await fundingRateApplier.setCurrentTime(startTime + 1000);
    await fundingRateApplier.applyFundingRate();
    assert.equal((await fundingRateApplier.fundingRate()).cumulativeMultiplier.rawValue.toString(), toWei("1"));
    assert.equal((await fundingRateApplier.fundingRate()).rate.rawValue.toString(), "0");
  });

  it("Proposal time checks", async () => {
    const newRate = { rawValue: toWei("-0.0001") };

    // Cannot be at or before the last update time.
    assert(await didContractThrow(fundingRateApplier.proposeNewRate(newRate, startTime)));

    // Move time forward to give some space for new proposals.
    const currentTime = startTime + delay;
    await fundingRateApplier.setCurrentTime(currentTime);

    // Time must be _around_ now. (between 30 minutes in the past and 90 seconds in the future).
    const thirtyMinutes = 1800;
    const ninetySeconds = 90;
    assert(await didContractThrow(fundingRateApplier.proposeNewRate(newRate, currentTime - thirtyMinutes - 1)));
    await fundingRateApplier.proposeNewRate.call(newRate, currentTime - thirtyMinutes);
    assert(await didContractThrow(fundingRateApplier.proposeNewRate(newRate, currentTime + ninetySeconds + 1)));
    await fundingRateApplier.proposeNewRate(newRate, currentTime + ninetySeconds);
  });

  describe("Undisputed proposal", async () => {
    beforeEach(async () => {
      // Move time forward to give some space for new proposals.
      currentTime = startTime + delay;
      await fundingRateApplier.setCurrentTime(currentTime);

      // First proposal at the current time.
      await fundingRateApplier.proposeNewRate({ rawValue: defaultProposal }, currentTime);
    });

    it("Two proposals cannot coexist", async () => {
      // Move time forward a small amount to not expire the previous one, but to give room for a new proposal.
      currentTime += 5;
      await fundingRateApplier.setCurrentTime(currentTime);

      // Proposal should fail because the previous one has not expired.
      assert(await didContractThrow(fundingRateApplier.proposeNewRate({ rawValue: defaultProposal }, currentTime)));

      // Expire the previous proposal allowing a new proposal to succeed.
      currentTime += delay;
      await fundingRateApplier.setCurrentTime(currentTime);
      await fundingRateApplier.proposeNewRate({ rawValue: defaultProposal }, currentTime);
    });

    it("Correctly sets price and updates cumulative multiplier", async () => {
      // Move time forward to expire the proposal.
      currentTime += delay;
      await fundingRateApplier.setCurrentTime(currentTime);

      // Apply the newly expired rate.
      await fundingRateApplier.applyFundingRate();

      // 1 percent per 100_000 seconds is the default proposal. It has been applied for 10_000 seconds, so we should
      // see a +0.1% change.
      assert.equal((await fundingRateApplier.fundingRate()).cumulativeMultiplier.rawValue, toWei("1.001"));
    });

    it("Pays rewards", async () => {
      // Owner should have already paid 1 percent of pfc (1 token) to the funding rate store.
      assert.equal((await collateral.balanceOf(owner)).toString(), toWei("99"));

      // Funding rate store does not escrow, the optimistic oracle does.
      assert.equal((await collateral.balanceOf(fundingRateApplier.address)).toString(), initialUserBalance);
      assert.equal((await collateral.balanceOf(optimisticOracle.address)).toString(), toWei("1"));

      // Move time forward to expire the proposal.
      currentTime += delay;
      await fundingRateApplier.setCurrentTime(currentTime);

      // Apply the newly expired rate.
      await fundingRateApplier.applyFundingRate();

      // Owner should have their bond back and have received:
      // - a reward of 1% (10_000 seconds * 0.000001 reward rate / second) of 100 tokens of pfc -- 1 token.
      // - their bond back -- 1 token.
      assert.equal((await collateral.balanceOf(owner)).toString(), toWei("101"));
      assert.equal((await collateral.balanceOf(fundingRateApplier.address)).toString(), toWei("99"));
    });

    it("Event + compounding funding rate multiplier", async () => {
      // Move time forward to expire the proposal.
      currentTime += delay;
      await fundingRateApplier.setCurrentTime(currentTime);

      // Apply the newly expired rate.
      let receipt = await fundingRateApplier.applyFundingRate();

      // Update and check event
      truffleAssert.eventEmitted(receipt, "NewFundingRateMultiplier", ev => {
        return (
          ev.newMultiplier == toWei("1.001") &&
          ev.lastApplicationTime == (currentTime - delay).toString() &&
          ev.applicationTime == currentTime.toString() &&
          ev.paymentPeriod == delay.toString() &&
          ev.latestFundingRate == defaultProposal &&
          ev.periodRate == toWei("0.001")
        );
      });

      // Move time forward again.
      currentTime += delay;
      await fundingRateApplier.setCurrentTime(currentTime);

      // Apply the rate again.
      receipt = await fundingRateApplier.applyFundingRate();

      // Update and check event
      truffleAssert.eventEmitted(receipt, "NewFundingRateMultiplier", ev => {
        return (
          ev.newMultiplier == toWei("1.002001") &&
          ev.lastApplicationTime == (currentTime - delay).toString() &&
          ev.applicationTime == currentTime.toString() &&
          ev.paymentPeriod == delay.toString() &&
          ev.latestFundingRate == defaultProposal &&
          ev.periodRate == toWei("0.001")
        );
      });

      assert.equal((await fundingRateApplier.fundingRate()).cumulativeMultiplier.rawValue, toWei("1.002001"));

      // Propose a new rate of the negative of the previous proposal
      await fundingRateApplier.proposeNewRate({ rawValue: `-${defaultProposal}` }, currentTime);

      // Move time forward again.
      currentTime += delay;
      await fundingRateApplier.setCurrentTime(currentTime);

      // Apply the rate again.
      receipt = await fundingRateApplier.applyFundingRate();

      // Update and check event
      truffleAssert.eventEmitted(receipt, "NewFundingRateMultiplier", ev => {
        return (
          ev.newMultiplier == toWei("1.000998999") &&
          ev.lastApplicationTime == (currentTime - delay).toString() &&
          ev.applicationTime == currentTime.toString() &&
          ev.paymentPeriod == delay.toString() &&
          ev.latestFundingRate == `-${defaultProposal}` &&
          ev.periodRate == toWei("-0.001")
        );
      });
    });
  });

  describe("Disputed proposal", async () => {
    beforeEach(async () => {
      // Move time forward to give some space for new proposals.
      currentTime = startTime + delay;
      await fundingRateApplier.setCurrentTime(currentTime);

      // First proposal at the current time.
      await fundingRateApplier.proposeNewRate({ rawValue: defaultProposal }, currentTime);

      // Dispute proposal
      await optimisticOracle.disputePrice(fundingRateApplier.address, identifier, currentTime, { from: disputer });
    });

    it("Doesn't pay rewards after resolution", async () => {
      const proposalTime = currentTime;
      // Both participants should have paid out 1 token (1% of pfc).
      assert.equal((await collateral.balanceOf(owner)).toString(), toWei("99"));
      assert.equal((await collateral.balanceOf(disputer)).toString(), toWei("99"));

      // The optimistic oracle should be escrowing that money.
      assert.equal((await collateral.balanceOf(optimisticOracle.address)).toString(), toWei("2"));

      // Move time forward to where the proposal would have expired (if not disputed).
      currentTime += delay;
      await fundingRateApplier.setCurrentTime(currentTime);

      // Apply the newly expired rate.
      await fundingRateApplier.applyFundingRate();

      // No rewards should be paid yet since the proposal is yet to be resolved.
      assert.equal((await collateral.balanceOf(owner)).toString(), toWei("99"));
      assert.equal((await collateral.balanceOf(disputer)).toString(), toWei("99"));

      // Resolve the dispute.
      await mockOracle.pushPrice(identifier, proposalTime, defaultProposal);

      // Settle and apply.
      await optimisticOracle.settle(fundingRateApplier.address, identifier, proposalTime);
      await fundingRateApplier.applyFundingRate();

      // Funding rate is not updated because disputed requests do not
      assert.equal((await fundingRateApplier.fundingRate()).proposalTime, "0");

      // No net reward is paid out.
      assert.equal((await collateral.balanceOf(owner)).toString(), toWei("101"));
      assert.equal((await collateral.balanceOf(disputer)).toString(), toWei("99"));
      assert.equal((await collateral.balanceOf(fundingRateApplier.address)).toString(), toWei("100"));
    });

    it("Doesn't get applied after resolution", async () => {
      const proposalTime = currentTime;

      // Move time forward to when the proposal would have expired if not disputed.
      currentTime += delay;
      await fundingRateApplier.setCurrentTime(currentTime);

      // Apply the newly expired rate.
      await fundingRateApplier.applyFundingRate();

      // Proposal is no longer tracked.
      assert.equal((await fundingRateApplier.fundingRate()).proposalTime, "0");

      // Resolve the dispute.
      await mockOracle.pushPrice(identifier, proposalTime, defaultProposal);

      // No auto-expiry.
      await fundingRateApplier.applyFundingRate();

      // Can still settle after applying the funding rate because this rate isn't tracked anymore.
      await optimisticOracle.settle(fundingRateApplier.address, identifier, proposalTime);

      // Apply funding rate again for good measure.
      await fundingRateApplier.applyFundingRate();

      // Funding rate is not updated because disputed requests do not update the funding rate in the contract.
      assert.equal((await fundingRateApplier.fundingRate()).proposalTime, "0");
    });

    it("Allows new proposals immediately", async () => {
      // Time must move forward so this isn't the _exact_ same proposal as the previous.
      currentTime += 1;
      await fundingRateApplier.setCurrentTime(currentTime);
      await fundingRateApplier.proposeNewRate({ rawValue: defaultProposal }, currentTime);
    });
  });
});

const { interfaceName, didContractThrow } = require("@uma/common");
const { assert } = require("chai");
const truffleAssert = require("truffle-assertions");

// Tested Contract
const FundingRateApplier = artifacts.require("FundingRateApplierTest");

// Helper contracts
const OptimisticOracle = artifacts.require("OptimisticOracle");
const MockOracle = artifacts.require("MockOracleAncillary");
const Finder = artifacts.require("Finder");
const Timer = artifacts.require("Timer");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const Token = artifacts.require("ExpandedERC20");
const AddressWhitelist = artifacts.require("AddressWhitelist");
const ConfigStore = artifacts.require("ConfigStore");

const { toWei, utf8ToHex, hexToUtf8 } = web3.utils;

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
  let config;

  // Params
  const liveness = 7200;
  const rewardRate = toWei("0.000001"); // 1 percent every 10_000 seconds.
  const bondPercentage = toWei("0.0001"); // .01 percent.
  const identifier = utf8ToHex("Test Identifier");
  const initialUserBalance = toWei("100");
  const defaultProposal = toWei("0.0000001"); // 1 percent every 100_000 seconds.
  const maxFundingRate = toWei("0.00001");
  const minFundingRate = toWei("-0.00001");
  const tokenScaling = toWei("1");
  const proposalTimePastLimit = 1800; // 30 mins.
  const delay = 10000; // 10_000 seconds.
  let startTime;
  let currentTime;
  let ancillaryData;

  // Accounts.
  const owner = accounts[0];
  const other = accounts[1];
  const disputer = accounts[2];

  const pushPrice = async price => {
    const [lastQuery] = (await mockOracle.getPendingQueries()).slice(-1);

    // Check that the ancillary data matches expectations.
    // Note: hashing seems to be the only way to generate a tight packing offchain.
    const expectedHash = web3.utils.soliditySha3(
      { t: "address", v: collateral.address },
      { t: "bytes", v: web3.utils.utf8ToHex("OptimisticOracle") },
      { t: "address", v: fundingRateApplier.address }
    );
    assert.equal(web3.utils.soliditySha3({ t: "bytes", v: lastQuery.ancillaryData }), expectedHash);

    await mockOracle.pushPrice(lastQuery.identifier, lastQuery.time, lastQuery.ancillaryData, price);
  };

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

    // Set up config contract.
    config = await ConfigStore.new(
      {
        timelockLiveness: 86400, // 1 day
        rewardRatePerSecond: { rawValue: rewardRate },
        proposerBondPercentage: { rawValue: bondPercentage },
        maxFundingRate: { rawValue: maxFundingRate },
        minFundingRate: { rawValue: minFundingRate },
        proposalTimePastLimit: proposalTimePastLimit // 30 mins
      },
      timer.address
    );

    // Set up the funding rate applier.
    fundingRateApplier = await FundingRateApplier.new(
      identifier,
      collateral.address,
      finder.address,
      config.address,
      { rawValue: tokenScaling },
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

    // Note: in the test funding rate applier, the ancillary data is just the collateral address.
    ancillaryData = collateral.address;
  });

  it("Correctly sets funding rate multiplier", async () => {
    const customTokenScaling = toWei("1000");
    fundingRateApplier = await FundingRateApplier.new(
      identifier,
      collateral.address,
      finder.address,
      config.address,
      { rawValue: customTokenScaling },
      timer.address
    );

    assert.equal((await fundingRateApplier.fundingRate()).cumulativeMultiplier.toString(), customTokenScaling);
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
    assert.equal(test1.rawValue, toWei("1.03"));

    // Previous test but change the starting multiplier to 1.05:
    // Effective Rate: 0.0015 * 20 = 0.03, funding rate is positive so add 1 => 1.03
    // Cumulative Multiplier: 1.05 * 1.03 = 1.0815
    const test2 = await fundingRateApplier.calculateEffectiveFundingRate(
      20,
      { rawValue: toWei("0.0015") },
      { rawValue: toWei("1.05") }
    );
    assert.equal(test2.rawValue, toWei("1.0815"));

    // Previous test but change the funding rate to -0.15%:
    // Effective Rate: -0.0015 * 20 = -0.03, funding rate is negative so subtract from 1 => 0.97
    // Cumulative Multiplier: 1.05 * 0.97 = 1.0185
    const test3 = await fundingRateApplier.calculateEffectiveFundingRate(
      20,
      { rawValue: toWei("-0.0015") },
      { rawValue: toWei("1.05") }
    );
    assert.equal(test3.rawValue, toWei("1.0185"));

    // Previous test but change the funding rate to 0% meaning that the multiplier shouldn't change:
    // Effective Rate: 0 * 20 = 0, funding rate is neutral so no change to the cumulative multiplier.
    // Cumulative Multiplier: 1.05 * 1 = 1.05
    const test4 = await fundingRateApplier.calculateEffectiveFundingRate(
      20,
      { rawValue: toWei("0") },
      { rawValue: toWei("1.05") }
    );
    assert.equal(test4.rawValue, toWei("1.05"));
  });

  it("Initial funding rate struct is correct", async () => {
    const fundingRate = await fundingRateApplier.fundingRate();
    assert.equal(fundingRate.rate.toString(), "0");
    assert.equal(hexToUtf8(fundingRate.identifier), hexToUtf8(identifier));
    assert.equal(fundingRate.cumulativeMultiplier.toString(), toWei("1"));
    assert.equal(fundingRate.updateTime.toString(), startTime.toString());
    assert.equal(fundingRate.applicationTime.toString(), startTime.toString());
    assert.equal(fundingRate.proposalTime.toString(), "0");
  });
  it("Calling applyFundingRate without a pending proposal does not change multiplier", async () => {
    await fundingRateApplier.setCurrentTime(startTime + 1000);
    const receipt = await fundingRateApplier.applyFundingRate();
    assert.equal((await fundingRateApplier.fundingRate()).cumulativeMultiplier.rawValue.toString(), toWei("1"));
    assert.equal((await fundingRateApplier.fundingRate()).rate.rawValue.toString(), "0");

    // A NewFundingRateMultiplier is emitted.
    truffleAssert.eventNotEmitted(receipt, "FundingRateUpdated");
  });

  it("Funding rate proposal must be within limits", async function() {
    // Max/min funding rate per second is [< +1e-5, > -1e-5].
    const currentTime = (await fundingRateApplier.getCurrentTime()).toNumber();
    assert(await didContractThrow(fundingRateApplier.proposeFundingRate({ rawValue: toWei("0.00002") }, currentTime)));
    assert(await didContractThrow(fundingRateApplier.proposeFundingRate({ rawValue: toWei("-0.00002") }, currentTime)));
  });

  it("Proposal time checks", async () => {
    const newRate = { rawValue: toWei("-0.000001") };

    // Cannot be at or before the last update time.
    assert(await didContractThrow(fundingRateApplier.proposeFundingRate(newRate, startTime)));

    // Move time forward to give some space for new proposals.
    const currentTime = startTime + delay;
    await fundingRateApplier.setCurrentTime(currentTime);

    // Time must be within the past and future bounds around the current time.
    assert(
      await didContractThrow(fundingRateApplier.proposeFundingRate(newRate, currentTime - proposalTimePastLimit - 1))
    );
    await fundingRateApplier.proposeFundingRate.call(newRate, currentTime - proposalTimePastLimit);
    assert(await didContractThrow(fundingRateApplier.proposeFundingRate(newRate, currentTime + 1)));
    await fundingRateApplier.proposeFundingRate(newRate, currentTime);
  });

  describe("Undisputed proposal", async () => {
    beforeEach(async () => {
      // Move time forward to give some space for new proposals since the last update time was set to deployment time.
      currentTime = startTime + delay;
      await fundingRateApplier.setCurrentTime(currentTime);

      // First proposal at the current time.
      await fundingRateApplier.proposeFundingRate({ rawValue: defaultProposal }, currentTime);
    });

    it("Two proposals cannot coexist", async () => {
      // Proposal should fail because the previous one has not expired.
      assert(await didContractThrow(fundingRateApplier.proposeFundingRate({ rawValue: defaultProposal }, currentTime)));

      // Expire the previous proposal allowing a new proposal to succeed.
      currentTime += delay;
      await fundingRateApplier.setCurrentTime(currentTime);
      await fundingRateApplier.proposeFundingRate({ rawValue: defaultProposal }, currentTime);
    });

    it("Correctly sets price and updates cumulative multiplier", async () => {
      // Move time forward to expire the proposal.
      currentTime += delay;
      await fundingRateApplier.setCurrentTime(currentTime);

      // Apply the newly expired rate.
      const receipt = await fundingRateApplier.applyFundingRate();
      truffleAssert.eventEmitted(receipt, "FundingRateUpdated", ev => {
        return (
          ev.newFundingRate.toString() === defaultProposal &&
          ev.updateTime.toString() === (currentTime - delay).toString() && // Update time is equal to the proposal time.
          ev.reward.toString() === toWei("1")
          // The reward is 1% (10_000 seconds * 0.000001 reward rate / second) of 100 tokens of pfc --> 1 token
        );
      });

      // 1 percent per 100_000 seconds is the default proposal. It has been applied for 10_000 seconds, so we should
      // see a +0.1% change.
      assert.equal((await fundingRateApplier.fundingRate()).cumulativeMultiplier.rawValue, toWei("1.001"));
    });

    it("Pays rewards", async () => {
      // Owner should have already paid 0.01 percent of pfc (0.01 token) to the funding rate store for the
      // proposal bond.
      assert.equal((await collateral.balanceOf(owner)).toString(), toWei("99.99"));

      // Funding rate store does not escrow, the optimistic oracle does.
      assert.equal((await collateral.balanceOf(fundingRateApplier.address)).toString(), initialUserBalance);
      assert.equal((await collateral.balanceOf(optimisticOracle.address)).toString(), toWei("0.01"));

      // Move time forward to expire the proposal.
      currentTime += delay;
      await fundingRateApplier.setCurrentTime(currentTime);

      // Apply the newly expired rate.
      await fundingRateApplier.applyFundingRate();

      // Owner should have their bond back and have received:
      // - a reward of 1% (10_000 seconds * 0.000001 reward rate / second) of 100 tokens of pfc -- 1 token.
      // - their bond back -- 0.01 token.
      // Net 1 token more than their initial balance.
      assert.equal((await collateral.balanceOf(owner)).toString(), toWei("101"));
      assert.equal((await collateral.balanceOf(fundingRateApplier.address)).toString(), toWei("99"));
    });

    it("Compounding funding rate multiplier", async () => {
      // Move time forward to expire the proposal.
      currentTime += delay;
      await fundingRateApplier.setCurrentTime(currentTime);

      // Apply the newly expired rate.
      await fundingRateApplier.applyFundingRate();
      assert.equal((await fundingRateApplier.fundingRate()).cumulativeMultiplier.rawValue, toWei("1.001"));

      // Move time forward again.
      currentTime += delay;
      await fundingRateApplier.setCurrentTime(currentTime);

      // Apply the rate again.
      await fundingRateApplier.applyFundingRate();
      assert.equal((await fundingRateApplier.fundingRate()).cumulativeMultiplier.rawValue, toWei("1.002001"));

      // Propose a new rate of the negative of the previous proposal
      await fundingRateApplier.proposeFundingRate({ rawValue: `-${defaultProposal}` }, currentTime);

      // Move time forward again.
      currentTime += delay;
      await fundingRateApplier.setCurrentTime(currentTime);

      // Apply the rate again.
      await fundingRateApplier.applyFundingRate();
      assert.equal((await fundingRateApplier.fundingRate()).cumulativeMultiplier.rawValue, toWei("1.000998999"));
    });

    it("Oracle is upgraded while the request is still pending", async () => {
      // Register a new optimistic oracle in the finder.
      let optimisticOracleV2 = await OptimisticOracle.new(liveness, finder.address, timer.address);
      await finder.changeImplementationAddress(utf8ToHex(interfaceName.OptimisticOracle), optimisticOracleV2.address);

      // propose() should reset the proposal time to 0 via the fees() modifier, and therefore it should be possible
      // to propose a new rate.
      await fundingRateApplier.proposeFundingRate({ rawValue: defaultProposal }, currentTime);
      // The funding rate multiplier should be unchanged.
      assert.equal((await fundingRateApplier.fundingRate()).cumulativeMultiplier.rawValue, toWei("1"));

      // As long as this new oracle is not upgraded and the proposal has not expired, then propose() should revert.
      assert(await didContractThrow(fundingRateApplier.proposeFundingRate({ rawValue: defaultProposal }, currentTime)));
    });
  });

  describe("Disputed proposal", async () => {
    beforeEach(async () => {
      // Move time forward to give some space for new proposals.
      currentTime = startTime + delay;
      await fundingRateApplier.setCurrentTime(currentTime);

      // First proposal at the current time.
      await fundingRateApplier.proposeFundingRate({ rawValue: defaultProposal }, currentTime);

      // Dispute proposal
      await optimisticOracle.disputePrice(fundingRateApplier.address, identifier, currentTime, ancillaryData, {
        from: disputer
      });
    });

    it("Doesn't pay rewards after resolution", async () => {
      const proposalTime = currentTime;
      // Both participants should have paid out 0.01 token (0.01% of pfc).
      assert.equal((await collateral.balanceOf(owner)).toString(), toWei("99.99"));
      assert.equal((await collateral.balanceOf(disputer)).toString(), toWei("99.99"));

      // The optimistic oracle should be escrowing all the money minus the burned portion (1/2 of the 0.01 bond), which
      // is paid to the store on dispute.
      assert.equal((await collateral.balanceOf(optimisticOracle.address)).toString(), toWei("0.015"));

      // Move time forward to where the proposal would have expired (if not disputed).
      currentTime += delay;
      await fundingRateApplier.setCurrentTime(currentTime);

      // Apply the newly expired rate.
      await fundingRateApplier.applyFundingRate();

      // No rewards should be paid yet since the proposal is yet to be resolved.
      assert.equal((await collateral.balanceOf(owner)).toString(), toWei("99.99"));
      assert.equal((await collateral.balanceOf(disputer)).toString(), toWei("99.99"));

      // Resolve the dispute.
      await pushPrice(defaultProposal);

      // Settle and apply.
      await optimisticOracle.settle(fundingRateApplier.address, identifier, proposalTime, ancillaryData);
      await fundingRateApplier.applyFundingRate();

      // Funding rate is not updated because disputed requests do not
      assert.equal((await fundingRateApplier.fundingRate()).proposalTime, "0");

      // No net reward is paid out. Half of the disputer's bond is burned to the store.
      assert.equal((await collateral.balanceOf(owner)).toString(), toWei("100.005"));
      assert.equal((await collateral.balanceOf(disputer)).toString(), toWei("99.99"));
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
      await pushPrice(defaultProposal);

      // No auto-expiry.
      await fundingRateApplier.applyFundingRate();

      // Can still settle after applying the funding rate because this rate isn't tracked anymore.
      await optimisticOracle.settle(fundingRateApplier.address, identifier, proposalTime, ancillaryData);

      // Apply funding rate again for good measure.
      await fundingRateApplier.applyFundingRate();

      // Funding rate is not updated because disputed requests do not update the funding rate in the contract.
      assert.equal((await fundingRateApplier.fundingRate()).proposalTime, "0");
    });

    it("Allows new proposals immediately", async () => {
      // Time must move forward so this isn't the _exact_ same proposal as the previous.
      currentTime += 1;
      await fundingRateApplier.setCurrentTime(currentTime);
      await fundingRateApplier.proposeFundingRate({ rawValue: defaultProposal }, currentTime);
    });
  });
});

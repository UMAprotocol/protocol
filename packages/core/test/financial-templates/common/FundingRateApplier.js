const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract, assertEventNotEmitted, assertEventEmitted } = hre;
const { interfaceName, didContractThrow } = require("@uma/common");
const { assert } = require("chai");

// Tested Contract
const FundingRateApplier = getContract("FundingRateApplierTest");

// Helper contracts
const OptimisticOracle = getContract("OptimisticOracle");
const MockOracle = getContract("MockOracleAncillary");
const Finder = getContract("Finder");
const Timer = getContract("Timer");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const Token = getContract("ExpandedERC20");
const AddressWhitelist = getContract("AddressWhitelist");
const ConfigStore = getContract("ConfigStore");

const { toWei, utf8ToHex, hexToUtf8 } = web3.utils;

describe("FundingRateApplier", function () {
  let accounts;
  let owner;
  let other;
  let disputer;

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

  const pushPrice = async (price) => {
    const [lastQuery] = (await mockOracle.methods.getPendingQueries().call()).slice(-1);

    // FundingRateApplier initially saves the synthetic token address to ancillary data:
    const expectedFRAAncillaryData = utf8ToHex(`tokenAddress:${collateral.options.address.substr(2).toLowerCase()}`);

    // OptimisticOracle should append its address:
    const expectedAppendedAncillaryData = utf8ToHex(
      `,ooRequester:${fundingRateApplier.options.address.substr(2).toLowerCase()}`
    ).substr(2);
    const expectedAncillaryData = `${expectedFRAAncillaryData}${expectedAppendedAncillaryData}`;
    assert.equal(lastQuery.ancillaryData, expectedAncillaryData);

    await mockOracle.methods
      .pushPrice(lastQuery.identifier, lastQuery.time, lastQuery.ancillaryData, price)
      .send({ from: accounts[0] });
  };

  before(async () => {
    // Accounts.
    accounts = await web3.eth.getAccounts();
    [owner, other, disputer] = accounts;

    await runDefaultFixture(hre);

    finder = await Finder.deployed();
    timer = await Timer.deployed();
    collateralWhitelist = await AddressWhitelist.deployed();

    // Approve identifier.
    const identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });
  });

  beforeEach(async () => {
    // Set up a fresh mock oracle in the finder.
    mockOracle = await MockOracle.new(finder.options.address, timer.options.address).send({ from: accounts[0] });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Oracle), mockOracle.options.address)
      .send({ from: accounts[0] });

    // Set up a fresh optimistic oracle in the finder.
    optimisticOracle = await OptimisticOracle.deployed();
    optimisticOracle = await OptimisticOracle.new(liveness, finder.options.address, timer.options.address).send({
      from: accounts[0],
    });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.OptimisticOracle), optimisticOracle.options.address)
      .send({ from: accounts[0] });

    // Set up a fresh collateral currency to use.
    collateral = await Token.new("Wrapped Ether", "WETH", 18).send({ from: accounts[0] });
    await collateral.methods.addMember(1, owner).send({ from: accounts[0] });
    await collateral.methods.mint(owner, initialUserBalance).send({ from: accounts[0] });
    await collateral.methods.mint(other, initialUserBalance).send({ from: accounts[0] });
    await collateral.methods.mint(disputer, initialUserBalance).send({ from: accounts[0] });
    await collateralWhitelist.methods.addToWhitelist(collateral.options.address).send({ from: accounts[0] });

    // Set up config contract.
    config = await ConfigStore.new(
      {
        timelockLiveness: 86400, // 1 day
        rewardRatePerSecond: { rawValue: rewardRate },
        proposerBondPercentage: { rawValue: bondPercentage },
        maxFundingRate: { rawValue: maxFundingRate },
        minFundingRate: { rawValue: minFundingRate },
        proposalTimePastLimit: proposalTimePastLimit, // 30 mins
      },
      timer.options.address
    ).send({ from: accounts[0] });

    // Set up the funding rate applier.
    fundingRateApplier = await FundingRateApplier.new(
      identifier,
      collateral.options.address,
      finder.options.address,
      config.options.address,
      { rawValue: tokenScaling },
      timer.options.address
    ).send({ from: accounts[0] });

    // Mint the funding rate applier the same number of tokens as the users for ease of math.
    await collateral.methods.mint(fundingRateApplier.options.address, initialUserBalance).send({ from: accounts[0] });

    // Approve the funding rate applier to spend the owner and other's funds.
    await collateral.methods.approve(fundingRateApplier.options.address, toWei("100000000")).send({ from: owner });
    await collateral.methods.approve(fundingRateApplier.options.address, toWei("100000000")).send({ from: other });

    // Approve the optimistic oracle to spend the disputer's funds.
    await collateral.methods.approve(optimisticOracle.options.address, toWei("100000000")).send({ from: disputer });

    startTime = Number(await fundingRateApplier.methods.getCurrentTime().call());
    currentTime = startTime;

    // Expected ancillary data: "tokenAddress:<collateral-token-address>"
    ancillaryData = utf8ToHex(`tokenAddress:${collateral.options.address.substr(2).toLowerCase()}`);
  });

  it("Correctly sets funding rate multiplier", async () => {
    const customTokenScaling = toWei("1000");
    fundingRateApplier = await FundingRateApplier.new(
      identifier,
      collateral.options.address,
      finder.options.address,
      config.options.address,
      { rawValue: customTokenScaling },
      timer.options.address
    ).send({ from: accounts[0] });

    assert.equal(
      (await fundingRateApplier.methods.fundingRate().call()).cumulativeMultiplier.toString(),
      customTokenScaling
    );
  });

  it("Computation of effective funding rate and its effect on the cumulative multiplier is correct", async () => {
    // Funding rate of 0.15% charged over 20 seconds on a starting multiplier of 1:
    // Effective Rate: 0.0015 * 20 = 0.03, funding rate is positive so add 1 => 1.03
    // Cumulative Multiplier: 1 * 1.03 = 1.03
    const test1 = await fundingRateApplier.methods
      .calculateEffectiveFundingRate(20, { rawValue: toWei("0.0015") }, { rawValue: toWei("1") })
      .call();
    assert.equal(test1.rawValue, toWei("1.03"));

    // Previous test but change the starting multiplier to 1.05:
    // Effective Rate: 0.0015 * 20 = 0.03, funding rate is positive so add 1 => 1.03
    // Cumulative Multiplier: 1.05 * 1.03 = 1.0815
    const test2 = await fundingRateApplier.methods
      .calculateEffectiveFundingRate(20, { rawValue: toWei("0.0015") }, { rawValue: toWei("1.05") })
      .call();
    assert.equal(test2.rawValue, toWei("1.0815"));

    // Previous test but change the funding rate to -0.15%:
    // Effective Rate: -0.0015 * 20 = -0.03, funding rate is negative so subtract from 1 => 0.97
    // Cumulative Multiplier: 1.05 * 0.97 = 1.0185
    const test3 = await fundingRateApplier.methods
      .calculateEffectiveFundingRate(20, { rawValue: toWei("-0.0015") }, { rawValue: toWei("1.05") })
      .call();
    assert.equal(test3.rawValue, toWei("1.0185"));

    // Previous test but change the funding rate to 0% meaning that the multiplier shouldn't change:
    // Effective Rate: 0 * 20 = 0, funding rate is neutral so no change to the cumulative multiplier.
    // Cumulative Multiplier: 1.05 * 1 = 1.05
    const test4 = await fundingRateApplier.methods
      .calculateEffectiveFundingRate(20, { rawValue: toWei("0") }, { rawValue: toWei("1.05") })
      .call();
    assert.equal(test4.rawValue, toWei("1.05"));
  });

  it("Initial funding rate struct is correct", async () => {
    const fundingRate = await fundingRateApplier.methods.fundingRate().call();
    assert.equal(fundingRate.rate.toString(), "0");
    assert.equal(hexToUtf8(fundingRate.identifier), hexToUtf8(identifier));
    assert.equal(fundingRate.cumulativeMultiplier.toString(), toWei("1"));
    assert.equal(fundingRate.updateTime.toString(), startTime.toString());
    assert.equal(fundingRate.applicationTime.toString(), startTime.toString());
    assert.equal(fundingRate.proposalTime.toString(), "0");
  });
  it("Calling applyFundingRate without a pending proposal does not change multiplier", async () => {
    await fundingRateApplier.methods.setCurrentTime(startTime + 1000).send({ from: accounts[0] });
    const receipt = await fundingRateApplier.methods.applyFundingRate().send({ from: accounts[0] });
    assert.equal(
      (await fundingRateApplier.methods.fundingRate().call()).cumulativeMultiplier.rawValue.toString(),
      toWei("1")
    );
    assert.equal((await fundingRateApplier.methods.fundingRate().call()).rate.rawValue.toString(), "0");

    // A NewFundingRateMultiplier is emitted.
    await assertEventNotEmitted(receipt, fundingRateApplier, "FundingRateUpdated");
  });

  it("Funding rate proposal must be within limits", async function () {
    // Max/min funding rate per second is [< +1e-5, > -1e-5].
    const currentTime = Number(await fundingRateApplier.methods.getCurrentTime().call());
    assert(
      await didContractThrow(
        fundingRateApplier.methods
          .proposeFundingRate({ rawValue: toWei("0.00002") }, currentTime)
          .send({ from: accounts[0] })
      )
    );
    assert(
      await didContractThrow(
        fundingRateApplier.methods
          .proposeFundingRate({ rawValue: toWei("-0.00002") }, currentTime)
          .send({ from: accounts[0] })
      )
    );
  });

  it("Proposal time checks", async () => {
    const newRate = { rawValue: toWei("-0.000001") };

    // Cannot be at or before the last update time.
    assert(
      await didContractThrow(
        fundingRateApplier.methods.proposeFundingRate(newRate, startTime).send({ from: accounts[0] })
      )
    );

    // Move time forward to give some space for new proposals.
    const currentTime = startTime + delay;
    await fundingRateApplier.methods.setCurrentTime(currentTime).send({ from: accounts[0] });

    // Time must be within the past and future bounds around the current time.
    assert(
      await didContractThrow(
        fundingRateApplier.methods
          .proposeFundingRate(newRate, currentTime - proposalTimePastLimit - 1)
          .send({ from: accounts[0] })
      )
    );
    await fundingRateApplier.methods.proposeFundingRate(newRate, currentTime - proposalTimePastLimit).call();
    assert(
      await didContractThrow(
        fundingRateApplier.methods.proposeFundingRate(newRate, currentTime + 1).send({ from: accounts[0] })
      )
    );
    await fundingRateApplier.methods.proposeFundingRate(newRate, currentTime).send({ from: accounts[0] });
  });

  describe("Undisputed proposal", async () => {
    beforeEach(async () => {
      // Move time forward to give some space for new proposals since the last update time was set to deployment time.
      currentTime = startTime + delay;
      await fundingRateApplier.methods.setCurrentTime(currentTime).send({ from: accounts[0] });

      // First proposal at the current time.
      await fundingRateApplier.methods
        .proposeFundingRate({ rawValue: defaultProposal }, currentTime)
        .send({ from: accounts[0] });
    });

    it("Two proposals cannot coexist", async () => {
      // Proposal should fail because the previous one has not expired.
      assert(
        await didContractThrow(
          fundingRateApplier.methods
            .proposeFundingRate({ rawValue: defaultProposal }, currentTime)
            .send({ from: accounts[0] })
        )
      );

      // Expire the previous proposal allowing a new proposal to succeed.
      currentTime += delay;
      await fundingRateApplier.methods.setCurrentTime(currentTime).send({ from: accounts[0] });
      await fundingRateApplier.methods
        .proposeFundingRate({ rawValue: defaultProposal }, currentTime)
        .send({ from: accounts[0] });
    });

    it("Correctly sets price and updates cumulative multiplier", async () => {
      // Move time forward to expire the proposal.
      currentTime += delay;
      await fundingRateApplier.methods.setCurrentTime(currentTime).send({ from: accounts[0] });

      // Apply the newly expired rate.
      const receipt = await fundingRateApplier.methods.applyFundingRate().send({ from: accounts[0] });
      await assertEventEmitted(receipt, fundingRateApplier, "FundingRateUpdated", (ev) => {
        return (
          ev.newFundingRate.toString() === defaultProposal &&
          ev.updateTime.toString() === (currentTime - delay).toString() && // Update time is equal to the proposal time.
          ev.reward.toString() === toWei("1") // The reward is 1% (10_000 seconds * 0.000001 reward rate / second) of 100 tokens of pfc --> 1 token
        );
      });

      // 1 percent per 100_000 seconds is the default proposal. It has been applied for 10_000 seconds, so we should
      // see a +0.1% change.
      assert.equal(
        (await fundingRateApplier.methods.fundingRate().call()).cumulativeMultiplier.rawValue,
        toWei("1.001")
      );
    });

    it("Pays rewards", async () => {
      // Owner should have already paid 0.01 percent of pfc (0.01 token) to the funding rate store for the
      // proposal bond.
      assert.equal((await collateral.methods.balanceOf(owner).call()).toString(), toWei("99.99"));

      // Funding rate store does not escrow, the optimistic oracle does.
      assert.equal(
        (await collateral.methods.balanceOf(fundingRateApplier.options.address).call()).toString(),
        initialUserBalance
      );
      assert.equal(
        (await collateral.methods.balanceOf(optimisticOracle.options.address).call()).toString(),
        toWei("0.01")
      );

      // Move time forward to expire the proposal.
      currentTime += delay;
      await fundingRateApplier.methods.setCurrentTime(currentTime).send({ from: accounts[0] });

      // Apply the newly expired rate.
      await fundingRateApplier.methods.applyFundingRate().send({ from: accounts[0] });

      // Owner should have their bond back and have received:
      // - a reward of 1% (10_000 seconds * 0.000001 reward rate / second) of 100 tokens of pfc -- 1 token.
      // - their bond back -- 0.01 token.
      // Net 1 token more than their initial balance.
      assert.equal((await collateral.methods.balanceOf(owner).call()).toString(), toWei("101"));
      assert.equal(
        (await collateral.methods.balanceOf(fundingRateApplier.options.address).call()).toString(),
        toWei("99")
      );
    });

    it("Compounding funding rate multiplier", async () => {
      // Move time forward to expire the proposal.
      currentTime += delay;
      await fundingRateApplier.methods.setCurrentTime(currentTime).send({ from: accounts[0] });

      // Apply the newly expired rate.
      await fundingRateApplier.methods.applyFundingRate().send({ from: accounts[0] });
      assert.equal(
        (await fundingRateApplier.methods.fundingRate().call()).cumulativeMultiplier.rawValue,
        toWei("1.001")
      );

      // Move time forward again.
      currentTime += delay;
      await fundingRateApplier.methods.setCurrentTime(currentTime).send({ from: accounts[0] });

      // Apply the rate again.
      await fundingRateApplier.methods.applyFundingRate().send({ from: accounts[0] });
      assert.equal(
        (await fundingRateApplier.methods.fundingRate().call()).cumulativeMultiplier.rawValue,
        toWei("1.002001")
      );

      // Propose a new rate of the negative of the previous proposal
      await fundingRateApplier.methods
        .proposeFundingRate({ rawValue: `-${defaultProposal}` }, currentTime)
        .send({ from: accounts[0] });

      // Move time forward again.
      currentTime += delay;
      await fundingRateApplier.methods.setCurrentTime(currentTime).send({ from: accounts[0] });

      // Apply the rate again.
      await fundingRateApplier.methods.applyFundingRate().send({ from: accounts[0] });
      assert.equal(
        (await fundingRateApplier.methods.fundingRate().call()).cumulativeMultiplier.rawValue,
        toWei("1.000998999")
      );
    });

    it("Oracle is upgraded while the request is still pending", async () => {
      // Register a new optimistic oracle in the finder.
      let optimisticOracleV2 = await OptimisticOracle.new(
        liveness,
        finder.options.address,
        timer.options.address
      ).send({ from: accounts[0] });
      await finder.methods
        .changeImplementationAddress(utf8ToHex(interfaceName.OptimisticOracle), optimisticOracleV2.options.address)
        .send({ from: accounts[0] });

      // propose() should reset the proposal time to 0 via the fees() modifier, and therefore it should be possible
      // to propose a new rate.
      await fundingRateApplier.methods
        .proposeFundingRate({ rawValue: defaultProposal }, currentTime)
        .send({ from: accounts[0] });
      // The funding rate multiplier should be unchanged.
      assert.equal((await fundingRateApplier.methods.fundingRate().call()).cumulativeMultiplier.rawValue, toWei("1"));

      // As long as this new oracle is not upgraded and the proposal has not expired, then propose() should revert.
      assert(
        await didContractThrow(
          fundingRateApplier.methods
            .proposeFundingRate({ rawValue: defaultProposal }, currentTime)
            .send({ from: accounts[0] })
        )
      );
    });
  });

  describe("Disputed proposal", async () => {
    beforeEach(async () => {
      // Move time forward to give some space for new proposals.
      currentTime = startTime + delay;
      await fundingRateApplier.methods.setCurrentTime(currentTime).send({ from: accounts[0] });

      // First proposal at the current time.
      await fundingRateApplier.methods
        .proposeFundingRate({ rawValue: defaultProposal }, currentTime)
        .send({ from: accounts[0] });

      // Dispute proposal
      await optimisticOracle.methods
        .disputePrice(fundingRateApplier.options.address, identifier, currentTime, ancillaryData)
        .send({ from: disputer });
    });

    it("Doesn't pay rewards after resolution", async () => {
      const proposalTime = currentTime;
      // Both participants should have paid out 0.01 token (0.01% of pfc).
      assert.equal((await collateral.methods.balanceOf(owner).call()).toString(), toWei("99.99"));
      assert.equal((await collateral.methods.balanceOf(disputer).call()).toString(), toWei("99.99"));

      // The optimistic oracle should be escrowing all the money minus the burned portion (1/2 of the 0.01 bond), which
      // is paid to the store on dispute.
      assert.equal(
        (await collateral.methods.balanceOf(optimisticOracle.options.address).call()).toString(),
        toWei("0.015")
      );

      // Move time forward to where the proposal would have expired (if not disputed).
      currentTime += delay;
      await fundingRateApplier.methods.setCurrentTime(currentTime).send({ from: accounts[0] });

      // Apply the newly expired rate.
      await fundingRateApplier.methods.applyFundingRate().send({ from: accounts[0] });

      // No rewards should be paid yet since the proposal is yet to be resolved.
      assert.equal((await collateral.methods.balanceOf(owner).call()).toString(), toWei("99.99"));
      assert.equal((await collateral.methods.balanceOf(disputer).call()).toString(), toWei("99.99"));

      // Resolve the dispute.
      await pushPrice(defaultProposal);

      // Settle and apply.
      await optimisticOracle.methods
        .settle(fundingRateApplier.options.address, identifier, proposalTime, ancillaryData)
        .send({ from: accounts[0] });
      await fundingRateApplier.methods.applyFundingRate().send({ from: accounts[0] });

      // Funding rate is not updated because disputed requests do not
      assert.equal((await fundingRateApplier.methods.fundingRate().call()).proposalTime, "0");

      // No net reward is paid out. Half of the disputer's bond is burned to the store.
      assert.equal((await collateral.methods.balanceOf(owner).call()).toString(), toWei("100.005"));
      assert.equal((await collateral.methods.balanceOf(disputer).call()).toString(), toWei("99.99"));
      assert.equal(
        (await collateral.methods.balanceOf(fundingRateApplier.options.address).call()).toString(),
        toWei("100")
      );
    });

    it("Doesn't get applied after resolution", async () => {
      const proposalTime = currentTime;

      // Move time forward to when the proposal would have expired if not disputed.
      currentTime += delay;
      await fundingRateApplier.methods.setCurrentTime(currentTime).send({ from: accounts[0] });

      // Apply the newly expired rate.
      await fundingRateApplier.methods.applyFundingRate().send({ from: accounts[0] });

      // Proposal is no longer tracked.
      assert.equal((await fundingRateApplier.methods.fundingRate().call()).proposalTime, "0");

      // Resolve the dispute.
      await pushPrice(defaultProposal);

      // No auto-expiry.
      await fundingRateApplier.methods.applyFundingRate().send({ from: accounts[0] });

      // Can still settle after applying the funding rate because this rate isn't tracked anymore.
      await optimisticOracle.methods
        .settle(fundingRateApplier.options.address, identifier, proposalTime, ancillaryData)
        .send({ from: accounts[0] });

      // Apply funding rate again for good measure.
      await fundingRateApplier.methods.applyFundingRate().send({ from: accounts[0] });

      // Funding rate is not updated because disputed requests do not update the funding rate in the contract.
      assert.equal((await fundingRateApplier.methods.fundingRate().call()).proposalTime, "0");
    });

    it("Allows new proposals immediately", async () => {
      // Time must move forward so this isn't the _exact_ same proposal as the previous.
      currentTime += 1;
      await fundingRateApplier.methods.setCurrentTime(currentTime).send({ from: accounts[0] });
      await fundingRateApplier.methods
        .proposeFundingRate({ rawValue: defaultProposal }, currentTime)
        .send({ from: accounts[0] });
    });
  });
});

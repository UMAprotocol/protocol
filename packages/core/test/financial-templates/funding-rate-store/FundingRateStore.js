// External libs
const { toWei, utf8ToHex: toHex, toBN, hexToUtf8: toUtf8 } = web3.utils;
const truffleAssert = require("truffle-assertions");

// Local libs
const { didContractThrow, interfaceName, RegistryRolesEnum } = require("@uma/common");
const { assert } = require("chai");

// Tested Contract
const FundingRateStore = artifacts.require("FundingRateStore");

// Helper Contracts
const Timer = artifacts.require("Timer");
const Store = artifacts.require("Store");
const Finder = artifacts.require("Finder");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const MockOracle = artifacts.require("MockOracle");
const ExpandedERC20 = artifacts.require("ExpandedERC20");
const MockPerpetual = artifacts.require("MockPerpetual");
const Registry = artifacts.require("Registry");

// Helper functions.
async function incrementTime(contract, amount) {
  const currentTime = await contract.getCurrentTime();
  await contract.setCurrentTime(Number(currentTime) + amount);
}

contract("FundingRateStore", function(accounts) {
  let timer;
  let store;
  let finder;
  let collateralCurrency;
  let fundingRateStore;
  let mockOracle;
  let identifierWhitelist;
  let mockPerpetual;
  let registry;

  let contractDeployer = accounts[0];
  let proposer = accounts[1];
  let disputer = accounts[2];
  let rando = accounts[3];

  const liveness = 7200;

  const defaultTestIdentifier = toHex("TEST_IDENTIFIER");

  beforeEach(async () => {
    collateralCurrency = await ExpandedERC20.new("Wrapped Ether", "WETH", 18);
    await collateralCurrency.addMember(1, contractDeployer);
    mockPerpetual = await MockPerpetual.new(defaultTestIdentifier, collateralCurrency.address);
    timer = await Timer.deployed();
    store = await Store.deployed();
    finder = await Finder.deployed();
    identifierWhitelist = await IdentifierWhitelist.deployed();
    fundingRateStore = await FundingRateStore.new(liveness, finder.address, timer.address, { rawValue: "0" });

    // Set up Oracle
    mockOracle = await MockOracle.new(finder.address, timer.address, {
      from: contractDeployer
    });
    const mockOracleInterfaceName = toHex(interfaceName.Oracle);
    await finder.changeImplementationAddress(mockOracleInterfaceName, mockOracle.address, {
      from: contractDeployer
    });

    // Set up whitelist
    await identifierWhitelist.addSupportedIdentifier(defaultTestIdentifier);

    // Grant contract deployer Owner and Creator roles in Registry so it can query funding rates and give query
    // privileges to other addresesses.
    registry = await Registry.deployed();
    await registry.addMember(RegistryRolesEnum.CONTRACT_CREATOR, contractDeployer);
    try {
      await registry.registerContract([], contractDeployer);
    } catch (err) {
      // Can only register a contract once, expected error here on duplicate `registerContract` calls.
    }
  });

  it("Liveness check", async function() {
    assert(await didContractThrow(FundingRateStore.new(0, finder.address, timer.address, { rawValue: "0" })));
  });

  it("Initial Funding Rate, Reward Rate 0", async function() {
    assert.equal((await fundingRateStore.getFundingRateForContract(mockPerpetual.address)).rawValue.toString(), "0");
    // Projected reward for any funding rate proposal after any time elapsed should be 0 because the reward rate is 0.
    await incrementTime(fundingRateStore, 100);
    assert.equal(
      (await fundingRateStore.getRewardRateForContract(mockPerpetual.address, { rawValue: toWei("1") })).toString(),
      "0"
    );
  });

  it("Can only query funding rate if caller is registered with DVM", async function() {
    // Deploy a new Registry and swap it out in the Finder so that the contract deployer is no longer "registered".
    let tempRegistry = await Registry.new();
    await finder.changeImplementationAddress(toHex(interfaceName.Registry), tempRegistry.address);

    assert(await didContractThrow(fundingRateStore.getFundingRateForContract(mockPerpetual.address)));

    // Can still read estimated rewards for perpetual.
    await fundingRateStore.getRewardRateForContract(mockPerpetual.address, { rawValue: toWei("1") });

    // Reset finder's Registry pointer.
    await finder.changeImplementationAddress(toHex(interfaceName.Registry), registry.address);
  });

  it("Can only propose funding rates for perpetual contracts with whitelisted funding rate identifiers", async function() {
    await identifierWhitelist.removeSupportedIdentifier(defaultTestIdentifier);

    assert(
      await didContractThrow(
        fundingRateStore.propose(mockPerpetual.address, { rawValue: toWei("0.01") }, { from: proposer })
      )
    );
  });

  describe("Setting reward rates", function() {
    it("Only perpetual can change reward rate", async function() {
      assert(
        await didContractThrow(
          fundingRateStore.setRewardRate(
            mockPerpetual.address,
            { rawValue: toWei("0.0001") },
            { from: contractDeployer }
          )
        )
      );
    });
    it("Reward state is changed and event is emitted", async function() {
      // Using `contractDeployer` as the perpetual address to show that a reward rate can be set for any
      // arbitrary address.
      const txn = await fundingRateStore.setRewardRate(
        contractDeployer,
        { rawValue: toWei("0.0001") },
        { from: contractDeployer }
      );
      truffleAssert.eventEmitted(txn, "ChangedRewardRate", ev => {
        return ev.perpetual === contractDeployer && ev.rewardRate.toString() === toWei("0.0001").toString();
      });
      // Estimated reward for no change to the funding rate and 1 second elapsed is equal to the reward.
      await incrementTime(fundingRateStore, 1);
      assert.equal(
        (await fundingRateStore.getRewardRateForContract(contractDeployer, { rawValue: toWei("0") })).toString(),
        toWei("0.0001")
      );
    });
  });

  describe("Reward computation", function() {
    beforeEach(async function() {
      // Setting reward rate to 1%/second.
      await fundingRateStore.setRewardRate(contractDeployer, { rawValue: toWei("0.01") }, { from: contractDeployer });
    });
    it("Holding rate delta constant, testing time elapsed factor", async function() {
      let result;

      // 3 seconds elapsed = 3% total reward.
      result = await fundingRateStore.calculateProposalRewardPct(
        contractDeployer,
        0,
        3,
        { rawValue: toWei("0") },
        { rawValue: toWei("0") }
      );
      assert.equal(result.toString(), toWei("0.03"));

      // 0 seconds elapsed = 0% total reward.
      result = await fundingRateStore.calculateProposalRewardPct(
        contractDeployer,
        0,
        0,
        { rawValue: toWei("0") },
        { rawValue: toWei("0") }
      );
      assert.equal(result.toString(), "0");

      // 978 seconds elapsed = 978% total reward.
      result = await fundingRateStore.calculateProposalRewardPct(
        contractDeployer,
        0,
        978,
        { rawValue: toWei("0") },
        { rawValue: toWei("0") }
      );
      assert.equal(result.toString(), toWei("9.78"));
    });
    it("Holding time elapsed constant, testing rate delta factor", async function() {
      let result;

      // Current rate is 0, proposed rate is equal to rate change %
      result = await fundingRateStore.calculateProposalRewardPct(
        contractDeployer,
        0,
        1,
        { rawValue: toWei("0.55") },
        { rawValue: toWei("0") }
      );
      // Rate change = 0.55, reward % = 0.01 * (1 + 0.55) = 0.0155
      assert.equal(result.toString(), toWei("0.0155"));
      result = await fundingRateStore.calculateProposalRewardPct(
        contractDeployer,
        0,
        1,
        { rawValue: toWei("-2.33") },
        { rawValue: toWei("0") }
      );
      // Rate change = 2.33, reward % = 0.01 * (1 + 2.33) = 0.0333
      // However, max rate delta factor is 300%, so: reward % = 0.01 * (3) = 0.03
      assert.equal(result.toString(), toWei("0.03"));

      // Current rate is non-0, proposed rate change is equal to % diff from current
      result = await fundingRateStore.calculateProposalRewardPct(
        contractDeployer,
        0,
        1,
        { rawValue: toWei("1.25") },
        { rawValue: toWei("1") }
      );
      // Rate change = 0.25, reward % = 0.01 * (1 + 0.25) = 0.0125
      assert.equal(result.toString(), toWei("0.0125"));
      result = await fundingRateStore.calculateProposalRewardPct(
        contractDeployer,
        0,
        1,
        { rawValue: toWei("0.75") },
        { rawValue: toWei("-1") }
      );
      // Rate change = 1.75, reward % = 0.01 * (1 + 1.75) = 0.0275
      assert.equal(result.toString(), toWei("0.0275"));
      result = await fundingRateStore.calculateProposalRewardPct(
        contractDeployer,
        0,
        1,
        { rawValue: toWei("-1.25") },
        { rawValue: toWei("1") }
      );
      // Rate change = 2.25, reward % = 0.01 * (1 + 2.25) = 0.0325
      // However, max rate delta factor is 300%, so: reward % = 0.01 * (3) = 0.03
      assert.equal(result.toString(), toWei("0.03"));
      result = await fundingRateStore.calculateProposalRewardPct(
        contractDeployer,
        0,
        1,
        { rawValue: toWei("-0.75") },
        { rawValue: toWei("-1") }
      );
      // Rate change = 0.25, reward % = 0.01 * (1 + 0.25) = 0.0125
      assert.equal(result.toString(), toWei("0.0125"));
    });
    it("Tests changing all three factors", async function() {
      let result;

      // Current rate is 2.5%, elapsed time is 2 seconds, rate change % is 20%:
      // (current-rate * elapsed-time * (1+rate-change)) =
      // (0.025 * 2 * (1+0.2)) = 0.06
      await fundingRateStore.setRewardRate(contractDeployer, { rawValue: toWei("0.025") }, { from: contractDeployer });
      result = await fundingRateStore.calculateProposalRewardPct(
        contractDeployer,
        0,
        2,
        { rawValue: toWei("-0.4") },
        { rawValue: toWei("-0.5") }
      );
      assert.equal(result.toString(), toWei("0.06"));
    });
  });

  describe("Payouts: set reward rate and proposal bond to non-0", function() {
    const startingPfC = toWei("1000");
    beforeEach(async () => {
      // Set a nonzero final fee.
      await store.setFinalFee(collateralCurrency.address, { rawValue: toWei("0.25") });

      // Set non-zero proposal bond and reward rates.
      fundingRateStore = await FundingRateStore.new(liveness, finder.address, timer.address, {
        rawValue: toWei("0.0005")
      });
      await mockPerpetual.setRewardRate({ rawValue: toWei("0.01") }, fundingRateStore.address);

      // Mint the MockPerpetual some collateral so that it has "PfC" from which to pay proposer rewards
      await collateralCurrency.mint(mockPerpetual.address, startingPfC);
      assert.equal((await mockPerpetual.pfc()).toString(), startingPfC);

      // Advance time 5 seconds into future, so reward % should be 5%, not including the rate-change effector.
      await incrementTime(fundingRateStore, 5);

      // Mint collateral for proposal + final fee bond to proposer and disputer.
      await collateralCurrency.mint(proposer, toWei("1000"));
      await collateralCurrency.increaseAllowance(fundingRateStore.address, toWei("1000"), { from: proposer });
      await collateralCurrency.mint(disputer, toWei("1000"));
      await collateralCurrency.increaseAllowance(fundingRateStore.address, toWei("1000"), { from: disputer });
    });

    it("Proposal bond % is set", async function() {
      assert.equal((await fundingRateStore.proposalBondPct()).toString(), toWei("0.0005"));
    });

    it("Proposing a funding rate saves reward % and pays bonds", async function() {
      const proposalTime = await fundingRateStore.getCurrentTime();
      const preBalance = await collateralCurrency.balanceOf(proposer);
      const txn = await fundingRateStore.propose(
        mockPerpetual.address,
        { rawValue: toWei("0.01") },
        { from: proposer }
      );
      const postBalance = await collateralCurrency.balanceOf(proposer);
      // Proposal bond is (0.0005 * 1000) and final fee is 0.25.
      assert.equal(preBalance.sub(postBalance).toString(), toWei("0.75"));

      // Projected reward calculation is correct.
      assert.equal(
        await fundingRateStore.getRewardRateForContract(mockPerpetual.address, { rawValue: toWei("0.01") }),
        toWei("0.0505")
      );

      // Expected reward rate is 1% * 5 seconds * 1.01 because the proposed rate is 0.01 and the current rate is 0.
      // Reward rate = 0.01 * 5 * 1.01 = 0.0505
      // Proposal bond = 0.0005 * 1000 = 0.5
      truffleAssert.eventEmitted(txn, "ProposedRate", ev => {
        return (
          ev.perpetual === mockPerpetual.address &&
          ev.rate.toString() === toWei("0.01").toString() &&
          ev.proposalTime.toString() === proposalTime.toString() &&
          ev.proposer === proposer &&
          ev.rewardPct.toString() === toWei("0.0505") &&
          ev.proposalBond.toString() === toWei("0.5") &&
          ev.finalFeeBond.toString() === toWei("0.25")
        );
      });
    });

    it("Proposal expires, someone withdraws rewards, reward is pulled from perpetual and transferred to proposer", async function() {
      const proposalTime = await fundingRateStore.getCurrentTime();
      await fundingRateStore.propose(mockPerpetual.address, { rawValue: toWei("0.01") }, { from: proposer });
      await incrementTime(fundingRateStore, liveness);

      const preBalanceStore = await collateralCurrency.balanceOf(fundingRateStore.address);
      const preBalanceProposer = await collateralCurrency.balanceOf(proposer);
      const preBalancePerpetual = await collateralCurrency.balanceOf(mockPerpetual.address);
      const txn = await fundingRateStore.withdrawProposalRewards(mockPerpetual.address);
      const postBalanceStore = await collateralCurrency.balanceOf(fundingRateStore.address);
      const postBalanceProposer = await collateralCurrency.balanceOf(proposer);
      const postBalancePerpetual = await collateralCurrency.balanceOf(mockPerpetual.address);

      // Reward = 0.0505 * 1000 = 50.5
      // Total payment = reward + final fee bond of 0.25 + proposal bond of 0.5 = 51.25
      truffleAssert.eventEmitted(txn, "PublishedRate", ev => {
        return (
          ev.perpetual === mockPerpetual.address &&
          ev.rate.toString() === toWei("0.01").toString() &&
          ev.proposalTime.toString() === proposalTime.toString() &&
          ev.proposer === proposer &&
          ev.rewardPct.toString() === toWei("0.0505") &&
          ev.rewardPayment.toString() === toWei("50.5") &&
          ev.totalPayment.toString() === toWei("51.25")
        );
      });

      // Proposer receives reward (50.5) + final fee bond (0.25) + proposal bond (0.5)
      assert.equal(postBalanceProposer.sub(preBalanceProposer).toString(), toWei("51.25"));
      // Perpetual pays reward (50.5)
      assert.equal(preBalancePerpetual.sub(postBalancePerpetual).toString(), toWei("50.5"));
      // Store pays final fee rebate (0.25) + proposal rebate (0.5)
      assert.equal(preBalanceStore.sub(postBalanceStore).toString(), toWei("0.75"));
    });

    it("Proposal is disputed, the dispute FAILS, proposer receives disputer's bond", async function() {
      const preBalanceStore = await collateralCurrency.balanceOf(fundingRateStore.address);
      const preBalancePerpetual = await collateralCurrency.balanceOf(mockPerpetual.address);
      const proposalTime = await fundingRateStore.getCurrentTime();
      await fundingRateStore.propose(mockPerpetual.address, { rawValue: toWei("0.01") }, { from: proposer });

      // Dispute and settle dispute as failed.
      const disputePrice = toWei("0.01");
      let preBalanceDisputer = await collateralCurrency.balanceOf(disputer);
      const disputeTxn = await fundingRateStore.dispute(mockPerpetual.address, { from: disputer });
      let postBalanceDisputer = await collateralCurrency.balanceOf(disputer);
      // Total bond is 0.5 (proposal bond) + 0.25 (final fee bond)
      assert.equal(preBalanceDisputer.sub(postBalanceDisputer).toString(), toWei("0.75"));
      truffleAssert.eventEmitted(disputeTxn, "DisputedRate", ev => {
        return (
          ev.perpetual === mockPerpetual.address &&
          ev.rate.toString() === toWei("0.01").toString() &&
          ev.proposalTime.toString() === proposalTime.toString() &&
          ev.disputer === disputer &&
          ev.disputeBond.toString() === toWei("0.5") &&
          ev.finalFeeBond.toString() === toWei("0.25")
        );
      });
      await mockOracle.pushPrice(defaultTestIdentifier, proposalTime, disputePrice.toString());

      // Proposer receives disputer's bond + their original bond: 0.5 + 0.5 + 0.25
      const preBalanceProposer = await collateralCurrency.balanceOf(proposer);
      preBalanceDisputer = await collateralCurrency.balanceOf(disputer);
      await fundingRateStore.settleDispute(mockPerpetual.address, proposalTime, {
        from: disputer
      });
      const postBalanceProposer = await collateralCurrency.balanceOf(proposer);
      const postBalanceStore = await collateralCurrency.balanceOf(fundingRateStore.address);
      const postBalancePerpetual = await collateralCurrency.balanceOf(mockPerpetual.address);
      postBalanceDisputer = await collateralCurrency.balanceOf(disputer);

      // Proposer gets disputer's bond.
      assert.equal(postBalanceProposer.sub(preBalanceProposer).toString(), toWei("1.25"));
      assert.equal(postBalanceDisputer.sub(preBalanceDisputer).toString(), "0");

      // Store and Perpetual balance does not change post propose-dispute process
      assert.equal(postBalanceStore.toString(), preBalanceStore.toString());
      assert.equal(postBalancePerpetual.toString(), preBalancePerpetual.toString());
    });

    it("Proposal is disputed, the dispute SUCCEEDS, disputer receives proposer's bond", async function() {
      const preBalanceStore = await collateralCurrency.balanceOf(fundingRateStore.address);
      const preBalancePerpetual = await collateralCurrency.balanceOf(mockPerpetual.address);
      const proposalTime = await fundingRateStore.getCurrentTime();
      await fundingRateStore.propose(mockPerpetual.address, { rawValue: toWei("0.01") }, { from: proposer });

      // Dispute and settle dispute as successful.
      const disputePrice = toWei("0.02");
      let preBalanceDisputer = await collateralCurrency.balanceOf(disputer);
      const disputeTxn = await fundingRateStore.dispute(mockPerpetual.address, { from: disputer });
      let postBalanceDisputer = await collateralCurrency.balanceOf(disputer);
      // Total bond is 0.5 (proposal bond) + 0.25 (final fee bond)
      assert.equal(preBalanceDisputer.sub(postBalanceDisputer).toString(), toWei("0.75"));
      truffleAssert.eventEmitted(disputeTxn, "DisputedRate", ev => {
        return (
          ev.perpetual === mockPerpetual.address &&
          ev.rate.toString() === toWei("0.01").toString() &&
          ev.proposalTime.toString() === proposalTime.toString() &&
          ev.disputer === disputer &&
          ev.disputeBond.toString() === toWei("0.5") &&
          ev.finalFeeBond.toString() === toWei("0.25")
        );
      });
      await mockOracle.pushPrice(defaultTestIdentifier, proposalTime, disputePrice.toString());

      // Proposer receives disputer's bond + their original bond: 0.5 + 0.5 + 0.25
      const preBalanceProposer = await collateralCurrency.balanceOf(proposer);
      preBalanceDisputer = await collateralCurrency.balanceOf(disputer);
      await fundingRateStore.settleDispute(mockPerpetual.address, proposalTime, {
        from: disputer
      });
      const postBalanceProposer = await collateralCurrency.balanceOf(proposer);
      const postBalanceStore = await collateralCurrency.balanceOf(fundingRateStore.address);
      const postBalancePerpetual = await collateralCurrency.balanceOf(mockPerpetual.address);
      postBalanceDisputer = await collateralCurrency.balanceOf(disputer);

      // Disputer gets proposer's bond.
      assert.equal(postBalanceProposer.sub(preBalanceProposer).toString(), "0");
      assert.equal(postBalanceDisputer.sub(preBalanceDisputer).toString(), toWei("1.25"));

      // Store and Perpetual balance does not change post propose-dispute process
      assert.equal(postBalanceStore.toString(), preBalanceStore.toString());
      assert.equal(postBalancePerpetual.toString(), preBalancePerpetual.toString());
    });
  });

  describe("Withdrawing funding rate fees from Perpetual fails", function() {
    let proposalTime;
    // In these tests, we'll construct a mock perpetual that always reverts whenever withdrawFundingRateFees is called,
    // and we want to test that the Funding Rate Store does not subsequently revert.
    beforeEach(async () => {
      // Set a nonzero final fee.
      await store.setFinalFee(collateralCurrency.address, { rawValue: toWei("0.25") });

      // Set mock perpetual so that `withdrawFundingRateFees` always reverts.
      await mockPerpetual.toggleRevertWithdraw();
      assert.equal(await mockPerpetual.revertWithdraw(), true);

      // Set non-zero proposal bond and reward rates.
      fundingRateStore = await FundingRateStore.new(liveness, finder.address, timer.address, {
        rawValue: toWei("0.0005")
      });
      await mockPerpetual.setRewardRate({ rawValue: toWei("0.01") }, fundingRateStore.address);

      // Mint the MockPerpetual some collateral so that it has "PfC" from which to pay proposer rewards
      await collateralCurrency.mint(mockPerpetual.address, toWei("1000"));
      assert.equal((await mockPerpetual.pfc()).toString(), toWei("1000"));

      // Mint collateral for proposal and final fee bond to proposer and disputer.
      await collateralCurrency.mint(proposer, toWei("1000"));
      await collateralCurrency.increaseAllowance(fundingRateStore.address, toWei("1000"), { from: proposer });
      await collateralCurrency.mint(disputer, toWei("1000"));
      await collateralCurrency.increaseAllowance(fundingRateStore.address, toWei("1000"), { from: disputer });

      // Advance time 5 seconds into future, so reward % should be 5%, not including the rate-change effector.
      await incrementTime(fundingRateStore, 5);

      // Propose a funding rate
      proposalTime = await fundingRateStore.getCurrentTime();
      await fundingRateStore.propose(mockPerpetual.address, { rawValue: toWei("0.01") }, { from: proposer });
      await incrementTime(fundingRateStore, liveness);
    });
    it("withdrawProposalRewards does not fail", async function() {
      const preBalanceStore = await collateralCurrency.balanceOf(fundingRateStore.address);
      const preBalanceProposer = await collateralCurrency.balanceOf(proposer);
      const preBalancePerpetual = await collateralCurrency.balanceOf(mockPerpetual.address);
      const txn = await fundingRateStore.withdrawProposalRewards(mockPerpetual.address);
      const postBalanceStore = await collateralCurrency.balanceOf(fundingRateStore.address);
      const postBalanceProposer = await collateralCurrency.balanceOf(proposer);
      const postBalancePerpetual = await collateralCurrency.balanceOf(mockPerpetual.address);

      // Reward rate is 0.0505, but reward amount is 0 because withdrawal failed.
      // Final fee (0.25) and proposal bond (0.5) are still returned.
      truffleAssert.eventEmitted(txn, "PublishedRate", ev => {
        return (
          ev.perpetual === mockPerpetual.address &&
          ev.rate.toString() === toWei("0.01").toString() &&
          ev.proposalTime.toString() === proposalTime.toString() &&
          ev.proposer === proposer &&
          ev.rewardPct.toString() === toWei("0.0505") &&
          ev.rewardPayment.toString() === "0" &&
          ev.totalPayment.toString() === toWei("0.75")
        );
      });

      // Proposer receives reward (0) + final fee bond (0.25) + proposal bond (0.5)
      assert.equal(postBalanceProposer.sub(preBalanceProposer).toString(), toWei("0.75"));
      // Perpetual pays 0
      assert.equal(preBalancePerpetual.toString(), postBalancePerpetual.toString());
      // Store pays final fee rebate (0.25) + proposal rebate (0.5)
      assert.equal(preBalanceStore.sub(postBalanceStore).toString(), toWei("0.75"));

      // WithdrawErrorIgnored event is emitted with a withdraw amount equal to the amount of fees that the Store
      // attempted to pull from the Perpetual => 0.0505 * 1000 = 50.5
      truffleAssert.eventEmitted(txn, "WithdrawErrorIgnored", ev => {
        return ev.perpetual === mockPerpetual.address && ev.withdrawAmount.toString() === toWei("50.5").toString();
      });
    });
  });

  describe("Unexpired Proposal", function() {
    let proposalTxn, proposalTime;
    beforeEach(async () => {
      proposalTime = await fundingRateStore.getCurrentTime();
      proposalTxn = await fundingRateStore.propose(
        mockPerpetual.address,
        { rawValue: toWei("0.01") },
        { from: proposer }
      );
      await incrementTime(fundingRateStore, liveness - 1);
    });

    it("Initial rate persists", async function() {
      // Publish any pending expired proposals.
      await fundingRateStore.withdrawProposalRewards(mockPerpetual.address);

      assert.equal((await fundingRateStore.getFundingRateForContract(mockPerpetual.address)).rawValue.toString(), "0");
    });

    it("Event emitted", async function() {
      truffleAssert.eventEmitted(proposalTxn, "ProposedRate", ev => {
        return (
          ev.perpetual === mockPerpetual.address &&
          ev.rate.toString() === toWei("0.01").toString() &&
          ev.proposalTime.toString() === proposalTime.toString() &&
          ev.proposer === proposer &&
          ev.rewardPct.toString() === "0" &&
          ev.proposalBond.toString() === "0" &&
          ev.finalFeeBond.toString() === "0"
        );
      });
    });

    it("Proposer pays final fee bond", async function() {
      // Set a nonzero final fee.
      const finalFeeAmount = toWei("1");
      await store.setFinalFee(collateralCurrency.address, { rawValue: finalFeeAmount.toString() });

      // Advance to liveness so we can propose a new rate.
      await incrementTime(fundingRateStore, 1);

      // No balance.
      assert(
        await didContractThrow(
          fundingRateStore.propose(mockPerpetual.address, { rawValue: toWei("-0.01") }, { from: proposer })
        )
      );

      // No allowance
      await collateralCurrency.mint(proposer, finalFeeAmount);
      assert(
        await didContractThrow(
          fundingRateStore.propose(mockPerpetual.address, { rawValue: toWei("-0.01") }, { from: proposer })
        )
      );

      // Allowance and balance OK.
      await collateralCurrency.increaseAllowance(fundingRateStore.address, finalFeeAmount, { from: proposer });
      const preBalance = await collateralCurrency.balanceOf(proposer);
      await fundingRateStore.propose(mockPerpetual.address, { rawValue: toWei("-0.01") }, { from: proposer });
      const postBalance = await collateralCurrency.balanceOf(proposer);
      assert.equal(finalFeeAmount.toString(), toBN(preBalance).sub(toBN(postBalance)));

      // Once proposal expires, proposer receives a final fee rebate.
      await incrementTime(fundingRateStore, liveness);
      await collateralCurrency.mint(rando, finalFeeAmount);
      await collateralCurrency.increaseAllowance(fundingRateStore.address, finalFeeAmount, { from: rando });
      await fundingRateStore.withdrawProposalRewards(mockPerpetual.address, { from: rando });
      const postExpiryBalance = await collateralCurrency.balanceOf(proposer);
      assert.equal(finalFeeAmount.toString(), toBN(postExpiryBalance).sub(toBN(postBalance)));
    });

    it("New proposal not allowed", async function() {
      assert(
        await didContractThrow(
          fundingRateStore.propose(mockPerpetual.address, { rawValue: toWei("0.01") }, { from: proposer })
        )
      );
    });
  });

  describe("Disputed Proposal", function() {
    let proposalTime;
    const finalFeeAmount = toWei("1");
    beforeEach(async () => {
      // Set a nonzero final fee.
      await store.setFinalFee(collateralCurrency.address, { rawValue: finalFeeAmount.toString() });

      // Mint proposer enough collateral to cover final fee.
      await collateralCurrency.mint(proposer, toWei("100"));
      await collateralCurrency.increaseAllowance(fundingRateStore.address, toWei("100"), { from: proposer });

      // Propose new funding rate
      proposalTime = await fundingRateStore.getCurrentTime();
      await fundingRateStore.propose(mockPerpetual.address, { rawValue: toWei("0.01") }, { from: proposer });
      await incrementTime(fundingRateStore, liveness - 1);

      // Mint disputer collateral to cover final fee bond as well.
      await collateralCurrency.mint(disputer, toWei("100"));
      await collateralCurrency.increaseAllowance(fundingRateStore.address, toWei("100"), { from: disputer });
    });

    it("Cannot propose for an (perpetual+time) that is currently pending dispute", async function() {
      // Expire the previous proposal.
      await incrementTime(fundingRateStore, 1);

      // Propose, dispute, and propose another funding rate all within the same block. On a production network
      // these actions would have to be called atomically within a single smart contract transaction.
      await fundingRateStore.propose(mockPerpetual.address, { rawValue: toWei("0.05") }, { from: proposer });
      await fundingRateStore.dispute(mockPerpetual.address, { from: disputer });
      assert(
        await didContractThrow(
          fundingRateStore.propose(mockPerpetual.address, { rawValue: toWei("-0.05") }, { from: proposer })
        )
      );
    });

    it("Disputing unexpired proposal", async function() {
      // Can't dispute if proposal is not yet pending
      assert(await didContractThrow(fundingRateStore.dispute(disputer, { from: disputer })));

      // Disputer who has no balance or allowance to pay final fee cannot dispute.
      assert(await didContractThrow(fundingRateStore.dispute(mockPerpetual.address, { from: rando })));
      await collateralCurrency.mint(rando, finalFeeAmount);
      assert(await didContractThrow(fundingRateStore.dispute(mockPerpetual.address, { from: rando })));

      // Disputer must stake a final fee bond.
      const preBalance = await collateralCurrency.balanceOf(disputer);
      const disputeTxn = await fundingRateStore.dispute(mockPerpetual.address, { from: disputer });
      const postBalance = await collateralCurrency.balanceOf(disputer);
      assert.equal(finalFeeAmount.toString(), toBN(preBalance).sub(toBN(postBalance)));

      // Can't dispute again because now there is no pending proposal.
      assert(await didContractThrow(fundingRateStore.dispute(mockPerpetual.address, { from: disputer })));

      // Price request is enqueued.
      const pendingRequests = await mockOracle.getPendingQueries();
      assert.equal(toUtf8(pendingRequests[0].identifier), toUtf8(defaultTestIdentifier));
      assert.equal(pendingRequests[0].time, proposalTime);

      // Final Fee event was emitted.
      truffleAssert.eventEmitted(disputeTxn, "FinalFeesPaid", ev => {
        return ev.collateralCurrency === collateralCurrency.address && ev.amount.toString() === finalFeeAmount;
      });

      // Dispute event was emitted.
      truffleAssert.eventEmitted(disputeTxn, "DisputedRate", ev => {
        return (
          ev.perpetual === mockPerpetual.address &&
          ev.rate.toString() === toWei("0.01").toString() &&
          ev.proposalTime.toString() === proposalTime.toString() &&
          ev.disputeBond.toString() === "0" &&
          ev.proposer === proposer &&
          ev.disputer === disputer &&
          ev.finalFeeBond.toString() === finalFeeAmount
        );
      });

      // Can propose another proposal.
      await fundingRateStore.propose(mockPerpetual.address, { rawValue: toWei("0.01") }, { from: proposer });
      // Now you can dispute because there is again a pending proposal
      await fundingRateStore.dispute(mockPerpetual.address, { from: disputer });
    });

    it("Settling FAILED disputed proposal", async function() {
      const disputePrice = toWei("0.01");
      await fundingRateStore.dispute(mockPerpetual.address, { from: disputer });
      await fundingRateStore.propose(mockPerpetual.address, { rawValue: toWei("-0.01") }, { from: proposer });

      // Reverts if price has not resolved yet.
      assert(
        await didContractThrow(fundingRateStore.settleDispute(mockPerpetual.address, proposalTime, { from: disputer }))
      );
      await mockOracle.pushPrice(defaultTestIdentifier, proposalTime, disputePrice.toString());

      // Reverts if identifier+time combo does not corresponding to a price requeust.
      assert(await didContractThrow(fundingRateStore.settleDispute(disputer, proposalTime, { from: disputer })));
      assert(await didContractThrow(fundingRateStore.settleDispute(mockPerpetual.address, 123, { from: disputer })));

      const preBalanceDisputer = await collateralCurrency.balanceOf(disputer);
      const preBalanceProposer = await collateralCurrency.balanceOf(proposer);
      const settlementTxn = await fundingRateStore.settleDispute(mockPerpetual.address, proposalTime, {
        from: disputer
      });

      // Reverts if dispute is already settled.
      assert(
        await didContractThrow(fundingRateStore.settleDispute(mockPerpetual.address, proposalTime, { from: disputer }))
      );

      // Settled Dispute event was emitted.
      truffleAssert.eventEmitted(settlementTxn, "DisputedRateSettled", ev => {
        return (
          ev.perpetual === mockPerpetual.address &&
          ev.proposalTime.toString() === proposalTime.toString() &&
          ev.proposer === proposer &&
          ev.disputer === disputer &&
          !ev.disputeSucceeded
        );
      });

      // Publish event was emitted, but no proposal rewards are paid during the settleDispute transaction.
      truffleAssert.eventEmitted(settlementTxn, "PublishedRate", ev => {
        return (
          ev.perpetual === mockPerpetual.address &&
          ev.rate.toString() === toWei("0.01").toString() &&
          ev.proposalTime.toString() === proposalTime.toString() &&
          ev.proposer === proposer && // For a FAILED dispute, the proposer in this event is credited to the proposer
          ev.rewardPct.toString() === "0" &&
          ev.rewardPayment.toString() === "0" &&
          ev.totalPayment.toString() === "0"
        );
      });

      // Funding rate is updated.
      assert.equal(
        (await fundingRateStore.getFundingRateForContract(mockPerpetual.address)).rawValue.toString(),
        toWei("0.01")
      );

      // Proposer receives final fee rebate, disputer receives nothing.
      const postBalanceDisputer = await collateralCurrency.balanceOf(disputer);
      const postBalanceProposer = await collateralCurrency.balanceOf(proposer);
      assert.equal(finalFeeAmount.toString(), toBN(postBalanceProposer).sub(toBN(preBalanceProposer)));
      assert.equal("0", toBN(postBalanceDisputer).sub(toBN(preBalanceDisputer)));
    });

    it("Settling SUCCESSFUL disputed proposal", async function() {
      const disputePrice = toWei("-0.01");
      await fundingRateStore.dispute(mockPerpetual.address, { from: disputer });

      await mockOracle.pushPrice(defaultTestIdentifier, proposalTime, disputePrice.toString());

      const preBalanceDisputer = await collateralCurrency.balanceOf(disputer);
      const preBalanceProposer = await collateralCurrency.balanceOf(proposer);
      const settlementTxn = await fundingRateStore.settleDispute(mockPerpetual.address, proposalTime, {
        from: disputer
      });

      // Settled Dispute event was emitted.
      truffleAssert.eventEmitted(settlementTxn, "DisputedRateSettled", ev => {
        return (
          ev.perpetual === mockPerpetual.address &&
          ev.proposalTime.toString() === proposalTime.toString() &&
          ev.proposer === proposer &&
          ev.disputer === disputer &&
          ev.disputeSucceeded
        );
      });

      // Publish event was emitted, but no proposal rewards are paid during the settleDispute transaction.
      truffleAssert.eventEmitted(settlementTxn, "PublishedRate", ev => {
        return (
          ev.perpetual === mockPerpetual.address &&
          ev.rate.toString() === toWei("-0.01").toString() &&
          ev.proposalTime.toString() === proposalTime.toString() &&
          ev.proposer === disputer && // For a SUCCESSFUL dispute, the proposer in this event is credited to the disputer
          ev.rewardPct.toString() === "0" &&
          ev.rewardPayment.toString() === "0" &&
          ev.totalPayment.toString() === "0"
        );
      });

      // Funding rate is updated.
      assert.equal(
        (await fundingRateStore.getFundingRateForContract(mockPerpetual.address)).rawValue.toString(),
        toWei("-0.01")
      );

      // Disputer receives final fee rebate, proposer receives nothing.
      const postBalanceDisputer = await collateralCurrency.balanceOf(disputer);
      const postBalanceProposer = await collateralCurrency.balanceOf(proposer);
      assert.equal(finalFeeAmount.toString(), toBN(postBalanceDisputer).sub(toBN(preBalanceDisputer)));
      assert.equal("0", toBN(postBalanceProposer).sub(toBN(preBalanceProposer)));
    });

    it("Publishes a funding rate via a settlement only if a proposal has not expired during the dispute", async function() {
      const disputePrice = toWei("-0.01");
      await fundingRateStore.dispute(mockPerpetual.address, { from: disputer });

      // While the funding rate is undergoing a dispute, propose, expire, and publish another funding rate.
      // We want to test that settleDispute will not emit a PublishedRate event once it resolves the dispute,
      // because another funding rate proposal was published mid-dispute.
      await collateralCurrency.mint(rando, toWei("100"));
      await collateralCurrency.increaseAllowance(fundingRateStore.address, toWei("100"), { from: rando });
      await fundingRateStore.propose(mockPerpetual.address, { rawValue: toWei("0.02") }, { from: rando });
      await incrementTime(fundingRateStore, liveness);
      await fundingRateStore.withdrawProposalRewards(mockPerpetual.address);

      // The funding rate should be updated now.
      assert.equal(
        (await fundingRateStore.getFundingRateForContract(mockPerpetual.address)).rawValue.toString(),
        toWei("0.02")
      );

      // Now make a price available for the dispute.
      await mockOracle.pushPrice(defaultTestIdentifier, proposalTime, disputePrice.toString());

      // Settling the dispute (as FAILED) should still pay rewards normally, but the funding rate should first have
      // been updated to the `midDisputeProposal` rate and therefore should not publish the resolved dispute rate.
      const preBalanceDisputer = await collateralCurrency.balanceOf(disputer);
      const preBalanceProposer = await collateralCurrency.balanceOf(proposer);
      const settlementTxn = await fundingRateStore.settleDispute(mockPerpetual.address, proposalTime, {
        from: disputer
      });

      // Publish event was not emitted via settleDispute.
      truffleAssert.eventNotEmitted(settlementTxn, "PublishedRate");

      // Funding rate is linked to the proposal that expired in the middle of the dispute.
      assert.equal(
        (await fundingRateStore.getFundingRateForContract(mockPerpetual.address)).rawValue.toString(),
        toWei("0.02")
      );

      // Disputer receives final fee rebate, proposer receives nothing.
      const postBalanceDisputer = await collateralCurrency.balanceOf(disputer);
      const postBalanceProposer = await collateralCurrency.balanceOf(proposer);
      assert.equal(finalFeeAmount.toString(), toBN(postBalanceDisputer).sub(toBN(preBalanceDisputer)));
      assert.equal("0", toBN(postBalanceProposer).sub(toBN(preBalanceProposer)));
    });

    it("Cannot dispute expired proposal", async function() {
      await incrementTime(fundingRateStore, 1);
      assert(await didContractThrow(fundingRateStore.dispute(mockPerpetual.address, { from: disputer })));
    });
  });

  describe("Expired Proposal", function() {
    let proposeTime;
    beforeEach(async () => {
      proposeTime = toBN(await fundingRateStore.getCurrentTime());
      await fundingRateStore.propose(mockPerpetual.address, { rawValue: toWei("0.01") }, { from: proposer });
      await incrementTime(fundingRateStore, liveness);
    });

    it("withdrawProposalRewards publishes the pending proposal", async function() {
      // Publishes any pending expired proposals.
      const txn = await fundingRateStore.withdrawProposalRewards(mockPerpetual.address);

      assert.equal(
        (await fundingRateStore.getFundingRateForContract(mockPerpetual.address)).rawValue.toString(),
        toWei("0.01")
      );

      truffleAssert.eventEmitted(txn, "PublishedRate", ev => {
        return (
          ev.perpetual === mockPerpetual.address &&
          ev.rate.toString() === toWei("0.01").toString() &&
          ev.proposalTime.toString() === proposeTime.toString() &&
          ev.proposer === proposer &&
          ev.rewardPct.toString() === "0" &&
          ev.rewardPayment.toString() === "0" &&
          ev.totalPayment.toString() === "0"
        );
      });
    });

    it("proposing a new rate publishes the pending proposal", async function() {
      // Cannot propose same rate as current rate.
      assert(
        await didContractThrow(
          fundingRateStore.propose(mockPerpetual.address, { rawValue: toWei("0.01") }, { from: proposer })
        )
      );

      // Publishes any pending expired proposals.
      const txn = await fundingRateStore.propose(
        mockPerpetual.address,
        { rawValue: toWei("-0.01") },
        { from: proposer }
      );

      assert.equal(
        (await fundingRateStore.getFundingRateForContract(mockPerpetual.address)).rawValue.toString(),
        toWei("0.01")
      );

      // Propose txn should also have published the expired proposal.
      truffleAssert.eventEmitted(txn, "PublishedRate", ev => {
        return (
          ev.perpetual === mockPerpetual.address &&
          ev.rate.toString() === toWei("0.01").toString() &&
          ev.proposalTime.toString() === proposeTime.toString() &&
          ev.proposer === proposer &&
          ev.rewardPct.toString() === "0" &&
          ev.rewardPayment.toString() === "0" &&
          ev.totalPayment.toString() === "0"
        );
      });
    });
  });
});

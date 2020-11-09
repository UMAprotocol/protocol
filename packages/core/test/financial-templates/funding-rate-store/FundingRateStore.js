// External libs
const { toWei, utf8ToHex: toHex, toBN, hexToUtf8: toUtf8 } = web3.utils;
const truffleAssert = require("truffle-assertions");

// Local libs
const { didContractThrow, interfaceName, ZERO_ADDRESS } = require("@uma/common");
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

// Helper functions.
async function incrementTime(contract, amount) {
  const currentTime = await contract.getCurrentTime();
  await contract.setCurrentTime(Number(currentTime) + amount);
}

function isEmptyProposalStruct(proposalStruct) {
  assert.equal(proposalStruct.rate, "0");
  assert.equal(proposalStruct.time, "0");
  assert.equal(proposalStruct.proposer, ZERO_ADDRESS);
  assert.equal(proposalStruct.disputer, ZERO_ADDRESS);
  assert.equal(proposalStruct.finalFee, "0");
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

  let contractDeployer = accounts[0];
  let proposer = accounts[1];
  let disputer = accounts[2];
  let rando = accounts[3];

  const liveness = 7200;

  const defaultTestIdentifier = toHex("TEST-IDENTIFIER");

  beforeEach(async () => {
    collateralCurrency = await ExpandedERC20.new("USDC", "USDC", 18);
    await collateralCurrency.addMember(1, contractDeployer);
    mockPerpetual = await MockPerpetual.new(defaultTestIdentifier, collateralCurrency.address);
    timer = await Timer.deployed();
    store = await Store.deployed();
    finder = await Finder.deployed();
    identifierWhitelist = await IdentifierWhitelist.deployed();
    fundingRateStore = await FundingRateStore.new(
      { rawValue: "0" },
      { rawValue: "0" },
      liveness,
      finder.address,
      timer.address
    );

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
  });

  it("Liveness check", async function() {
    assert(
      await didContractThrow(
        FundingRateStore.new({ rawValue: "0" }, { rawValue: "0" }, 0, finder.address, timer.address)
      )
    );
  });

  it("Initial Funding Rate and Propose Time of 0", async function() {
    assert.equal((await fundingRateStore.getFundingRateForContract(mockPerpetual.address)).rawValue.toString(), "0");
    assert.equal((await fundingRateStore.getFundingRateForContract(mockPerpetual.address)).toString(), "0");
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

    it("Initial rate and propose time persists", async function() {
      assert.equal((await fundingRateStore.getFundingRateForContract(mockPerpetual.address)).rawValue.toString(), "0");
      assert.equal((await fundingRateStore.getFundingRateForContract(mockPerpetual.address)).toString(), "0");
    });

    it("Event emitted", async function() {
      truffleAssert.eventEmitted(proposalTxn, "ProposedRate", ev => {
        return (
          ev.perpetual === mockPerpetual.address &&
          ev.rate.toString() === toWei("0.01").toString() &&
          ev.proposalTime.toString() === proposalTime.toString() &&
          ev.proposer === proposer
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
      await fundingRateStore.propose(mockPerpetual.address, { rawValue: toWei("0.01") }, { from: rando });
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

      // Pending proposal is deleted, disputed proposal record is created.
      const pendingProposal = await fundingRateStore.fundingRateRecords(mockPerpetual.address);
      const disputedProposal = await fundingRateStore.fundingRateDisputes(mockPerpetual.address, proposalTime);
      isEmptyProposalStruct(pendingProposal.proposal);
      assert.equal(disputedProposal.proposal.time, proposalTime);
      assert.equal(disputedProposal.proposal.rate, toWei("0.01").toString());
      assert.equal(disputedProposal.proposal.proposer, proposer);
      assert.equal(disputedProposal.proposal.disputer, disputer);
      assert.equal(disputedProposal.proposal.finalFee.toString(), finalFeeAmount.toString());

      // Dispute event was emitted.
      truffleAssert.eventEmitted(disputeTxn, "DisputedRate", ev => {
        return (
          ev.perpetual === mockPerpetual.address &&
          ev.rate.toString() === toWei("0.01").toString() &&
          ev.proposalTime.toString() === proposalTime.toString() &&
          ev.proposer === proposer &&
          ev.disputer === disputer
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
      const newProposalTime = await fundingRateStore.getCurrentTime();
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

      // Publish event was emitted.
      truffleAssert.eventEmitted(settlementTxn, "PublishedRate", ev => {
        return (
          ev.perpetual === mockPerpetual.address &&
          ev.rate.toString() === toWei("0.01").toString() &&
          ev.proposalTime.toString() === proposalTime.toString() &&
          ev.proposer === proposer // For a FAILED dispute, the proposer in this event is credited to the proposer
        );
      });

      // Funding rate and propose time are updated.
      assert.equal(
        (await fundingRateStore.getFundingRateForContract(mockPerpetual.address)).rawValue.toString(),
        toWei("0.01")
      );
      assert.equal(
        (await fundingRateStore.getProposeTimeForContract(mockPerpetual.address)).toString(),
        proposalTime.toString()
      );

      // Disputed funding rate record is deleted.
      const disputedProposal = await fundingRateStore.fundingRateDisputes(mockPerpetual.address, proposalTime);
      isEmptyProposalStruct(disputedProposal.proposal);

      // Pending funding rate proposal is untouched.
      const pendingProposal = await fundingRateStore.fundingRateRecords(mockPerpetual.address);
      assert.equal(pendingProposal.proposal.time, newProposalTime);
      assert.equal(pendingProposal.proposal.rate, toWei("-0.01").toString());
      assert.equal(pendingProposal.proposal.proposer, proposer);
      assert.equal(pendingProposal.proposal.disputer, ZERO_ADDRESS);
      assert.equal(pendingProposal.proposal.finalFee.toString(), finalFeeAmount.toString());

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

      // Publish event was emitted.
      truffleAssert.eventEmitted(settlementTxn, "PublishedRate", ev => {
        return (
          ev.perpetual === mockPerpetual.address &&
          ev.rate.toString() === toWei("-0.01").toString() &&
          ev.proposalTime.toString() === proposalTime.toString() &&
          ev.proposer === disputer // For a SUCCESSFUL dispute, the proposer in this event is credited to the disputer
        );
      });

      // Funding rate and propose time are updated.
      assert.equal(
        (await fundingRateStore.getFundingRateForContract(mockPerpetual.address)).rawValue.toString(),
        toWei("-0.01")
      );
      assert.equal(
        (await fundingRateStore.getProposeTimeForContract(mockPerpetual.address)).toString(),
        proposalTime.toString()
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

      // While the funding rate is undergoing a dispute, propose and expire another funding rate.
      const midDisputeProposeTime = await fundingRateStore.getCurrentTime();
      await fundingRateStore.propose(mockPerpetual.address, { rawValue: toWei("0.02") }, { from: disputer });
      await incrementTime(fundingRateStore, liveness);

      // The funding rate and propose time should be updated now.
      assert.equal(
        (await fundingRateStore.getFundingRateForContract(mockPerpetual.address)).rawValue.toString(),
        toWei("0.02")
      );
      assert.equal(
        (await fundingRateStore.getProposeTimeForContract(mockPerpetual.address)).toString(),
        midDisputeProposeTime.toString()
      );

      // Now make a price available for the dispute.
      await mockOracle.pushPrice(defaultTestIdentifier, proposalTime, disputePrice.toString());

      // Settling the dispute (as FAILED) should still pay rewards normally, but the funding rate should not update
      // since there is a more recent published rate.
      const preBalanceDisputer = await collateralCurrency.balanceOf(disputer);
      const preBalanceProposer = await collateralCurrency.balanceOf(proposer);
      const settlementTxn = await fundingRateStore.settleDispute(mockPerpetual.address, proposalTime, {
        from: disputer
      });

      // Publish event was NOT emitted.
      truffleAssert.eventNotEmitted(settlementTxn, "PublishedRate");

      // Funding rate and proposal time are linked to the proposal that expired in the middle of the dispute.
      assert.equal(
        (await fundingRateStore.getFundingRateForContract(mockPerpetual.address)).rawValue.toString(),
        toWei("0.02")
      );
      assert.equal(
        (await fundingRateStore.getProposeTimeForContract(mockPerpetual.address)).toString(),
        midDisputeProposeTime.toString()
      );

      // Disputed funding rate record is deleted.
      const disputedProposal = await fundingRateStore.fundingRateDisputes(mockPerpetual.address, proposalTime);
      isEmptyProposalStruct(disputedProposal.proposal);

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

    it("New rate and propose time are retrieved", async function() {
      assert.equal(
        (await fundingRateStore.getFundingRateForContract(mockPerpetual.address)).rawValue.toString(),
        toWei("0.01")
      );
      assert.equal(
        (await fundingRateStore.getProposeTimeForContract(mockPerpetual.address)).toString(),
        proposeTime.toString()
      );
    });

    it("New proposal allowed", async function() {
      await fundingRateStore.propose(mockPerpetual.address, { rawValue: toWei("-0.01") }, { from: proposer });

      // Double check that existing value still persists even after a fresh proposal.
      assert.equal(
        (await fundingRateStore.getFundingRateForContract(mockPerpetual.address)).rawValue.toString(),
        toWei("0.01")
      );
    });
  });
});

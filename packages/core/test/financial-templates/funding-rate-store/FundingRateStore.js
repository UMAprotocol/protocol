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

  let contractDeployer = accounts[0];
  let proposer = accounts[1];
  let disputer = accounts[2];
  let rando = accounts[3];

  const liveness = 7200;

  const defaultTestIdentifier = toHex("TEST-IDENTIFIER");

  beforeEach(async () => {
    collateralCurrency = await ExpandedERC20.new("USDC", "USDC", 18);
    await collateralCurrency.addMember(1, contractDeployer);
    timer = await Timer.deployed();
    store = await Store.deployed();
    finder = await Finder.deployed();
    identifierWhitelist = await IdentifierWhitelist.deployed();
    fundingRateStore = await FundingRateStore.new(liveness, collateralCurrency.address, finder.address, timer.address);

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
    assert(await didContractThrow(FundingRateStore.new(0, collateralCurrency.address, finder.address, timer.address)));
  });

  it("Initial Funding Rate of 0", async function() {
    const identifier = toHex("initial-rate");
    assert.equal((await fundingRateStore.getFundingRateForIdentifier(identifier)).rawValue.toString(), "0");
  });

  describe("Unexpired Proposal", function() {
    const identifier = defaultTestIdentifier;
    let proposalTxn, proposalTime;
    beforeEach(async () => {
      proposalTime = await fundingRateStore.getCurrentTime();
      proposalTxn = await fundingRateStore.propose(identifier, { rawValue: toWei("0.01") }, { from: proposer });
      await incrementTime(fundingRateStore, liveness - 1);
    });

    it("Initial rate persists", async function() {
      assert.equal((await fundingRateStore.getFundingRateForIdentifier(identifier)).rawValue.toString(), "0");
    });

    it("Event emitted", async function() {
      truffleAssert.eventEmitted(proposalTxn, "ProposedRate", ev => {
        return (
          toUtf8(ev.identifier) === toUtf8(identifier) &&
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
        await didContractThrow(fundingRateStore.propose(identifier, { rawValue: toWei("-0.01") }, { from: proposer }))
      );

      // No allowance
      await collateralCurrency.mint(proposer, finalFeeAmount);
      assert(
        await didContractThrow(fundingRateStore.propose(identifier, { rawValue: toWei("-0.01") }, { from: proposer }))
      );

      // Allowance and balance OK.
      await collateralCurrency.increaseAllowance(fundingRateStore.address, finalFeeAmount, { from: proposer });
      const preBalance = await collateralCurrency.balanceOf(proposer);
      await fundingRateStore.propose(identifier, { rawValue: toWei("-0.01") }, { from: proposer });
      const postBalance = await collateralCurrency.balanceOf(proposer);
      assert.equal(finalFeeAmount.toString(), toBN(preBalance).sub(toBN(postBalance)));

      // Once proposal expires, proposer receives a final fee rebate.
      await incrementTime(fundingRateStore, liveness);
      await collateralCurrency.mint(rando, finalFeeAmount);
      await collateralCurrency.increaseAllowance(fundingRateStore.address, finalFeeAmount, { from: rando });
      await fundingRateStore.propose(identifier, { rawValue: toWei("0.01") }, { from: rando });
      const postExpiryBalance = await collateralCurrency.balanceOf(proposer);
      assert.equal(finalFeeAmount.toString(), toBN(postExpiryBalance).sub(toBN(postBalance)));
    });

    it("New proposal not allowed", async function() {
      assert(
        await didContractThrow(fundingRateStore.propose(identifier, { rawValue: toWei("0.01") }, { from: proposer }))
      );
    });
  });

  describe("Disputed Proposal", function() {
    const identifier = defaultTestIdentifier;
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
      await fundingRateStore.propose(identifier, { rawValue: toWei("0.01") }, { from: proposer });
      await incrementTime(fundingRateStore, liveness - 1);

      // Mint disputer collateral to cover final fee bond as well.
      await collateralCurrency.mint(disputer, toWei("100"));
      await collateralCurrency.increaseAllowance(fundingRateStore.address, toWei("100"), { from: disputer });
    });

    it("Disputing unexpired proposal", async function() {
      // Can't dispute if proposal is not yet pending
      assert(await didContractThrow(fundingRateStore.dispute(toHex("other-proposal"), { from: disputer })));

      // Disputer who has no balance or allowance to pay final fee cannot dispute.
      assert(await didContractThrow(fundingRateStore.dispute(identifier, { from: rando })));
      await collateralCurrency.mint(rando, finalFeeAmount);
      assert(await didContractThrow(fundingRateStore.dispute(identifier, { from: rando })));

      // Disputer must stake a final fee bond.
      const preBalance = await collateralCurrency.balanceOf(disputer);
      const disputeTxn = await fundingRateStore.dispute(identifier, { from: disputer });
      const postBalance = await collateralCurrency.balanceOf(disputer);
      assert.equal(finalFeeAmount.toString(), toBN(preBalance).sub(toBN(postBalance)));

      // Can't dispute again because now there is no pending proposal.
      assert(await didContractThrow(fundingRateStore.dispute(identifier, { from: disputer })));

      // Price request is enqueued.
      const pendingRequests = await mockOracle.getPendingQueries();
      assert.equal(toUtf8(pendingRequests[0].identifier), toUtf8(identifier));
      assert.equal(pendingRequests[0].time, proposalTime);

      // Pending proposal is deleted, disputed proposal record is created.
      const pendingProposal = await fundingRateStore.fundingRateRecords(identifier);
      const disputedProposal = await fundingRateStore.fundingRateDisputes(identifier, proposalTime);
      isEmptyProposalStruct(pendingProposal.proposal);
      assert.equal(disputedProposal.proposal.time, proposalTime);
      assert.equal(disputedProposal.proposal.rate, toWei("0.01").toString());
      assert.equal(disputedProposal.proposal.proposer, proposer);
      assert.equal(disputedProposal.proposal.disputer, disputer);
      assert.equal(disputedProposal.proposal.finalFee.toString(), finalFeeAmount.toString());

      // Dispute event was emitted.
      truffleAssert.eventEmitted(disputeTxn, "DisputedRate", ev => {
        return (
          toUtf8(ev.identifier) === toUtf8(identifier) &&
          ev.rate.toString() === toWei("0.01").toString() &&
          ev.proposalTime.toString() === proposalTime.toString() &&
          ev.proposer === proposer &&
          ev.disputer === disputer
        );
      });

      // Can propose another proposal.
      await fundingRateStore.propose(identifier, { rawValue: toWei("0.01") }, { from: proposer });
      // Now you can dispute because there is again a pending proposal
      await fundingRateStore.dispute(identifier, { from: disputer });
    });

    it("Settling FAILED disputed proposal", async function() {
      const disputePrice = toWei("0.01");
      await fundingRateStore.dispute(identifier, { from: disputer });
      const newProposalTime = await fundingRateStore.getCurrentTime();
      await fundingRateStore.propose(identifier, { rawValue: toWei("-0.01") }, { from: proposer });

      // Reverts if price has not resolved yet.
      assert(await didContractThrow(fundingRateStore.settleDispute(identifier, proposalTime, { from: disputer })));
      await mockOracle.pushPrice(identifier, proposalTime, disputePrice.toString());

      // Reverts if identifier+time combo does not corresponding to a price requeust.
      assert(
        await didContractThrow(
          fundingRateStore.settleDispute(toHex("WRONG-IDENTIFIER"), proposalTime, { from: disputer })
        )
      );
      assert(await didContractThrow(fundingRateStore.settleDispute(identifier, 123, { from: disputer })));

      const preBalanceDisputer = await collateralCurrency.balanceOf(disputer);
      const preBalanceProposer = await collateralCurrency.balanceOf(proposer);
      const settlementTxn = await fundingRateStore.settleDispute(identifier, proposalTime, { from: disputer });

      // Reverts if dispute is already settled.
      assert(await didContractThrow(fundingRateStore.settleDispute(identifier, proposalTime, { from: disputer })));

      // Publish event was emitted.
      truffleAssert.eventEmitted(settlementTxn, "PublishedRate", ev => {
        return (
          toUtf8(ev.identifier) === toUtf8(identifier) &&
          ev.rate.toString() === toWei("0.01").toString() &&
          ev.proposalTime.toString() === proposalTime.toString() &&
          ev.proposer === proposer // For a FAILED dispute, the proposer in this event is credited to the proposer
        );
      });

      // Funding rate is updated.
      assert.equal((await fundingRateStore.getFundingRateForIdentifier(identifier)).rawValue.toString(), toWei("0.01"));

      // Disputed funding rate record is deleted.
      const disputedProposal = await fundingRateStore.fundingRateDisputes(identifier, proposalTime);
      isEmptyProposalStruct(disputedProposal.proposal);

      // Pending funding rate proposal is untouched.
      const pendingProposal = await fundingRateStore.fundingRateRecords(identifier);
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
      await fundingRateStore.dispute(identifier, { from: disputer });

      await mockOracle.pushPrice(identifier, proposalTime, disputePrice.toString());

      const preBalanceDisputer = await collateralCurrency.balanceOf(disputer);
      const preBalanceProposer = await collateralCurrency.balanceOf(proposer);
      const settlementTxn = await fundingRateStore.settleDispute(identifier, proposalTime, { from: disputer });

      // Publish event was emitted.
      truffleAssert.eventEmitted(settlementTxn, "PublishedRate", ev => {
        return (
          toUtf8(ev.identifier) === toUtf8(identifier) &&
          ev.rate.toString() === toWei("-0.01").toString() &&
          ev.proposalTime.toString() === proposalTime.toString() &&
          ev.proposer === disputer // For a SUCCESSFUL dispute, the proposer in this event is credited to the disputer
        );
      });

      // Funding rate is updated.
      assert.equal(
        (await fundingRateStore.getFundingRateForIdentifier(identifier)).rawValue.toString(),
        toWei("-0.01")
      );

      // Disputer receives final fee rebate, proposer receives nothing.
      const postBalanceDisputer = await collateralCurrency.balanceOf(disputer);
      const postBalanceProposer = await collateralCurrency.balanceOf(proposer);
      assert.equal(finalFeeAmount.toString(), toBN(postBalanceDisputer).sub(toBN(preBalanceDisputer)));
      assert.equal("0", toBN(postBalanceProposer).sub(toBN(preBalanceProposer)));
    });

    it("Cannot dispute expired proposal", async function() {
      await incrementTime(fundingRateStore, 1);
      assert(await didContractThrow(fundingRateStore.dispute(identifier, { from: disputer })));
    });
  });

  describe("Expired Proposal", function() {
    const identifier = defaultTestIdentifier;
    beforeEach(async () => {
      await fundingRateStore.propose(identifier, { rawValue: toWei("0.01") }, { from: proposer });
      await incrementTime(fundingRateStore, liveness);
    });

    it("New rate is retrieved", async function() {
      assert.equal((await fundingRateStore.getFundingRateForIdentifier(identifier)).rawValue.toString(), toWei("0.01"));
    });

    it("New proposal allowed", async function() {
      await fundingRateStore.propose(identifier, { rawValue: toWei("-0.01") }, { from: proposer });

      // Double check that existing value still persists even after a fresh proposal.
      assert.equal((await fundingRateStore.getFundingRateForIdentifier(identifier)).rawValue.toString(), toWei("0.01"));
    });
  });
});

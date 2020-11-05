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
  let derivative = accounts[4];

  const liveness = 7200;

  const defaultTestIdentifier = toHex("TEST-IDENTIFIER");

  beforeEach(async () => {
    collateralCurrency = await ExpandedERC20.new("USDC", "USDC", 18);
    await collateralCurrency.addMember(1, contractDeployer);
    timer = await Timer.deployed();
    store = await Store.deployed();
    finder = await Finder.deployed();
    identifierWhitelist = await IdentifierWhitelist.deployed();
    fundingRateStore = await FundingRateStore.new(
      { rawValue: "0" },
      { rawValue: "0" },
      liveness,
      collateralCurrency.address,
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
        FundingRateStore.new(
          { rawValue: "0" },
          { rawValue: "0" },
          0,
          collateralCurrency.address,
          finder.address,
          timer.address
        )
      )
    );
  });

  it("Initial Funding Rate and Propose Time of 0", async function() {
    const identifier = toHex("initial-rate");
    assert.equal((await fundingRateStore.getFundingRateForIdentifier(identifier)).rawValue.toString(), "0");
    assert.equal((await fundingRateStore.getProposeTimeForIdentifier(identifier)).toString(), "0");
  });

  describe("Unexpired Proposal", function() {
    const identifier = defaultTestIdentifier;
    let proposalTxn, proposalTime;
    beforeEach(async () => {
      proposalTime = await fundingRateStore.getCurrentTime();
      proposalTxn = await fundingRateStore.propose(identifier, { rawValue: toWei("0.01") }, { from: proposer });
      await incrementTime(fundingRateStore, liveness - 1);
    });

    it("Initial rate and propose time persists", async function() {
      assert.equal((await fundingRateStore.getFundingRateForIdentifier(identifier)).rawValue.toString(), "0");
      assert.equal((await fundingRateStore.getProposeTimeForIdentifier(identifier)).toString(), "0");
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

    it("Cannot propose for an (identifier+time) that is currently pending dispute", async function() {
      // Expire the previous proposal.
      await incrementTime(fundingRateStore, 1);

      // Propose, dispute, and propose another funding rate all within the same block. On a production network
      // these actions would have to be called atomically within a single smart contract transaction.
      await fundingRateStore.propose(identifier, { rawValue: toWei("0.05") }, { from: proposer });
      await fundingRateStore.dispute(identifier, { from: disputer });
      assert(
        await didContractThrow(fundingRateStore.propose(identifier, { rawValue: toWei("-0.05") }, { from: proposer }))
      );
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

      // Funding rate and propose time are updated.
      assert.equal((await fundingRateStore.getFundingRateForIdentifier(identifier)).rawValue.toString(), toWei("0.01"));
      assert.equal(
        (await fundingRateStore.getProposeTimeForIdentifier(identifier)).toString(),
        proposalTime.toString()
      );

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

      // Funding rate and publish time are updated.
      assert.equal(
        (await fundingRateStore.getFundingRateForIdentifier(identifier)).rawValue.toString(),
        toWei("-0.01")
      );
      assert.equal(
        (await fundingRateStore.getProposeTimeForIdentifier(identifier)).toString(),
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
      await fundingRateStore.dispute(identifier, { from: disputer });

      // While the funding rate is undergoing a dispute, propose and expire another funding rate.
      const midDisputeProposeTime = await fundingRateStore.getCurrentTime();
      await fundingRateStore.propose(identifier, { rawValue: toWei("0.02") }, { from: disputer });
      await incrementTime(fundingRateStore, liveness);

      // The funding rate and propose time should be updated now.
      assert.equal((await fundingRateStore.getFundingRateForIdentifier(identifier)).rawValue.toString(), toWei("0.02"));
      assert.equal(
        (await fundingRateStore.getProposeTimeForIdentifier(identifier)).toString(),
        midDisputeProposeTime.toString()
      );

      // Now make a price available for the dispute.
      await mockOracle.pushPrice(identifier, proposalTime, disputePrice.toString());

      // Settling the dispute (as FAILED) should still pay rewards normally, but the funding rate should not update
      // since there is a more recent published rate.
      const preBalanceDisputer = await collateralCurrency.balanceOf(disputer);
      const preBalanceProposer = await collateralCurrency.balanceOf(proposer);
      const settlementTxn = await fundingRateStore.settleDispute(identifier, proposalTime, { from: disputer });

      // Publish event was NOT emitted.
      truffleAssert.eventNotEmitted(settlementTxn, "PublishedRate");

      // Funding rate and proposal time are linked to the proposal that expired in the middle of the dispute.
      assert.equal((await fundingRateStore.getFundingRateForIdentifier(identifier)).rawValue.toString(), toWei("0.02"));
      assert.equal(
        (await fundingRateStore.getProposeTimeForIdentifier(identifier)).toString(),
        midDisputeProposeTime.toString()
      );

      // Disputed funding rate record is deleted.
      const disputedProposal = await fundingRateStore.fundingRateDisputes(identifier, proposalTime);
      isEmptyProposalStruct(disputedProposal.proposal);

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
    let proposeTime;
    beforeEach(async () => {
      proposeTime = toBN(await fundingRateStore.getCurrentTime());
      await fundingRateStore.propose(identifier, { rawValue: toWei("0.01") }, { from: proposer });
      await incrementTime(fundingRateStore, liveness);
    });

    it("New rate and propose time are retrieved", async function() {
      assert.equal((await fundingRateStore.getFundingRateForIdentifier(identifier)).rawValue.toString(), toWei("0.01"));
      assert.equal((await fundingRateStore.getProposeTimeForIdentifier(identifier)).toString(), proposeTime.toString());
    });

    it("New proposal allowed", async function() {
      await fundingRateStore.propose(identifier, { rawValue: toWei("-0.01") }, { from: proposer });

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
        collateralCurrency.address,
        finder.address,
        timer.address
      );
      assert.equal((await fundingRateStore.fixedFundingRateFeePerSecondPerPfc()).toString(), toWei("0.1"));
      assert.equal((await fundingRateStore.weeklyDelayFeePerSecondPerPfc()).toString(), toWei("0"));

      // Deployer should hold both the owner and withdrawer roles.
      assert.equal(await fundingRateStore.getMember(0), contractDeployer);
      assert.equal(await fundingRateStore.getMember(1), contractDeployer);

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
          FundingRateStore.new(
            { rawValue: toWei("1") },
            { rawValue: "0" },
            liveness,
            collateralCurrency.address,
            timer.address
          )
        )
      );

      // Disallow setting late fees >= 100%.
      assert(
        await didContractThrow(
          FundingRateStore.new(
            { rawValue: "0" },
            { rawValue: toWei("1") },
            liveness,
            collateralCurrency.address,
            timer.address
          )
        )
      );
    });
    it("Weekly delay fees", async function() {
      // Add weekly delay fee and confirm
      fundingRateStore = await FundingRateStore.new(
        { rawValue: toWei("0") },
        { rawValue: toWei("0.5") },
        liveness,
        collateralCurrency.address,
        finder.address,
        timer.address
      );
      assert.equal((await fundingRateStore.weeklyDelayFeePerSecondPerPfc()).toString(), toWei("0.5"));
    });
    it("Pay fees in ERC20 token", async function() {
      fundingRateStore = await FundingRateStore.new(
        { rawValue: toWei("0") },
        { rawValue: toWei("0") },
        liveness,
        collateralCurrency.address,
        finder.address,
        timer.address
      );

      const firstMarginToken = await ExpandedERC20.new("UMA", "UMA", 18);
      const secondMarginToken = await ExpandedERC20.new("UMA2", "UMA2", 18);

      // Mint 100 tokens of each to the contract and verify balances.
      await firstMarginToken.addMember(1, contractDeployer);
      await firstMarginToken.mint(derivative, toWei("100"));
      let firstTokenBalanceInStore = await firstMarginToken.balanceOf(fundingRateStore.address);
      let firstTokenBalanceInDerivative = await firstMarginToken.balanceOf(derivative);
      assert.equal(firstTokenBalanceInStore, 0);
      assert.equal(firstTokenBalanceInDerivative, toWei("100"));

      await secondMarginToken.addMember(1, contractDeployer);
      await secondMarginToken.mint(derivative, toWei("100"));
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
      await fundingRateStore.withdrawErc20(secondMarginToken.address, toWei("15"));
      let secondTokenBalanceInOwner = await secondMarginToken.balanceOf(contractDeployer);
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
      assert(await didContractThrow(fundingRateStore.withdrawErc20(secondMarginToken.address, toWei("100"))));

      // Withdraw remaining amounts and verify balancse.
      await fundingRateStore.withdrawErc20(firstMarginToken.address, toWei("10"));
      await fundingRateStore.withdrawErc20(secondMarginToken.address, toWei("5"));

      let firstTokenBalanceInOwner = await firstMarginToken.balanceOf(contractDeployer);
      firstTokenBalanceInStore = await firstMarginToken.balanceOf(fundingRateStore.address);
      assert.equal(firstTokenBalanceInOwner.toString(), toWei("10"));
      assert.equal(firstTokenBalanceInStore.toString(), toWei("0"));

      secondTokenBalanceInOwner = await secondMarginToken.balanceOf(contractDeployer);
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
        collateralCurrency.address,
        finder.address,
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
        collateralCurrency.address,
        finder.address,
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

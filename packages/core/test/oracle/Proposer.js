const hre = require("hardhat");
const { getContract, assertEventEmitted, web3 } = hre;
const { runDefaultFixture, interfaceName, didContractThrow } = require("@uma/common");
const { assert } = require("chai");

const MockOracleCombined = getContract("MockOracleCombined");
const MockOracleAncillary = getContract("MockOracleAncillary");
const VotingToken = getContract("VotingToken");
const Finder = getContract("Finder");
const Governor = getContract("Governor");
const Proposer = getContract("Proposer");
const Timer = getContract("Timer");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const Store = getContract("Store");
const { toWei, utf8ToHex } = web3.utils;

describe("Proposer", function () {
  let accounts;
  let owner;
  let submitter;
  let rando;

  let proposer;
  let bond = toWei("100");

  let mockOracle;
  let votingToken;
  let finder;
  let governor;

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [owner, submitter, rando] = accounts;
    await runDefaultFixture(hre);
    finder = await Finder.deployed();
    votingToken = await VotingToken.deployed();
    governor = await Governor.deployed();
    const timer = await Timer.deployed();
    const mockOracleAddress = (
      await MockOracleCombined.new(finder.options.address, timer.options.address).send({ from: owner })
    ).options.address;
    mockOracle = await MockOracleAncillary.at(mockOracleAddress);
    proposer = await Proposer.new(
      votingToken.options.address,
      bond,
      governor.options.address,
      finder.options.address,
      timer.options.address
    ).send({ from: owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Oracle, 64), mockOracle.options.address)
      .send({ from: owner });
    await governor.methods.resetMember(1, proposer.options.address).send({ from: owner });
    const identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.methods.transferOwnership(governor.options.address).send({ from: owner });
  });

  const changeBond = async (newBond) => {
    const currentBond = await proposer.methods.bond().call();
    await votingToken.methods.transfer(submitter, currentBond).send({ from: owner });
    await votingToken.methods.approve(proposer.options.address, currentBond).send({ from: submitter });
    const txData = proposer.methods.setBond(newBond).encodeABI();
    const proposalTx = proposer.methods.propose([{ data: txData, value: 0, to: proposer.options.address }]);
    const id = await proposalTx.call({ from: submitter });
    await proposalTx.send({ from: submitter });
    const pendingQueries = await mockOracle.methods.getPendingQueries().call();
    const { identifier, time, ancillaryData } = pendingQueries[pendingQueries.length - 1];
    await mockOracle.methods.pushPrice(identifier, time, ancillaryData, toWei("1")).send({ from: owner });
    await proposer.methods.resolveProposal(id).send({ from: submitter });
    await votingToken.methods.transfer(owner, currentBond).send({ from: submitter });
    return await governor.methods.executeProposal(id, 0).send({ from: submitter });
  };

  it("Setting the bond", async function () {
    // Bond should start with the constructed value.
    assert.equal(await proposer.methods.bond().call(), bond);

    // Owner is the only one who can set bond.
    await didContractThrow(proposer.methods.setBond(toWei("10")).send({ from: submitter }));

    // Set the bond to 10.
    const tx = await changeBond(toWei("10"));
    await assertEventEmitted(tx, proposer, "BondSet", (event) => event.bond === toWei("10"));
    assert.equal(await proposer.methods.bond().call(), toWei("10"));

    // Reset the bond for other tests.
    await changeBond(bond);
  });

  it("Bond must be paid", async function () {
    const txn = proposer.methods.propose([]);

    // No balance and bond isn't approved.
    await didContractThrow(txn.send({ from: submitter }));

    // No approval
    await votingToken.methods.transfer(submitter, bond).send({ from: owner });
    await didContractThrow(txn.send({ from: submitter }));

    // Should succeed
    await votingToken.methods.approve(proposer.options.address, bond).send({ from: submitter });
    await txn.send({ from: submitter });
  });

  it("Successful Proposal", async function () {
    // Move tokens.
    await votingToken.methods.transfer(submitter, bond).send({ from: owner });
    await votingToken.methods.approve(proposer.options.address, bond).send({ from: submitter });

    // Build a no-op txn for the governor to execute.
    const noOpTxnBytes = votingToken.methods.approve(submitter, "0").encodeABI();

    // Grab the proposal id and then send the proposal txn.
    const txn = proposer.methods.propose([{ to: votingToken.options.address, value: 0, data: noOpTxnBytes }]);
    const id = await txn.call({ from: submitter });
    await txn.send({ from: submitter });

    // Should have pulled the submitter's tokens.
    assert.equal(await votingToken.methods.balanceOf(submitter).call(), "0");

    // Push the proce and execute the proposal.
    const pendingQueries = await mockOracle.methods.getPendingQueries().call();
    const { identifier, time, ancillaryData } = pendingQueries[pendingQueries.length - 1];
    await mockOracle.methods.pushPrice(identifier, time, ancillaryData, toWei("1")).send({ from: owner });
    await governor.methods.executeProposal(id, 0).send({ from: rando });

    // Resolve the proposal in the proposer.
    const receipt = await proposer.methods.resolveProposal(id).send({ from: rando });

    // Check that the event resolved as expected for a true value and the bond was repaid to the submitter.
    assert.equal(await votingToken.methods.balanceOf(submitter).call(), bond);
    await assertEventEmitted(
      receipt,
      proposer,
      "ProposalResolved",
      (event) => event.id === id && event.success === true
    );

    // Clean up votingToken balance.
    await votingToken.methods.transfer(owner, bond).send({ from: submitter });
  });

  it("Unsuccessful Proposal", async function () {
    // Move tokens.
    await votingToken.methods.transfer(submitter, bond).send({ from: owner });
    await votingToken.methods.approve(proposer.options.address, bond).send({ from: submitter });

    // Build a no-op txn for the governor to execute.
    const noOpTxnBytes = votingToken.methods.approve(submitter, "0").encodeABI();

    // Grab the proposal id and then send the proposal txn.
    const txn = proposer.methods.propose([{ to: votingToken.options.address, value: 0, data: noOpTxnBytes }]);
    const id = await txn.call({ from: submitter });
    await txn.send({ from: submitter });

    // Should have pulled the submitter's tokens.
    assert.equal(await votingToken.methods.balanceOf(submitter).call(), "0");

    // Push the proce and execute the proposal.
    const pendingQueries = await mockOracle.methods.getPendingQueries().call();
    const { identifier, time, ancillaryData } = pendingQueries[pendingQueries.length - 1];
    await mockOracle.methods.pushPrice(identifier, time, ancillaryData, toWei("0")).send({ from: owner });
    await didContractThrow(governor.methods.executeProposal(id, 0).send({ from: rando }));

    // Resolve the proposal in the proposer.
    const receipt = await proposer.methods.resolveProposal(id).send({ from: owner });

    // Check that the event resolved as expected for a true value and the bond was repaid to the submitter.
    assert.equal(await votingToken.methods.balanceOf(submitter).call(), "0");
    await assertEventEmitted(
      receipt,
      proposer,
      "ProposalResolved",
      (event) => event.id === id && event.success === false
    );

    // Verify balanes.
    const store = await Store.deployed();
    assert.equal(await votingToken.methods.balanceOf(store.options.address).call(), bond);
    assert.equal(await votingToken.methods.balanceOf(submitter).call(), "0");
  });

  it("No repeated payouts", async function () {
    // Move tokens.
    await votingToken.methods.transfer(submitter, bond).send({ from: owner });
    await votingToken.methods.approve(proposer.options.address, bond).send({ from: submitter });

    // Build a no-op txn for the governor to execute.
    const noOpTxnBytes = votingToken.methods.approve(submitter, "0").encodeABI();

    // Grab the proposal id and then send the proposal txn.
    const txn = proposer.methods.propose([{ to: votingToken.options.address, value: 0, data: noOpTxnBytes }]);
    const id = await txn.call({ from: submitter });
    await txn.send({ from: submitter });

    // Should have pulled the submitter's tokens.
    assert.equal(await votingToken.methods.balanceOf(submitter).call(), "0");

    // Push the proce and execute the proposal.
    const pendingQueries = await mockOracle.methods.getPendingQueries().call();
    const { identifier, time, ancillaryData } = pendingQueries[pendingQueries.length - 1];
    await mockOracle.methods.pushPrice(identifier, time, ancillaryData, toWei("1")).send({ from: owner });
    await governor.methods.executeProposal(id, 0).send({ from: rando });

    // Resolve the proposal in the proposer.
    await proposer.methods.resolveProposal(id).send({ from: rando });

    // Check that the event resolved as expected for a true value and the bond was repaid to the submitter.
    assert.equal(await votingToken.methods.balanceOf(submitter).call(), bond);

    // Send balance back to the proposer and check that the payout can't be made again.
    await votingToken.methods.transfer(proposer.options.address, bond).send({ from: submitter });
    assert(await didContractThrow(proposer.methods.resolveProposal(id).send({ from: submitter })));
  });
});

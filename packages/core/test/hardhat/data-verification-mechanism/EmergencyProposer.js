const hre = require("hardhat");
const { getContract, assertEventEmitted, web3 } = hre;
const { runVotingV2Fixture, interfaceName, didContractThrow } = require("@uma/common");
const { assert } = require("chai");

const MockOracleGovernance = getContract("MockOracleGovernance");
const MockOracleAncillary = getContract("MockOracleAncillary");
const VotingToken = getContract("VotingToken");
const Finder = getContract("Finder");
const GovernorV2 = getContract("GovernorV2");
const EmergencyProposer = getContract("EmergencyProposerTest");
const ProposerV2 = getContract("ProposerV2Test");
const Timer = getContract("Timer");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const { toWei, utf8ToHex } = web3.utils;

describe("EmergencyProposer", function () {
  let accounts;
  let owner;
  let submitter;
  let executor;
  let rando;

  let proposer;
  let regularProposer;
  let bond = toWei("100");
  let quorum = toWei("1000000");
  let minimumWaitTime = "604800";
  const defaultAncillaryData = web3.utils.randomHex(3000);

  let mockOracle;
  let votingToken;
  let finder;
  let governor;

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [owner, submitter, executor, rando] = accounts;
    await runVotingV2Fixture(hre);
    finder = await Finder.deployed();
    votingToken = await VotingToken.deployed();
    governor = await GovernorV2.deployed();
    const timer = await Timer.deployed();
    const mockOracleAddress = (
      await MockOracleGovernance.new(finder.options.address, timer.options.address).send({ from: owner })
    ).options.address;
    mockOracle = await MockOracleAncillary.at(mockOracleAddress);
    proposer = await EmergencyProposer.new(
      votingToken.options.address,
      quorum,
      governor.options.address,
      executor,
      timer.options.address,
      7 * 24 * 60 * 60 // 7 days
    ).send({ from: owner });
    regularProposer = await ProposerV2.new(
      votingToken.options.address,
      bond,
      governor.options.address,
      finder.options.address,
      timer.options.address
    ).send({ from: owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Oracle, 64), mockOracle.options.address)
      .send({ from: owner });

    await governor.methods.resetMember(1, regularProposer.options.address).send({ from: owner });
    await governor.methods.resetMember(2, proposer.options.address).send({ from: owner });
    const identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.methods.transferOwnership(governor.options.address).send({ from: owner });
  });

  const passProposal = async (transactions) => {
    const bond = await regularProposer.methods.bond().call();
    await votingToken.methods.transfer(submitter, bond).send({ from: owner });
    await votingToken.methods.approve(regularProposer.options.address, bond).send({ from: submitter });
    const proposalTx = regularProposer.methods.propose(transactions, defaultAncillaryData);
    const id = await proposalTx.call({ from: submitter });
    await proposalTx.send({ from: submitter });
    const pendingQueries = await mockOracle.methods.getPendingQueries().call();
    const { identifier, time, ancillaryData } = pendingQueries[pendingQueries.length - 1];
    await mockOracle.methods.pushPrice(identifier, time, ancillaryData, toWei("1")).send({ from: owner });
    await regularProposer.methods.resolveProposal(id).send({ from: submitter });
    await votingToken.methods.transfer(owner, bond).send({ from: submitter });
    return await governor.methods.executeProposal(id, 0).send({ from: submitter });
  };

  const setQuorum = async (newQuorum) => {
    return await passProposal([
      { data: proposer.methods.setQuorum(newQuorum).encodeABI(), value: 0, to: proposer.options.address },
    ]);
  };

  const setMinimumWaitTime = async (newMinimumWaitTime) => {
    return await passProposal([
      {
        data: proposer.methods.setMinimumWaitTime(newMinimumWaitTime).encodeABI(),
        value: 0,
        to: proposer.options.address,
      },
    ]);
  };

  const setExecutor = async (newExecutor) => {
    return await passProposal([
      { data: proposer.methods.setExecutor(newExecutor).encodeABI(), value: 0, to: proposer.options.address },
    ]);
  };

  const slashProposal = async (id) => {
    return await passProposal([
      { data: proposer.methods.slashProposal(id).encodeABI(), value: 0, to: proposer.options.address },
    ]);
  };

  it("Setting the quorum", async function () {
    // Quorum should start with the constructed value.
    assert.equal(await proposer.methods.quorum().call(), quorum);

    // Owner is the only one who can set quorum.
    assert(await didContractThrow(proposer.methods.setQuorum(toWei("10")).send({ from: submitter })));
    assert(await didContractThrow(proposer.methods.setQuorum(toWei("10")).send({ from: executor })));

    // Quorum has to be less than total supply
    assert(await didContractThrow(setQuorum(await votingToken.methods.totalSupply().call())));

    // Set the quorum to 10.
    const tx = await setQuorum(toWei("10"));
    await assertEventEmitted(tx, proposer, "QuorumSet", (event) => event.quorum === toWei("10"));
    assert.equal(await proposer.methods.quorum().call(), toWei("10"));

    // Reset the quorum for other tests.
    await setQuorum(quorum);
  });

  it("Setting the minimumWaitTime", async function () {
    // minimumWaitTime should start with the default value.
    assert.equal(await proposer.methods.minimumWaitTime().call(), minimumWaitTime);

    // Owner is the only one who can set the minimumWaitTime.
    assert(await didContractThrow(proposer.methods.setMinimumWaitTime(toWei("10")).send({ from: submitter })));
    assert(await didContractThrow(proposer.methods.setMinimumWaitTime(toWei("10")).send({ from: executor })));

    // Max minimum wait time is 1 month
    const oneMonthInSeconds = 60 * 60 * 24 * 30;
    assert(await didContractThrow(setMinimumWaitTime(oneMonthInSeconds + 1)));

    // Set the quorum to 10.
    const tx = await setMinimumWaitTime("100");
    await assertEventEmitted(tx, proposer, "MinimumWaitTimeSet", (event) => event.minimumWaitTime.toString() === "100");
    assert.equal(await proposer.methods.minimumWaitTime().call(), "100");

    // Reset the bond for other tests.
    await setMinimumWaitTime(minimumWaitTime);
  });

  it("Setting the executor", async function () {
    // Executor should start with the default value.
    assert.equal(await proposer.methods.executor().call(), executor);

    // Owner is the only one who can set executor.
    assert(await didContractThrow(proposer.methods.setExecutor(rando).send({ from: submitter })));
    assert(await didContractThrow(proposer.methods.setExecutor(rando).send({ from: executor })));

    // Set the executor to rando.
    const tx = await setExecutor(rando);
    await assertEventEmitted(tx, proposer, "ExecutorSet", (event) => event.executor === rando);
    assert.equal(await proposer.methods.executor().call(), rando);

    // Reset the executor for other tests.
    await setExecutor(executor);
  });

  it("Quorum must be paid", async function () {
    // Build a no-op txn for the governor to execute.
    const noOpTxnBytes = votingToken.methods.approve(submitter, "0").encodeABI();

    const txn = proposer.methods.emergencyPropose([{ to: votingToken.options.address, value: 0, data: noOpTxnBytes }]);

    // No balance and bond isn't approved.
    assert(await didContractThrow(txn.send({ from: submitter })));

    // No approval
    await votingToken.methods.transfer(submitter, quorum).send({ from: owner });
    assert(await didContractThrow(txn.send({ from: submitter })));

    // Should succeed
    await votingToken.methods.approve(proposer.options.address, quorum).send({ from: submitter });
    await txn.send({ from: submitter });
  });

  it("Successful Proposal", async function () {
    // Move tokens.
    await votingToken.methods.transfer(submitter, quorum).send({ from: owner });
    await votingToken.methods.approve(proposer.options.address, quorum).send({ from: submitter });

    // Build a no-op txn for the governor to execute.
    const noOpTxnBytes = votingToken.methods.approve(submitter, "0").encodeABI();

    // Grab the proposal id and then send the proposal txn.
    const txn = proposer.methods.emergencyPropose([{ to: votingToken.options.address, value: 0, data: noOpTxnBytes }]);
    const id = await txn.call({ from: submitter });
    await txn.send({ from: submitter });

    // Should have pulled the submitter's tokens.
    assert.equal(await votingToken.methods.balanceOf(submitter).call(), "0");

    // Cannot execute before expiry.
    assert(await didContractThrow(proposer.methods.executeEmergencyProposal(id).send({ from: executor })));

    // Wait through expiry.
    const currentTime = await proposer.methods.getCurrentTime().call();
    await proposer.methods
      .setCurrentTime(Number(currentTime.toString()) + Number(minimumWaitTime))
      .send({ from: owner });

    // Cannot be executed by other addresses.
    assert(await didContractThrow(proposer.methods.executeEmergencyProposal(id).send({ from: owner })));
    assert(await didContractThrow(proposer.methods.executeEmergencyProposal(id).send({ from: rando })));
    assert(await didContractThrow(proposer.methods.executeEmergencyProposal(id).send({ from: submitter })));

    // Execution should work.
    const receipt = await proposer.methods.executeEmergencyProposal(id).send({ from: executor });

    // Cannot execute again.
    assert(await didContractThrow(proposer.methods.executeEmergencyProposal(id).send({ from: executor })));

    // Check that the event resolved as expected for a true value and the bond was repaid to the submitter.
    assert.equal(await votingToken.methods.balanceOf(submitter).call(), quorum);
    await assertEventEmitted(
      receipt,
      proposer,
      "EmergencyProposalExecuted",
      (event) => event.id === id && event.sender === submitter && event.lockedTokens == quorum
    );

    // Clean up votingToken balance.
    await votingToken.methods.transfer(owner, quorum).send({ from: submitter });
  });

  it("Slashed Proposal", async function () {
    // Move tokens.
    await votingToken.methods.transfer(submitter, quorum).send({ from: owner });
    await votingToken.methods.approve(proposer.options.address, quorum).send({ from: submitter });

    // Build a no-op txn for the governor to execute.
    const noOpTxnBytes = votingToken.methods.approve(submitter, "0").encodeABI();

    // Grab the proposal id and then send the proposal txn.
    const txn = proposer.methods.emergencyPropose([{ to: votingToken.options.address, value: 0, data: noOpTxnBytes }]);
    const id = await txn.call({ from: submitter });
    await txn.send({ from: submitter });

    // Should have pulled the submitter's tokens.
    assert.equal(await votingToken.methods.balanceOf(submitter).call(), "0");

    const receipt = await slashProposal(id);

    // Check that the event resolved as expected for a true value and the bond was sent to the Governor.
    assert.equal(await votingToken.methods.balanceOf(submitter).call(), "0");
    assert.equal(await votingToken.methods.balanceOf(governor.options.address).call(), quorum);
    await assertEventEmitted(
      receipt,
      proposer,
      "EmergencyProposalSlashed",
      (event) => event.id === id && event.sender === submitter && event.lockedTokens == quorum
    );

    // Verify balances.
    assert.equal(await votingToken.methods.balanceOf(submitter).call(), "0");
    assert.equal(await votingToken.methods.balanceOf(governor.options.address).call(), quorum);
  });

  it("Removed Proposal", async function () {
    // Move tokens.
    await votingToken.methods.transfer(submitter, quorum).send({ from: owner });
    await votingToken.methods.approve(proposer.options.address, quorum).send({ from: submitter });

    // Build a no-op txn for the governor to execute.
    const noOpTxnBytes = votingToken.methods.approve(submitter, "0").encodeABI();

    // Grab the proposal id and then send the proposal txn.
    const txn = proposer.methods.emergencyPropose([{ to: votingToken.options.address, value: 0, data: noOpTxnBytes }]);
    const id = await txn.call({ from: submitter });
    await txn.send({ from: submitter });

    // Should have pulled the submitter's tokens.
    assert.equal(await votingToken.methods.balanceOf(submitter).call(), "0");

    // Cannot remove proposal before expiry.
    assert(await didContractThrow(proposer.methods.removeProposal(id).send({ from: executor })));

    // Wait through expiry.
    const currentTime = await proposer.methods.getCurrentTime().call();
    await proposer.methods
      .setCurrentTime(Number(currentTime.toString()) + Number(minimumWaitTime))
      .send({ from: owner });

    // Only certain addresses can remove proposals.
    assert(await didContractThrow(proposer.methods.removeProposal(id).send({ from: rando })));
    await proposer.methods.removeProposal(id).call({ from: executor });
    const receipt = await proposer.methods.removeProposal(id).send({ from: executor });

    // Cannot remove again.
    assert(await didContractThrow(proposer.methods.removeProposal(id).send({ from: executor })));

    // Check that the event resolved as expected for a true value and the bond was repaid to the submitter.
    assert.equal(await votingToken.methods.balanceOf(submitter).call(), quorum);
    await assertEventEmitted(
      receipt,
      proposer,
      "EmergencyProposalRemoved",
      (event) =>
        event.id === id && event.caller === executor && event.sender === submitter && event.lockedTokens == quorum
    );

    // Clean up votingToken balance.
    await votingToken.methods.transfer(owner, quorum).send({ from: submitter });
  });
  it("Cannot propose empty proposal", async function () {
    // Move tokens.
    await votingToken.methods.transfer(submitter, quorum).send({ from: owner });
    await votingToken.methods.approve(proposer.options.address, quorum).send({ from: submitter });

    // Construct an empty proposal.
    const txn = proposer.methods.emergencyPropose([]);

    assert(await didContractThrow(txn.send({ from: submitter })));
  });
});

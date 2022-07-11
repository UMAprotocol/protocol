const hre = require("hardhat");
const { runVotingV2Fixture } = require("@uma/common");
const { getContract, assertEventEmitted } = hre;
const {
  RegistryRolesEnum,
  didContractThrow,
  getRandomSignedInt,
  computeVoteHashAncillary,
  signMessage,
} = require("@uma/common");
const { moveToNextRound, moveToNextPhase } = require("../../utils/Voting.js");
const { interfaceName } = require("@uma/common");
const { assert } = require("chai");

const GovernorV2 = getContract("GovernorV2");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const VotingV2 = getContract("VotingV2");
const VotingToken = getContract("VotingToken");
const TestnetERC20 = getContract("TestnetERC20");
const ReentrancyChecker = getContract("ReentrancyChecker");
const GovernorTest = getContract("GovernorTest");
const Timer = getContract("Timer");
const Registry = getContract("Registry");
const Finder = getContract("Finder");
const SlashingLibrary = getContract("SlashingLibrary");

// Extract web3 functions into primary namespace.
const { toBN, toWei, hexToUtf8, utf8ToHex, padRight } = web3.utils;
const snapshotMessage = "Sign For Snapshot";

describe("GovernorV2", function () {
  let voting;
  let governorV2;
  let testToken;
  let supportedIdentifiers;
  let finder;
  let timer;
  let signature;
  let votingToken;
  const defaultAncillaryData = web3.utils.randomHex(3000);

  let accounts;
  let proposer;
  let account2;
  let account3;

  const constructTransferTransaction = (destination, amount) => {
    return testToken.methods.transfer(destination, amount).encodeABI();
  };

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [proposer, account2, account3] = accounts;
    await runVotingV2Fixture(hre);
    voting = await VotingV2.deployed();
    supportedIdentifiers = await IdentifierWhitelist.deployed();
    governorV2 = await GovernorV2.deployed();
    testToken = await TestnetERC20.new("Test", "TEST", 18).send({ from: accounts[0] });
    votingToken = await VotingToken.deployed();

    // Allow proposer to mint tokens.
    const minterRole = 1;
    await votingToken.methods.addMember(minterRole, proposer).send({ from: accounts[0] });

    // Proposer account has 100M voting tokens initially.
    // The staked amount determines the voting power of the account.
    await votingToken.methods.approve(voting.options.address, toWei("20000000")).send({ from: proposer });
    await voting.methods.stake(toWei("20000000")).send({ from: proposer }); // 20MM
    await votingToken.methods.transfer(account2, toWei("20000000")).send({ from: accounts[0] });
    await votingToken.methods.approve(voting.options.address, toWei("20000000")).send({ from: account2 });
    await voting.methods.stake(toWei("20000000")).send({ from: account2 }); // 20MM
    await votingToken.methods.transfer(account3, toWei("1000000")).send({ from: accounts[0] });
    await votingToken.methods.approve(voting.options.address, toWei("1000000")).send({ from: account3 });
    await voting.methods.stake(toWei("1000000")).send({ from: account3 }); // 1MM (can't reach the 5% GAT alone)

    // To work, the governorV2 must be the owner of the VotingV2 contract. This is not the default setup in the test
    // environment, so ownership must be transferred.

    await voting.methods.transferOwnership(governorV2.options.address).send({ from: accounts[0] });

    signature = await signMessage(web3, snapshotMessage, proposer);
  });

  beforeEach(async () => {
    // Make sure the governorV2 time and voting time are aligned before each test case.
    let currentTime = await voting.methods.getCurrentTime().call();
    await governorV2.methods.setCurrentTime(currentTime).send({ from: accounts[0] });

    finder = await Finder.deployed();
    timer = await Timer.deployed();
  });

  it("Proposal permissions", async function () {
    const txnData = constructTransferTransaction(proposer, "0");
    assert(
      await didContractThrow(
        governorV2.methods
          .propose([{ to: testToken.options.address, value: 0, data: txnData }], defaultAncillaryData)
          .send({ from: account2 })
      )
    );
  });

  it("Cannot send to 0x0", async function () {
    const txnData = constructTransferTransaction(proposer, "0");

    const zeroAddress = "0x0000000000000000000000000000000000000000";
    assert(
      await didContractThrow(
        governorV2.methods
          .propose([{ to: zeroAddress, value: 0, data: txnData }], defaultAncillaryData)
          .send({ from: accounts[0] })
      )
    );

    assert(
      await didContractThrow(
        governorV2.methods
          .propose(
            [
              { to: testToken.options.address, value: 0, data: txnData },
              { to: zeroAddress, value: 0, data: txnData },
            ],
            defaultAncillaryData
          )
          .send({ from: accounts[0] })
      )
    );
  });

  it("Cannot send transaction with data to EOA", async function () {
    const txnData = constructTransferTransaction(proposer, "0");
    // A proposal with data should not be able to be sent to an EOA as only a contract can process data in a tx.
    assert(
      await didContractThrow(
        governorV2.methods
          .propose([{ to: account2, value: 0, data: txnData }], defaultAncillaryData)
          .send({ from: accounts[0] })
      )
    );
  });

  it("Identifier construction", async function () {
    // Construct the transaction to send 0 tokens.
    const txnData = constructTransferTransaction(proposer, "0");

    // The id is the number of proposals before sending.
    const id1 = await governorV2.methods.numProposals().call();

    // Send the proposal.
    await governorV2.methods
      .propose([{ to: testToken.options.address, value: 0, data: txnData }], defaultAncillaryData)
      .send({ from: accounts[0] });

    // Send a second proposal. Note: a second proposal is necessary to ensure we test at least one nonzero id.
    const id2 = await governorV2.methods.numProposals().call();
    await governorV2.methods
      .propose([{ to: testToken.options.address, value: 0, data: txnData }], defaultAncillaryData)
      .send({ from: accounts[0] });

    // The proposals should show up in the pending requests in the *next* round.
    await moveToNextRound(voting, accounts[0]);
    const roundId = await voting.methods.getCurrentRoundId().call();
    const pendingRequests = await voting.methods.getPendingRequests().call();

    // Check that the proposals shows up and that the identifiers are constructed correctly.
    assert.equal(pendingRequests.length, 2);
    const request1 = { ...pendingRequests[0], identifier: padRight(pendingRequests[0].identifier, 64) };
    const request2 = { ...pendingRequests[1], identifier: padRight(pendingRequests[1].identifier, 64) };
    assert.equal(web3.utils.hexToUtf8(request1.identifier), `Admin ${id1}`);
    assert.equal(web3.utils.hexToUtf8(request2.identifier), `Admin ${id2}`);

    // Execute the proposals to clean up.
    const vote = toWei("1");
    const salt = getRandomSignedInt();
    const hash1 = computeVoteHashAncillary({
      price: vote,
      salt,
      account: proposer,
      time: request1.time,
      roundId,
      identifier: request1.identifier,
      ancillaryData: defaultAncillaryData,
    });
    const hash2 = computeVoteHashAncillary({
      price: vote,
      salt,
      account: proposer,
      time: request2.time,
      roundId,
      identifier: request2.identifier,
      ancillaryData: defaultAncillaryData,
    });
    await voting.methods
      .commitVote(request1.identifier, request1.time, defaultAncillaryData, hash1)
      .send({ from: accounts[0] });
    await voting.methods
      .commitVote(request2.identifier, request2.time, defaultAncillaryData, hash2)
      .send({ from: accounts[0] });
    await moveToNextPhase(voting, accounts[0]);
    await voting.methods.snapshotCurrentRound(signature).send({ from: accounts[0] });
    await voting.methods
      .revealVote(request1.identifier, request1.time, vote, defaultAncillaryData, salt)
      .send({ from: accounts[0] });
    await voting.methods
      .revealVote(request2.identifier, request2.time, vote, defaultAncillaryData, salt)
      .send({ from: accounts[0] });
    await moveToNextRound(voting, accounts[0]);
    await moveToNextRound(voting, accounts[0]);
    await governorV2.methods.executeProposal(id1, 0).send({ from: accounts[0] });
    await governorV2.methods.executeProposal(id2, 0).send({ from: accounts[0] });
  });

  it("Successful proposal", async function () {
    // Issue some test tokens to the governorV2 address.
    await testToken.methods.allocateTo(governorV2.options.address, toWei("1")).send({ from: accounts[0] });

    // Construct the transaction data to send the newly minted tokens to proposer.
    const txnData = constructTransferTransaction(proposer, toWei("1"));

    // Send the proposal.
    const id = await governorV2.methods.numProposals().call();
    await governorV2.methods
      .propose([{ to: testToken.options.address, value: 0, data: txnData }], defaultAncillaryData)
      .send({ from: accounts[0] });
    await moveToNextRound(voting, accounts[0]);
    const roundId = await voting.methods.getCurrentRoundId().call();
    const pendingRequests = await voting.methods.getPendingRequests().call();
    const request = { ...pendingRequests[0], identifier: padRight(pendingRequests[0].identifier, 64) };

    // Vote the proposal through.
    const vote = toWei("1");
    const salt = getRandomSignedInt();
    const hash = computeVoteHashAncillary({
      price: vote,
      salt,
      account: proposer,
      time: request.time,
      roundId,
      identifier: request.identifier,
      ancillaryData: defaultAncillaryData,
    });
    await voting.methods
      .commitVote(request.identifier, request.time, defaultAncillaryData, hash)
      .send({ from: accounts[0] });
    await moveToNextPhase(voting, accounts[0]);
    await voting.methods.snapshotCurrentRound(signature).send({ from: accounts[0] });
    await voting.methods
      .revealVote(request.identifier, request.time, vote, defaultAncillaryData, salt)
      .send({ from: accounts[0] });
    await moveToNextRound(voting, accounts[0]);

    // Cannot send ETH to execute a transaction that requires 0 ETH.
    assert(
      await didContractThrow(governorV2.methods.executeProposal(id, 0).send({ from: accounts[0], value: toWei("1") }))
    );

    // Check to make sure that the tokens get transferred at the time of execution.
    const startingBalance = toBN(await testToken.methods.balanceOf(proposer).call());
    await governorV2.methods.executeProposal(id, 0).send({ from: accounts[0] });
    assert.equal(
      (await testToken.methods.balanceOf(proposer).call()).toString(),
      startingBalance.add(toBN(toWei("1"))).toString()
    );
  });

  it("Successful proposal that requires ETH", async function () {
    const amountToDeposit = toWei("1");

    // Send the proposal to send ETH to account2.
    const id = await governorV2.methods.numProposals().call();
    await governorV2.methods
      .propose(
        [
          {
            to: account2,
            value: amountToDeposit,
            data: web3.utils.hexToBytes("0x"), // "0x" is an empty bytes array to indicate no data tx.
          },
        ],
        defaultAncillaryData
      )
      .send({ from: accounts[0] });

    await moveToNextRound(voting, accounts[0]);
    const roundId = await voting.methods.getCurrentRoundId().call();
    const pendingRequests = await voting.methods.getPendingRequests().call();
    const request = { ...pendingRequests[0], identifier: padRight(pendingRequests[0].identifier, 64) };

    // Vote the proposal through.
    const vote = toWei("1");
    const salt = getRandomSignedInt();
    const hash = computeVoteHashAncillary({
      price: vote,
      salt,
      account: proposer,
      time: request.time,
      roundId,
      identifier: request.identifier,
      ancillaryData: defaultAncillaryData,
    });
    await voting.methods
      .commitVote(request.identifier, request.time, defaultAncillaryData, hash)
      .send({ from: accounts[0] });
    await moveToNextPhase(voting, accounts[0]);
    await voting.methods.snapshotCurrentRound(signature).send({ from: accounts[0] });
    await voting.methods
      .revealVote(request.identifier, request.time, vote, defaultAncillaryData, salt)
      .send({ from: accounts[0] });
    await moveToNextRound(voting, accounts[0]);

    // Execute the proposal and simultaneously deposit ETH to pay for the transaction.
    // Check to make sure that the ETH gets transferred at the time of execution.
    const startingBalance = await web3.eth.getBalance(account2);
    await governorV2.methods.executeProposal(id, 0).send({ from: accounts[0], value: amountToDeposit });
    assert.equal(await web3.eth.getBalance(account2), toBN(startingBalance).add(toBN(amountToDeposit)).toString());
  });

  it("Proposer did not send exact amount of ETH to execute payable transaction", async function () {
    const amountToDeposit = toWei("1");

    // Send the proposal to send ETH to account2.
    const id = await governorV2.methods.numProposals().call();
    await governorV2.methods
      .propose([{ to: account2, value: amountToDeposit, data: web3.utils.hexToBytes("0x") }], defaultAncillaryData)
      .send({ from: accounts[0] });

    await moveToNextRound(voting, accounts[0]);
    const roundId = await voting.methods.getCurrentRoundId().call();
    const pendingRequests = await voting.methods.getPendingRequests().call();
    const request = { ...pendingRequests[0], identifier: padRight(pendingRequests[0].identifier, 64) };

    // Vote the proposal through.
    const vote = toWei("1");
    const salt = getRandomSignedInt();
    const hash = computeVoteHashAncillary({
      price: vote,
      salt,
      account: proposer,
      time: request.time,
      roundId,
      identifier: request.identifier,
      ancillaryData: defaultAncillaryData,
    });
    await voting.methods
      .commitVote(request.identifier, request.time, defaultAncillaryData, hash)
      .send({ from: accounts[0] });
    await moveToNextPhase(voting, accounts[0]);
    await voting.methods.snapshotCurrentRound(signature).send({ from: accounts[0] });
    await voting.methods
      .revealVote(request.identifier, request.time, vote, defaultAncillaryData, salt)
      .send({ from: accounts[0] });
    await moveToNextRound(voting, accounts[0]);

    const startingBalance = await web3.eth.getBalance(account2);
    // Sent too little ETH.
    assert(
      await didContractThrow(governorV2.methods.executeProposal(id, 0).send({ from: accounts[0], value: toWei("0.9") }))
    );
    // Sent too much ETH.
    assert(
      await didContractThrow(governorV2.methods.executeProposal(id, 0).send({ from: accounts[0], value: toWei("1.1") }))
    );
    assert.equal(await web3.eth.getBalance(account2), startingBalance);
  });

  it("Successful multi-transaction proposal", async function () {
    // Issue some test tokens to the governorV2 address.
    await testToken.methods.allocateTo(governorV2.options.address, toWei("2")).send({ from: accounts[0] });

    // Construct two transactions to send the newly minted tokens to different accounts.
    const txnData1 = constructTransferTransaction(proposer, toWei("1"));
    const txnData2 = constructTransferTransaction(account2, toWei("1"));

    // Send the proposal with multiple transactions.
    const id = await governorV2.methods.numProposals().call();
    await governorV2.methods
      .propose(
        [
          { to: testToken.options.address, value: 0, data: txnData1 },
          { to: testToken.options.address, value: 0, data: txnData2 },
        ],
        defaultAncillaryData
      )
      .send({ from: accounts[0] });

    await moveToNextRound(voting, accounts[0]);
    const roundId = await voting.methods.getCurrentRoundId().call();
    const pendingRequests = await voting.methods.getPendingRequests().call();
    const request = { ...pendingRequests[0], identifier: padRight(pendingRequests[0].identifier, 64) };

    // Vote the proposal through.
    const vote = toWei("1");
    const salt = getRandomSignedInt();
    const hash = computeVoteHashAncillary({
      price: vote,
      salt,
      account: proposer,
      time: request.time,
      roundId,
      identifier: request.identifier,
      ancillaryData: defaultAncillaryData,
    });
    await voting.methods
      .commitVote(request.identifier, request.time, defaultAncillaryData, hash)
      .send({ from: accounts[0] });
    await moveToNextPhase(voting, accounts[0]);
    await voting.methods.snapshotCurrentRound(signature).send({ from: accounts[0] });
    await voting.methods
      .revealVote(request.identifier, request.time, vote, defaultAncillaryData, salt)
      .send({ from: accounts[0] });
    await moveToNextRound(voting, accounts[0]);

    // Check to make sure that the tokens get transferred at the time of each successive execution.
    const startingBalance1 = toBN(await testToken.methods.balanceOf(proposer).call());
    await governorV2.methods.executeProposal(id, 0).send({ from: accounts[0] });
    assert.equal(
      (await testToken.methods.balanceOf(proposer).call()).toString(),
      startingBalance1.add(toBN(toWei("1"))).toString()
    );

    const startingBalance2 = toBN(await testToken.methods.balanceOf(account2).call());
    await governorV2.methods.executeProposal(id, 1).send({ from: accounts[0] });
    assert.equal(
      (await testToken.methods.balanceOf(account2).call()).toString(),
      startingBalance2.add(toBN(toWei("1"))).toString()
    );
  });

  it("No repeated executions", async function () {
    // Setup
    const txnData = constructTransferTransaction(proposer, "0");
    const id = await governorV2.methods.numProposals().call();
    await governorV2.methods
      .propose([{ to: testToken.options.address, value: 0, data: txnData }], defaultAncillaryData)
      .send({ from: accounts[0] });
    await moveToNextRound(voting, accounts[0]);
    const roundId = await voting.methods.getCurrentRoundId().call();
    const pendingRequests = await voting.methods.getPendingRequests().call();
    const request = { ...pendingRequests[0], identifier: padRight(pendingRequests[0].identifier, 64) };

    // Vote the proposal through.
    const vote = toWei("1");
    const salt = getRandomSignedInt();
    const hash = computeVoteHashAncillary({
      price: vote,
      salt,
      account: proposer,
      time: request.time,
      roundId,
      identifier: request.identifier,
      ancillaryData: defaultAncillaryData,
    });
    await voting.methods
      .commitVote(request.identifier, request.time, defaultAncillaryData, hash)
      .send({ from: accounts[0] });
    await moveToNextPhase(voting, accounts[0]);
    await voting.methods.snapshotCurrentRound(signature).send({ from: accounts[0] });
    await voting.methods
      .revealVote(request.identifier, request.time, vote, defaultAncillaryData, salt)
      .send({ from: accounts[0] });
    await moveToNextRound(voting, accounts[0]);

    // First execution should succeed.
    await governorV2.methods.executeProposal(id, 0).send({ from: accounts[0] });

    // Second should fail.
    assert(await didContractThrow(governorV2.methods.executeProposal(id, 0).send({ from: accounts[0] })));
  });

  it("No out of order executions", async function () {
    // Setup
    const txnData = constructTransferTransaction(proposer, "0");
    const id = await governorV2.methods.numProposals().call();
    await governorV2.methods
      .propose(
        [
          { to: testToken.options.address, value: 0, data: txnData },
          { to: testToken.options.address, value: 0, data: txnData },
        ],
        defaultAncillaryData
      )
      .send({ from: accounts[0] });
    await moveToNextRound(voting, accounts[0]);
    const roundId = await voting.methods.getCurrentRoundId().call();
    const pendingRequests = await voting.methods.getPendingRequests().call();
    const request = { ...pendingRequests[0], identifier: padRight(pendingRequests[0].identifier, 64) };

    // Vote the proposal through.
    const vote = toWei("1");
    const salt = getRandomSignedInt();
    const hash = computeVoteHashAncillary({
      price: vote,
      salt,
      account: proposer,
      time: request.time,
      roundId,
      identifier: request.identifier,
      ancillaryData: defaultAncillaryData,
    });
    await voting.methods
      .commitVote(request.identifier, request.time, defaultAncillaryData, hash)
      .send({ from: accounts[0] });
    await moveToNextPhase(voting, accounts[0]);
    await voting.methods.snapshotCurrentRound(signature).send({ from: accounts[0] });
    await voting.methods
      .revealVote(request.identifier, request.time, vote, defaultAncillaryData, salt)
      .send({ from: accounts[0] });
    await moveToNextRound(voting, accounts[0]);

    // Index 1 cannot be executed before index 0.
    assert(await didContractThrow(governorV2.methods.executeProposal(id, 1).send({ from: accounts[0] })));

    // Once done in order, both should succeed.
    await governorV2.methods.executeProposal(id, 0).send({ from: accounts[0] });
    await governorV2.methods.executeProposal(id, 1).send({ from: accounts[0] });
  });

  it("Unsuccessful proposal", async function () {
    // Issue some test tokens to the governorV2 address.
    await testToken.methods.allocateTo(governorV2.options.address, toWei("1")).send({ from: accounts[0] });

    // Construct the transaction data to send the newly minted tokens to proposer.
    const txnData = constructTransferTransaction(proposer, toWei("1"));

    // Send the proposal.
    const id = await governorV2.methods.numProposals().call();
    await governorV2.methods
      .propose([{ to: testToken.options.address, value: 0, data: txnData }], defaultAncillaryData)
      .send({ from: accounts[0] });
    await moveToNextRound(voting, accounts[0]);
    const roundId = await voting.methods.getCurrentRoundId().call();
    const pendingRequests = await voting.methods.getPendingRequests().call();
    const request = { ...pendingRequests[0], identifier: padRight(pendingRequests[0].identifier, 64) };

    // Vote down the proposal.
    const vote = "0";
    const salt = getRandomSignedInt();
    const hash = computeVoteHashAncillary({
      price: vote,
      salt,
      account: proposer,
      time: request.time,
      roundId,
      identifier: request.identifier,
      ancillaryData: defaultAncillaryData,
    });
    await voting.methods
      .commitVote(request.identifier, request.time, defaultAncillaryData, hash)
      .send({ from: accounts[0] });
    await moveToNextPhase(voting, accounts[0]);
    await voting.methods.snapshotCurrentRound(signature).send({ from: accounts[0] });
    await voting.methods
      .revealVote(request.identifier, request.time, vote, defaultAncillaryData, salt)
      .send({ from: accounts[0] });
    await moveToNextRound(voting, accounts[0]);

    // Check to make sure that the execution fails and no tokens get transferred.
    const startingBalance = await testToken.methods.balanceOf(proposer).call();
    assert(await didContractThrow(governorV2.methods.executeProposal(id, 0).send({ from: accounts[0] })));
    assert.equal((await testToken.methods.balanceOf(proposer).call()).toString(), startingBalance.toString());
  });

  it("Unresolved vote", async function () {
    // Issue some test tokens to the governorV2 address.
    await testToken.methods.allocateTo(governorV2.options.address, toWei("1")).send({ from: accounts[0] });

    // Construct the transaction data to send the newly minted tokens to proposer.
    const txnData = constructTransferTransaction(proposer, toWei("1"));

    // Send the proposal.
    const id = await governorV2.methods.numProposals().call();
    await governorV2.methods
      .propose([{ to: testToken.options.address, value: 0, data: txnData }], defaultAncillaryData)
      .send({ from: accounts[0] });
    await moveToNextRound(voting, accounts[0]);
    let roundId = await voting.methods.getCurrentRoundId().call();
    const pendingRequests = await voting.methods.getPendingRequests().call();
    const request = { ...pendingRequests[0], identifier: padRight(pendingRequests[0].identifier, 64) };

    // Vote on the proposal, but don't reach the GAT.
    const vote = toWei("1");
    const salt = getRandomSignedInt();
    const hash3 = computeVoteHashAncillary({
      price: vote,
      salt,
      account: account3,
      time: request.time,
      roundId,
      identifier: request.identifier,
      ancillaryData: defaultAncillaryData,
    });
    await voting.methods
      .commitVote(request.identifier, request.time, defaultAncillaryData, hash3)
      .send({ from: account3 });
    await moveToNextPhase(voting, accounts[0]);
    await voting.methods.snapshotCurrentRound(signature).send({ from: accounts[0] });
    await voting.methods
      .revealVote(request.identifier, request.time, vote, defaultAncillaryData, salt)
      .send({ from: account3 });
    await moveToNextRound(voting, accounts[0]);

    // Check to make sure that the execution fails and no tokens get transferred.
    const startingBalance = await testToken.methods.balanceOf(proposer).call();
    assert(await didContractThrow(governorV2.methods.executeProposal(id, 0).send({ from: accounts[0] })));
    assert.equal((await testToken.methods.balanceOf(proposer).call()).toString(), startingBalance.toString());

    // Resolve the vote to clean up.
    roundId = await voting.methods.getCurrentRoundId().call();
    const hash1 = computeVoteHashAncillary({
      price: vote,
      salt,
      account: proposer,
      time: request.time,
      roundId,
      identifier: request.identifier,
      ancillaryData: defaultAncillaryData,
    });
    await voting.methods
      .commitVote(request.identifier, request.time, defaultAncillaryData, hash1)
      .send({ from: accounts[0] });
    await moveToNextPhase(voting, accounts[0]);
    await voting.methods.snapshotCurrentRound(signature).send({ from: accounts[0] });
    await voting.methods
      .revealVote(request.identifier, request.time, vote, defaultAncillaryData, salt)
      .send({ from: accounts[0] });
    await moveToNextRound(voting, accounts[0]);
  });

  it("Failed transaction", async function () {
    // Construct a transaction that will obviously fail.
    const txnData = constructTransferTransaction(proposer, toWei("1000"));

    // Send the proposal.
    const id = await governorV2.methods.numProposals().call();
    await governorV2.methods
      .propose([{ to: testToken.options.address, value: 0, data: txnData }], defaultAncillaryData)
      .send({ from: accounts[0] });
    await moveToNextRound(voting, accounts[0]);
    const roundId = await voting.methods.getCurrentRoundId().call();
    const pendingRequests = await voting.methods.getPendingRequests().call();
    const request = { ...pendingRequests[0], identifier: padRight(pendingRequests[0].identifier, 64) };

    // Vote the proposal through.
    const vote = toWei("1");
    const salt = getRandomSignedInt();
    const hash = computeVoteHashAncillary({
      price: vote,
      salt,
      account: proposer,
      time: request.time,
      roundId,
      identifier: request.identifier,
      ancillaryData: defaultAncillaryData,
    });
    await voting.methods
      .commitVote(request.identifier, request.time, defaultAncillaryData, hash)
      .send({ from: accounts[0] });
    await moveToNextPhase(voting, accounts[0]);
    await voting.methods.snapshotCurrentRound(signature).send({ from: accounts[0] });
    await voting.methods
      .revealVote(request.identifier, request.time, vote, defaultAncillaryData, salt)
      .send({ from: accounts[0] });
    await moveToNextRound(voting, accounts[0]);

    // Check to make sure that the execution fails and no tokens get transferred.
    const startingBalance = await testToken.methods.balanceOf(proposer).call();
    assert(await didContractThrow(governorV2.methods.executeProposal(id, 0).send({ from: accounts[0] })));
    assert.equal((await testToken.methods.balanceOf(proposer).call()).toString(), startingBalance.toString());
  });

  it("Events", async function () {
    // Construct the transaction data to send the newly minted tokens to proposer.
    const txnData = constructTransferTransaction(proposer, toWei("0"));

    // Send the proposal and verify that an event is produced.
    const id = await governorV2.methods.numProposals().call();
    let receipt = await governorV2.methods
      .propose([{ to: testToken.options.address, value: 0, data: txnData }], defaultAncillaryData)
      .send({ from: accounts[0] });
    await assertEventEmitted(receipt, governorV2, "NewProposal", (ev) => {
      return (
        ev.id.toString() === id.toString() &&
        ev.transactions.length === 1 &&
        ev.transactions[0].to === testToken.options.address &&
        ev.transactions[0].value.toString() === "0" &&
        ev.transactions[0].data === txnData
      );
    });

    // Vote the proposal through.
    await moveToNextRound(voting, accounts[0]);
    const roundId = await voting.methods.getCurrentRoundId().call();
    const pendingRequests = await voting.methods.getPendingRequests().call();
    const request = { ...pendingRequests[0], identifier: padRight(pendingRequests[0].identifier, 64) };
    const vote = toWei("1");
    const salt = getRandomSignedInt();
    const hash = computeVoteHashAncillary({
      price: vote,
      salt,
      account: proposer,
      time: request.time,
      roundId,
      identifier: request.identifier,
      ancillaryData: defaultAncillaryData,
    });
    await voting.methods
      .commitVote(request.identifier, request.time, defaultAncillaryData, hash)
      .send({ from: accounts[0] });
    await moveToNextPhase(voting, accounts[0]);
    await voting.methods.snapshotCurrentRound(signature).send({ from: accounts[0] });
    await voting.methods
      .revealVote(request.identifier, request.time, vote, defaultAncillaryData, salt)
      .send({ from: accounts[0] });
    await moveToNextRound(voting, accounts[0]);

    // Verify execute event.
    receipt = await governorV2.methods.executeProposal(id, 0).send({ from: accounts[0] });
    await assertEventEmitted(receipt, governorV2, "ProposalExecuted", (ev) => {
      return ev.id.toString() === id.toString() && ev.transactionIndex.toString() === "0";
    });
  });

  it("No re-entrant execution", async function () {
    // Send the proposal and verify that an event is produced.
    const id = await governorV2.methods.numProposals().call();

    // Construct the transaction that we want to re-enter and pass the txn data to the ReentrancyChecker.
    const txnData = governorV2.methods.executeProposal(id.toString(), "0").encodeABI();
    const reentrancyChecker = await ReentrancyChecker.new().send({ from: accounts[0] });
    await reentrancyChecker.methods.setTransactionData(txnData).send({ from: accounts[0] });

    // Propose the reentrant transaction.
    await governorV2.methods
      .propose(
        [
          {
            to: reentrancyChecker.options.address,
            value: 0,
            data: constructTransferTransaction(account2, toWei("0")), // Data doesn't since it will hit the fallback regardless.
          },
        ],
        defaultAncillaryData
      )
      .send({ from: accounts[0] });

    // Vote the proposal through.
    await moveToNextRound(voting, accounts[0]);
    const roundId = await voting.methods.getCurrentRoundId().call();
    const pendingRequests = await voting.methods.getPendingRequests().call();
    const request = { ...pendingRequests[0], identifier: padRight(pendingRequests[0].identifier, 64) };
    const vote = toWei("1");
    const salt = getRandomSignedInt();
    const hash = computeVoteHashAncillary({
      price: vote,
      salt,
      account: proposer,
      time: request.time,
      roundId,
      identifier: request.identifier,
      ancillaryData: defaultAncillaryData,
    });
    await voting.methods
      .commitVote(request.identifier, request.time, defaultAncillaryData, hash)
      .send({ from: accounts[0] });
    await moveToNextPhase(voting, accounts[0]);
    await voting.methods.snapshotCurrentRound(signature).send({ from: accounts[0] });
    await voting.methods
      .revealVote(request.identifier, request.time, vote, defaultAncillaryData, salt)
      .send({ from: accounts[0] });
    await moveToNextRound(voting, accounts[0]);

    // Since we're using the reentrancy checker, this transaction should FAIL if the reentrancy is successful.
    await governorV2.methods.executeProposal(id, 0).send({ from: accounts[0] });
  });

  it("Starting id > 0", async function () {
    // Set arbitrary starting id.
    const startingId = 910284;

    // Create new governorV2 contract.
    finder = await Finder.deployed();
    const newGovernor = await GovernorV2.new(finder.options.address, startingId, timer.options.address).send({
      from: proposer,
    });

    const newVoting = await VotingV2.new(
      "640000000000000000", // emission rate
      60 * 60 * 24 * 30, // unstakeCooldown
      "86400", // phase length
      "7200", // minRollToNextRoundLength
      { rawValue: web3.utils.toWei("0.05") }, // 5% GAT
      votingToken.options.address, // voting token
      (await Finder.deployed()).options.address, // finder
      (await Timer.deployed()).options.address, // timer
      (await SlashingLibrary.deployed()).options.address // slashing library
    ).send({ from: accounts[0] });

    await newVoting.methods.transferOwnership(newGovernor.options.address).send({ from: accounts[0] });

    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Oracle), newVoting.options.address)
      .send({ from: accounts[0] });

    await votingToken.methods.approve(newVoting.options.address, toWei("20000000")).send({ from: proposer });
    await newVoting.methods.stake(toWei("20000000")).send({ from: proposer });
    await votingToken.methods.transfer(account2, toWei("20000000")).send({ from: accounts[0] });
    await votingToken.methods.approve(newVoting.options.address, toWei("20000000")).send({ from: account2 });
    await newVoting.methods.stake(toWei("20000000")).send({ from: account2 });

    // Approve the new governorV2 in the Registry.
    const registry = await Registry.deployed();
    await registry.methods.addMember(RegistryRolesEnum.CONTRACT_CREATOR, accounts[0]).send({ from: accounts[0] });
    await registry.methods.registerContract([], newGovernor.options.address).send({ from: accounts[0] });
    await registry.methods.removeMember(RegistryRolesEnum.CONTRACT_CREATOR, accounts[0]).send({ from: accounts[0] });
    const identifierWhitelist = await IdentifierWhitelist.new().send({ from: accounts[0] });
    await identifierWhitelist.methods.transferOwnership(newGovernor.options.address).send({ from: accounts[0] });

    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.IdentifierWhitelist), identifierWhitelist.options.address)
      .send({ from: accounts[0] });

    // The number of proposals should be equal to the starting id.
    assert.equal((await newGovernor.methods.numProposals().call()).toString(), startingId.toString());

    const proposal0 = await newGovernor.methods.getProposal(0).call();
    const proposalRandom = await newGovernor.methods.getProposal(123456).call();
    const proposalLast = await newGovernor.methods.getProposal(startingId - 1).call();

    // Ensure that all previous proposals have no transaction data.
    assert.equal(proposal0.transactions.length, 0);
    assert.equal(proposalRandom.transactions.length, 0);
    assert.equal(proposalLast.transactions.length, 0);

    // Check that all roles are filled by the deployer.
    assert.equal(await newGovernor.methods.getMember(0).call(), proposer);
    assert.equal(await newGovernor.methods.getMember(1).call(), proposer);

    // Issue some test tokens to the governorV2 address.
    await testToken.methods.allocateTo(newGovernor.options.address, toWei("1")).send({ from: accounts[0] });

    // Construct the transaction data to send the newly minted tokens to proposer.
    const txnData = constructTransferTransaction(proposer, toWei("1"));

    await newGovernor.methods
      .propose([{ to: testToken.options.address, value: 0, data: txnData }], defaultAncillaryData)
      .send({ from: accounts[0] });

    // Check that the proposal is correct.
    const proposal = await newGovernor.methods.getProposal(startingId).call();
    assert.equal(proposal.transactions.length, 1);
    assert.equal(proposal.transactions[0].to, testToken.options.address);
    assert.equal(proposal.transactions[0].value.toString(), "0");
    assert.equal(proposal.transactions[0].data, txnData);
    assert.equal(proposal.requestTime.toString(), (await newGovernor.methods.getCurrentTime().call()).toString());

    await moveToNextRound(newVoting, accounts[0]);
    const roundId = await newVoting.methods.getCurrentRoundId().call();
    const pendingRequests = await newVoting.methods.getPendingRequests().call();
    const request = { ...pendingRequests[0], identifier: padRight(pendingRequests[0].identifier, 64) };

    // Vote the proposal through.
    const vote = toWei("1");
    const salt = getRandomSignedInt();
    const hash = computeVoteHashAncillary({
      price: vote,
      salt,
      account: proposer,
      time: request.time,
      roundId,
      identifier: request.identifier,
      ancillaryData: defaultAncillaryData,
    });
    await newVoting.methods
      .commitVote(request.identifier, request.time, defaultAncillaryData, hash)
      .send({ from: accounts[0] });
    await moveToNextPhase(newVoting, accounts[0]);
    await newVoting.methods.snapshotCurrentRound(signature).send({ from: accounts[0] });
    await newVoting.methods
      .revealVote(request.identifier, request.time, vote, defaultAncillaryData, salt)
      .send({ from: accounts[0] });
    await moveToNextRound(newVoting, accounts[0]);

    // Check to make sure that the tokens get transferred at the time of execution.
    const startingBalance = toBN(await testToken.methods.balanceOf(proposer).call());
    await newGovernor.methods.executeProposal(startingId, 0).send({ from: accounts[0] });
    assert.equal(
      (await testToken.methods.balanceOf(proposer).call()).toString(),
      startingBalance.add(toBN(toWei("1"))).toString()
    );

    // Reset IdentifierWhitelist implementation as to not interfere with other tests.
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.IdentifierWhitelist), supportedIdentifiers.options.address)
      .send({ from: accounts[0] });
  });

  it("startingId size", async function () {
    // Starting id of 10^18 is the upper limit -- that should be the largest that will work.
    await GovernorV2.new(finder.options.address, toWei("1"), timer.options.address).send({ from: proposer });

    // Anything above 10^18 is rejected.
    assert(
      await didContractThrow(
        GovernorV2.new(finder.options.address, toWei("1.1"), timer.options.address).send({ from: proposer })
      )
    );
  });

  // _uintToUtf8() tests.
  it("Low-level _uintToUtf8(): 0 input", async function () {
    const governorTest = await GovernorTest.new(timer.options.address).send({ from: accounts[0] });

    const input = "0";
    const output = await governorTest.methods.uintToUtf8(input).call();

    assert.equal(hexToUtf8(output), "0");
  });

  it("Low-level _uintToUtf8(): nonzero input", async function () {
    const governorTest = await GovernorTest.new(timer.options.address).send({ from: accounts[0] });

    // Arbitrary nonzero input.
    const input = "177203972462008655";
    const output = await governorTest.methods.uintToUtf8(input).call();

    assert.equal(hexToUtf8(output), input);
  });

  it("Low-level _uintToUtf8(): largest input before truncation", async function () {
    const governorTest = await GovernorTest.new(timer.options.address).send({ from: accounts[0] });

    // The largest representable number in 32 digits is 32 9s.
    const input = "9".repeat(32);
    const output = await governorTest.methods.uintToUtf8(input).call();

    assert.equal(hexToUtf8(output), input);
  });

  it("Low-level _uintToUtf8(): truncates at least significant digit", async function () {
    const governorTest = await GovernorTest.new(timer.options.address).send({ from: accounts[0] });

    // The smallest number to be truncated is 1 followed by 32 0s.
    const input = "1" + "0".repeat(32);

    // Remove the last 0 to emulate truncation.
    const expectedOutput = "1" + "0".repeat(31);

    const output = await governorTest.methods.uintToUtf8(input).call();

    assert.equal(hexToUtf8(output), expectedOutput);
  });

  // _addPrefix() tests.
  it("Low-level _addPrefix(): no truncation", async function () {
    const governorTest = await GovernorTest.new(timer.options.address).send({ from: accounts[0] });

    const input = utf8ToHex("input");
    const prefix = utf8ToHex("prefix ");
    const prefixLength = "7";
    const output = await governorTest.methods.addPrefix(input, prefix, prefixLength).call();

    assert.equal(hexToUtf8(output), "prefix input");
  });

  it("Low-level _addPrefix(): output truncation", async function () {
    const governorTest = await GovernorTest.new(timer.options.address).send({ from: accounts[0] });

    // Prefix output cannot be longer than 32 characters or the function will truncate.
    const input = utf8ToHex(" truncated");

    // A prefix of 23 characters will cause the last character of the 10 character input to be removed from the output.
    const prefixString = "a".repeat(23);
    const prefix = utf8ToHex(prefixString);
    const prefixLength = "23";
    const output = await governorTest.methods.addPrefix(input, prefix, prefixLength).call();

    assert.equal(hexToUtf8(output), `${prefixString} truncate`);
  });

  // _constructIdentifier() tests.
  it("Low-level _constructIdentifier(): normal proposal id", async function () {
    const governorTest = await GovernorTest.new(timer.options.address).send({ from: accounts[0] });

    // Construct an arbitrary identifier.
    const proposalId = "1234567890";
    const identifier = await governorTest.methods.constructIdentifier(proposalId).call();

    assert.equal(hexToUtf8(identifier), `Admin ${proposalId}`);
  });

  it("Low-level _constructIdentifier(): correctly identifier for 26 characters", async function () {
    const governorTest = await GovernorTest.new(timer.options.address).send({ from: accounts[0] });

    // Identifiers can be 32 digits long.
    // Since the identifier must start with "Admin " (6 characters), the number can only be 26 digits or fewer.
    // The max number that can be represented, then, is 10^26 - 1.
    const maxIdValue = "9".repeat(26);
    const identifier = await governorTest.methods.constructIdentifier(maxIdValue).call();

    assert.equal(hexToUtf8(identifier), `Admin ${maxIdValue}`);
  });

  it("Low-level _constructIdentifier(): proposal id truncates after 26 characters", async function () {
    const governorTest = await GovernorTest.new(timer.options.address).send({ from: accounts[0] });

    // Identifiers can be 32 digits long.
    // Since the identifier must start with "Admin " (6 characters), the number can only be 26 digits or fewer.
    // 10^26, then is above the max and will be truncated.
    const aboveMaxIdValue = "1" + "0".repeat(26);

    // Expected output truncates the last 0.
    const expectedOutputIdValue = "1" + "0".repeat(25);

    const identifier = await governorTest.methods.constructIdentifier(aboveMaxIdValue).call();

    assert.equal(hexToUtf8(identifier), `Admin ${expectedOutputIdValue}`);
  });
});

const { didContractThrow } = require("../../../common/SolidityTestUtils.js");
const { getRandomUnsignedInt } = require("../../../common/Random.js");
const { moveToNextRound, moveToNextPhase } = require("../../utils/Voting.js");
const { interfaceName } = require("../../utils/Constants.js");
const { computeVoteHash } = require("../../../common/EncryptionHelper");
const { RegistryRolesEnum } = require("../../../common/Enums.js");
const truffleAssert = require("truffle-assertions");

const Governor = artifacts.require("Governor");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const Voting = artifacts.require("Voting");
const VotingToken = artifacts.require("VotingToken");
const TestnetERC20 = artifacts.require("TestnetERC20");
const ReentrancyChecker = artifacts.require("ReentrancyChecker");
const GovernorTest = artifacts.require("GovernorTest");
const Timer = artifacts.require("Timer");
const Registry = artifacts.require("Registry");
const Finder = artifacts.require("Finder");

// Extract web3 functions into primary namespace.
const { toBN, toWei, hexToUtf8, randomHex, utf8ToHex } = web3.utils;

contract("Governor", function(accounts) {
  let voting;
  let governor;
  let testToken;
  let supportedIdentifiers;

  const proposer = accounts[0];
  const account2 = accounts[1];

  const setNewInflationRate = async inflationRate => {
    await voting.setInflationRate({ rawValue: inflationRate.toString() });
  };

  const constructTransferTransaction = (destination, amount) => {
    return testToken.contract.methods.transfer(destination, amount).encodeABI();
  };

  before(async function() {
    voting = await Voting.deployed();
    supportedIdentifiers = await IdentifierWhitelist.deployed();
    governor = await Governor.deployed();
    testToken = await TestnetERC20.deployed();
    let votingToken = await VotingToken.deployed();

    // Allow proposer to mint tokens.
    const minterRole = 1;
    await votingToken.addMember(minterRole, proposer);

    // Mint 99 tokens to this account so it has 99% of the tokens.
    await votingToken.mint(proposer, toWei("99", "ether"));

    // Mint 1 token to this account so it has 1% of the tokens (not enough to reach the GAT).
    await votingToken.mint(account2, toWei("1", "ether"));

    // Set the inflation rate to 0 by default, so the balances stay fixed.
    await setNewInflationRate("0");

    // To work, the governor must be the owner of the IdentifierWhitelist contracts. This is not the default setup in the test
    // environment, so ownership must be transferred.
    await supportedIdentifiers.transferOwnership(governor.address);
  });

  beforeEach(async function() {
    // Make sure the governor time and voting time are aligned before each test case.
    let currentTime = await voting.getCurrentTime();
    await governor.setCurrentTime(currentTime);
  });

  it("Proposal permissions", async function() {
    const txnData = constructTransferTransaction(proposer, "0");
    assert(
      await didContractThrow(
        governor.propose(
          [
            {
              to: testToken.address,
              value: 0,
              data: txnData
            }
          ],
          { from: account2 }
        )
      )
    );
  });

  it("Cannot send to 0x0", async function() {
    const txnData = constructTransferTransaction(proposer, "0");

    const zeroAddress = "0x0000000000000000000000000000000000000000";
    assert(
      await didContractThrow(
        governor.propose([
          {
            to: zeroAddress,
            value: 0,
            data: txnData
          }
        ])
      )
    );

    assert(
      await didContractThrow(
        governor.propose([
          {
            to: testToken.address,
            value: 0,
            data: txnData
          },
          {
            to: zeroAddress,
            value: 0,
            data: txnData
          }
        ])
      )
    );
  });

  it("Cannot send transaction with data to EOA", async function() {
    const txnData = constructTransferTransaction(proposer, "0");
    // A proposal with data should not be able to be sent to an EOA as only a contract can process data in a tx.
    assert(
      await didContractThrow(
        governor.propose([
          {
            to: account2,
            value: 0,
            data: txnData
          }
        ])
      )
    );
  });

  it("Identifier construction", async function() {
    // Construct the transaction to send 0 tokens.
    const txnData = constructTransferTransaction(proposer, "0");

    // The id is the number of proposals before sending.
    const id1 = await governor.numProposals();

    // Send the proposal.
    await governor.propose([
      {
        to: testToken.address,
        value: 0,
        data: txnData
      }
    ]);

    // Send a second proposal. Note: a second proposal is necessary to ensure we test at least one nonzero id.
    const id2 = await governor.numProposals();
    await governor.propose([
      {
        to: testToken.address,
        value: 0,
        data: txnData
      }
    ]);

    // The proposals should show up in the pending requests in the *next* round.
    await moveToNextRound(voting);
    const roundId = await voting.getCurrentRoundId();
    const pendingRequests = await voting.getPendingRequests();

    // Check that the proposals shows up and that the identifiers are constructed correctly.
    assert.equal(pendingRequests.length, 2);
    const request1 = pendingRequests[0];
    const request2 = pendingRequests[1];
    assert.equal(web3.utils.hexToUtf8(request1.identifier), `Admin ${id1}`);
    assert.equal(web3.utils.hexToUtf8(request2.identifier), `Admin ${id2}`);

    // Execute the proposals to clean up.
    const vote = toWei("1");
    const salt = getRandomUnsignedInt();
    const hash1 = computeVoteHash({
      price: vote,
      salt,
      account: proposer,
      time: request1.time,
      roundId,
      identifier: request1.identifier
    });
    const hash2 = computeVoteHash({
      price: vote,
      salt,
      account: proposer,
      time: request2.time,
      roundId,
      identifier: request2.identifier
    });
    await voting.commitVote(request1.identifier, request1.time, hash1);
    await voting.commitVote(request2.identifier, request2.time, hash2);
    await moveToNextPhase(voting);
    await voting.revealVote(request1.identifier, request1.time, vote, salt);
    await voting.revealVote(request2.identifier, request2.time, vote, salt);
    await moveToNextRound(voting);
    await governor.executeProposal(id1, 0);
    await governor.executeProposal(id2, 0);
  });

  it("Successful proposal", async function() {
    // Issue some test tokens to the governor address.
    await testToken.allocateTo(governor.address, toWei("1"));

    // Construct the transaction data to send the newly minted tokens to proposer.
    const txnData = constructTransferTransaction(proposer, toWei("1"));

    // Send the proposal.
    const id = await governor.numProposals();
    await governor.propose([
      {
        to: testToken.address,
        value: 0,
        data: txnData
      }
    ]);
    await moveToNextRound(voting);
    const roundId = await voting.getCurrentRoundId();
    const pendingRequests = await voting.getPendingRequests();
    const request = pendingRequests[0];

    // Vote the proposal through.
    const vote = toWei("1");
    const salt = getRandomUnsignedInt();
    const hash = computeVoteHash({
      price: vote,
      salt,
      account: proposer,
      time: request.time,
      roundId,
      identifier: request.identifier
    });
    await voting.commitVote(request.identifier, request.time, hash);
    await moveToNextPhase(voting);
    await voting.revealVote(request.identifier, request.time, vote, salt);
    await moveToNextRound(voting);

    // Cannot send ETH to execute a transaction that requires 0 ETH.
    assert(await didContractThrow(governor.executeProposal(id, 0, { value: toWei("1") })));

    // Check to make sure that the tokens get transferred at the time of execution.
    const startingBalance = await testToken.balanceOf(proposer);
    await governor.executeProposal(id, 0);
    assert.equal((await testToken.balanceOf(proposer)).toString(), startingBalance.add(toBN(toWei("1"))).toString());
  });

  it("Successful proposal that requires ETH", async function() {
    const amountToDeposit = toWei("1");

    // Send the proposal to send ETH to account2.
    const id = await governor.numProposals();
    await governor.propose([
      {
        to: account2,
        value: amountToDeposit,
        data: web3.utils.hexToBytes("0x") // "0x" is an empty bytes array to indicate no data tx.
      }
    ]);

    await moveToNextRound(voting);
    const roundId = await voting.getCurrentRoundId();
    const pendingRequests = await voting.getPendingRequests();
    const request = pendingRequests[0];

    // Vote the proposal through.
    const vote = toWei("1");
    const salt = getRandomUnsignedInt();
    const hash = computeVoteHash({
      price: vote,
      salt,
      account: proposer,
      time: request.time,
      roundId,
      identifier: request.identifier
    });
    await voting.commitVote(request.identifier, request.time, hash);
    await moveToNextPhase(voting);
    await voting.revealVote(request.identifier, request.time, vote, salt);
    await moveToNextRound(voting);

    // Execute the proposal and simultaneously deposit ETH to pay for the transaction.
    // Check to make sure that the ETH gets transferred at the time of execution.
    const startingBalance = await web3.eth.getBalance(account2);
    await governor.executeProposal(id, 0, { value: amountToDeposit });
    assert.equal(
      await web3.eth.getBalance(account2),
      toBN(startingBalance)
        .add(toBN(amountToDeposit))
        .toString()
    );
  });

  it("Proposer did not send exact amount of ETH to execute payable transaction", async function() {
    const amountToDeposit = toWei("1");

    // Send the proposal to send ETH to account2.
    const id = await governor.numProposals();
    await governor.propose([
      {
        to: account2,
        value: amountToDeposit,
        data: web3.utils.hexToBytes("0x")
      }
    ]);

    await moveToNextRound(voting);
    const roundId = await voting.getCurrentRoundId();
    const pendingRequests = await voting.getPendingRequests();
    const request = pendingRequests[0];

    // Vote the proposal through.
    const vote = toWei("1");
    const salt = getRandomUnsignedInt();
    const hash = computeVoteHash({
      price: vote,
      salt,
      account: proposer,
      time: request.time,
      roundId,
      identifier: request.identifier
    });
    await voting.commitVote(request.identifier, request.time, hash);
    await moveToNextPhase(voting);
    await voting.revealVote(request.identifier, request.time, vote, salt);
    await moveToNextRound(voting);

    const startingBalance = await web3.eth.getBalance(account2);
    // Sent too little ETH.
    assert(await didContractThrow(governor.executeProposal(id, 0, { value: toWei("0.9") })));
    // Sent too much ETH.
    assert(await didContractThrow(governor.executeProposal(id, 0, { value: toWei("1.1") })));
    assert.equal(await web3.eth.getBalance(account2), startingBalance);
  });

  it("Successful multi-transaction proposal", async function() {
    // Issue some test tokens to the governor address.
    await testToken.allocateTo(governor.address, toWei("2"));

    // Construct two transactions to send the newly minted tokens to different accounts.
    const txnData1 = constructTransferTransaction(proposer, toWei("1"));
    const txnData2 = constructTransferTransaction(account2, toWei("1"));

    // Send the proposal with multiple transactions.
    const id = await governor.numProposals();
    await governor.propose([
      {
        to: testToken.address,
        value: 0,
        data: txnData1
      },
      {
        to: testToken.address,
        value: 0,
        data: txnData2
      }
    ]);

    await moveToNextRound(voting);
    const roundId = await voting.getCurrentRoundId();
    const pendingRequests = await voting.getPendingRequests();
    const request = pendingRequests[0];

    // Vote the proposal through.
    const vote = toWei("1");
    const salt = getRandomUnsignedInt();
    const hash = computeVoteHash({
      price: vote,
      salt,
      account: proposer,
      time: request.time,
      roundId,
      identifier: request.identifier
    });
    await voting.commitVote(request.identifier, request.time, hash);
    await moveToNextPhase(voting);
    await voting.revealVote(request.identifier, request.time, vote, salt);
    await moveToNextRound(voting);

    // Check to make sure that the tokens get transferred at the time of each successive execution.
    const startingBalance1 = await testToken.balanceOf(proposer);
    await governor.executeProposal(id, 0);
    assert.equal((await testToken.balanceOf(proposer)).toString(), startingBalance1.add(toBN(toWei("1"))).toString());

    const startingBalance2 = await testToken.balanceOf(account2);
    await governor.executeProposal(id, 1);
    assert.equal((await testToken.balanceOf(account2)).toString(), startingBalance2.add(toBN(toWei("1"))).toString());
  });

  it("No repeated executions", async function() {
    // Setup
    const txnData = constructTransferTransaction(proposer, "0");
    const id = await governor.numProposals();
    await governor.propose([
      {
        to: testToken.address,
        value: 0,
        data: txnData
      }
    ]);
    await moveToNextRound(voting);
    const roundId = await voting.getCurrentRoundId();
    const pendingRequests = await voting.getPendingRequests();
    const request = pendingRequests[0];

    // Vote the proposal through.
    const vote = toWei("1");
    const salt = getRandomUnsignedInt();
    const hash = computeVoteHash({
      price: vote,
      salt,
      account: proposer,
      time: request.time,
      roundId,
      identifier: request.identifier
    });
    await voting.commitVote(request.identifier, request.time, hash);
    await moveToNextPhase(voting);
    await voting.revealVote(request.identifier, request.time, vote, salt);
    await moveToNextRound(voting);

    // First execution should succeed.
    await governor.executeProposal(id, 0);

    // Second should fail.
    assert(await didContractThrow(governor.executeProposal(id, 0)));
  });

  it("No out of order executions", async function() {
    // Setup
    const txnData = constructTransferTransaction(proposer, "0");
    const id = await governor.numProposals();
    await governor.propose([
      {
        to: testToken.address,
        value: 0,
        data: txnData
      },
      {
        to: testToken.address,
        value: 0,
        data: txnData
      }
    ]);
    await moveToNextRound(voting);
    const roundId = await voting.getCurrentRoundId();
    const pendingRequests = await voting.getPendingRequests();
    const request = pendingRequests[0];

    // Vote the proposal through.
    const vote = toWei("1");
    const salt = getRandomUnsignedInt();
    const hash = computeVoteHash({
      price: vote,
      salt,
      account: proposer,
      time: request.time,
      roundId,
      identifier: request.identifier
    });
    await voting.commitVote(request.identifier, request.time, hash);
    await moveToNextPhase(voting);
    await voting.revealVote(request.identifier, request.time, vote, salt);
    await moveToNextRound(voting);

    // Index 1 cannot be executed before index 0.
    assert(await didContractThrow(governor.executeProposal(id, 1)));

    // Once done in order, both should succeed.
    await governor.executeProposal(id, 0);
    await governor.executeProposal(id, 1);
  });

  it("Unsuccessful proposal", async function() {
    // Issue some test tokens to the governor address.
    await testToken.allocateTo(governor.address, toWei("1"));

    // Construct the transaction data to send the newly minted tokens to proposer.
    const txnData = constructTransferTransaction(proposer, toWei("1"));

    // Send the proposal.
    const id = await governor.numProposals();
    await governor.propose([
      {
        to: testToken.address,
        value: 0,
        data: txnData
      }
    ]);
    await moveToNextRound(voting);
    const roundId = await voting.getCurrentRoundId();
    const pendingRequests = await voting.getPendingRequests();
    const request = pendingRequests[0];

    // Vote down the proposal.
    const vote = "0";
    const salt = getRandomUnsignedInt();
    const hash = computeVoteHash({
      price: vote,
      salt,
      account: proposer,
      time: request.time,
      roundId,
      identifier: request.identifier
    });
    await voting.commitVote(request.identifier, request.time, hash);
    await moveToNextPhase(voting);
    await voting.revealVote(request.identifier, request.time, vote, salt);
    await moveToNextRound(voting);

    // Check to make sure that the execution fails and no tokens get transferred.
    const startingBalance = await testToken.balanceOf(proposer);
    assert(await didContractThrow(governor.executeProposal(id, 0)));
    assert.equal((await testToken.balanceOf(proposer)).toString(), startingBalance.toString());
  });

  it("Unresolved vote", async function() {
    // Issue some test tokens to the governor address.
    await testToken.allocateTo(governor.address, toWei("1"));

    // Construct the transaction data to send the newly minted tokens to proposer.
    const txnData = constructTransferTransaction(proposer, toWei("1"));

    // Send the proposal.
    const id = await governor.numProposals();
    await governor.propose([
      {
        to: testToken.address,
        value: 0,
        data: txnData
      }
    ]);
    await moveToNextRound(voting);
    let roundId = await voting.getCurrentRoundId();
    const pendingRequests = await voting.getPendingRequests();
    const request = pendingRequests[0];

    // Vote on the proposal, but don't reach the GAT.
    const vote = toWei("1");
    const salt = getRandomUnsignedInt();
    const hash2 = computeVoteHash({
      price: vote,
      salt,
      account: account2,
      time: request.time,
      roundId,
      identifier: request.identifier
    });
    await voting.commitVote(request.identifier, request.time, hash2, { from: account2 });
    await moveToNextPhase(voting);
    await voting.revealVote(request.identifier, request.time, vote, salt, { from: account2 });
    await moveToNextRound(voting);

    // Check to make sure that the execution fails and no tokens get transferred.
    const startingBalance = await testToken.balanceOf(proposer);
    assert(await didContractThrow(governor.executeProposal(id, 0)));
    assert.equal((await testToken.balanceOf(proposer)).toString(), startingBalance.toString());

    // Resolve the vote to clean up.
    roundId = await voting.getCurrentRoundId();
    const hash1 = computeVoteHash({
      price: vote,
      salt,
      account: proposer,
      time: request.time,
      roundId,
      identifier: request.identifier
    });
    await voting.commitVote(request.identifier, request.time, hash1);
    await moveToNextPhase(voting);
    await voting.revealVote(request.identifier, request.time, vote, salt);
    await moveToNextRound(voting);
  });

  it("Failed transaction", async function() {
    // Construct a transaction that will obviously fail.
    const txnData = constructTransferTransaction(proposer, toWei("1000"));

    // Send the proposal.
    const id = await governor.numProposals();
    await governor.propose([
      {
        to: testToken.address,
        value: 0,
        data: txnData
      }
    ]);
    await moveToNextRound(voting);
    const roundId = await voting.getCurrentRoundId();
    const pendingRequests = await voting.getPendingRequests();
    const request = pendingRequests[0];

    // Vote the proposal through.
    const vote = toWei("1");
    const salt = getRandomUnsignedInt();
    const hash = computeVoteHash({
      price: vote,
      salt,
      account: proposer,
      time: request.time,
      roundId,
      identifier: request.identifier
    });
    await voting.commitVote(request.identifier, request.time, hash);
    await moveToNextPhase(voting);
    await voting.revealVote(request.identifier, request.time, vote, salt);
    await moveToNextRound(voting);

    // Check to make sure that the execution fails and no tokens get transferred.
    const startingBalance = await testToken.balanceOf(proposer);
    assert(await didContractThrow(governor.executeProposal(id, 0)));
    assert.equal((await testToken.balanceOf(proposer)).toString(), startingBalance.toString());
  });

  it("Events", async function() {
    // Construct the transaction data to send the newly minted tokens to proposer.
    const txnData = constructTransferTransaction(proposer, toWei("0"));

    // Send the proposal and verify that an event is produced.
    const id = await governor.numProposals();
    let receipt = await governor.propose([
      {
        to: testToken.address,
        value: 0,
        data: txnData
      }
    ]);
    truffleAssert.eventEmitted(receipt, "NewProposal", ev => {
      return (
        ev.id.toString() === id.toString() &&
        ev.transactions.length === 1 &&
        ev.transactions[0].to === testToken.address &&
        ev.transactions[0].value.toString() === "0" &&
        ev.transactions[0].data === txnData
      );
    });

    // Vote the proposal through.
    await moveToNextRound(voting);
    const roundId = await voting.getCurrentRoundId();
    const pendingRequests = await voting.getPendingRequests();
    const request = pendingRequests[0];
    const vote = toWei("1");
    const salt = getRandomUnsignedInt();
    const hash = computeVoteHash({
      price: vote,
      salt,
      account: proposer,
      time: request.time,
      roundId,
      identifier: request.identifier
    });
    await voting.commitVote(request.identifier, request.time, hash);
    await moveToNextPhase(voting);
    await voting.revealVote(request.identifier, request.time, vote, salt);
    await moveToNextRound(voting);

    // Verify execute event.
    receipt = await governor.executeProposal(id, 0);
    truffleAssert.eventEmitted(receipt, "ProposalExecuted", ev => {
      return ev.id.toString() === id.toString() && ev.transactionIndex.toString() === "0";
    });
  });

  it("No re-entrant execution", async function() {
    // Send the proposal and verify that an event is produced.
    const id = await governor.numProposals();

    // Construct the transaction that we want to re-enter and pass the txn data to the ReentrancyChecker.
    const txnData = governor.contract.methods.executeProposal(id.toString(), "0").encodeABI();
    const reentrancyChecker = await ReentrancyChecker.new();
    await reentrancyChecker.setTransactionData(txnData);

    // Propose the reentrant transaction.
    await governor.propose([
      {
        to: reentrancyChecker.address,
        value: 0,
        data: constructTransferTransaction(account2, toWei("0")) // Data doesn't since it will hit the fallback regardless.
      }
    ]);

    // Vote the proposal through.
    await moveToNextRound(voting);
    const roundId = await voting.getCurrentRoundId();
    const pendingRequests = await voting.getPendingRequests();
    const request = pendingRequests[0];
    const vote = toWei("1");
    const salt = getRandomUnsignedInt();
    const hash = computeVoteHash({
      price: vote,
      salt,
      account: proposer,
      time: request.time,
      roundId,
      identifier: request.identifier
    });
    await voting.commitVote(request.identifier, request.time, hash);
    await moveToNextPhase(voting);
    await voting.revealVote(request.identifier, request.time, vote, salt);
    await moveToNextRound(voting);

    // Since we're using the reentrancy checker, this transaction should FAIL if the reentrancy is successful.
    await governor.executeProposal(id, 0);
  });

  it("Starting id > 0", async function() {
    // Set arbitrary starting id.
    const startingId = 910284;

    // Create new governor contract.
    const newGovernor = await Governor.new(Finder.address, startingId, Timer.address, { from: proposer });

    // Approve the new governor in the Registry.
    const registry = await Registry.deployed();
    await registry.addMember(RegistryRolesEnum.CONTRACT_CREATOR, accounts[0]);
    await registry.registerContract([], newGovernor.address);
    await registry.removeMember(RegistryRolesEnum.CONTRACT_CREATOR, accounts[0]);
    const identifierWhitelist = await IdentifierWhitelist.new();
    await identifierWhitelist.transferOwnership(newGovernor.address);

    const finder = await Finder.deployed();
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.IdentifierWhitelist), identifierWhitelist.address);

    // The number of proposals should be equal to the starting id.
    assert.equal((await newGovernor.numProposals()).toString(), startingId.toString());

    const proposal0 = await newGovernor.getProposal(0);
    const proposalRandom = await newGovernor.getProposal(123456);
    const proposalLast = await newGovernor.getProposal(startingId - 1);

    // Ensure that all previous proposals have no transaction data.
    assert.equal(proposal0.transactions.length, 0);
    assert.equal(proposalRandom.transactions.length, 0);
    assert.equal(proposalLast.transactions.length, 0);

    // Check that all roles are filled by the deployer.
    assert.equal(await newGovernor.getMember(0), proposer);
    assert.equal(await newGovernor.getMember(1), proposer);

    // Issue some test tokens to the governor address.
    await testToken.allocateTo(newGovernor.address, toWei("1"));

    // Construct the transaction data to send the newly minted tokens to proposer.
    const txnData = constructTransferTransaction(proposer, toWei("1"));

    await newGovernor.propose([
      {
        to: testToken.address,
        value: 0,
        data: txnData
      }
    ]);

    // Check that the proposal is correct.
    const proposal = await newGovernor.getProposal(startingId);
    assert.equal(proposal.transactions.length, 1);
    assert.equal(proposal.transactions[0].to, testToken.address);
    assert.equal(proposal.transactions[0].value.toString(), "0");
    assert.equal(proposal.transactions[0].data, txnData);
    assert.equal(proposal.requestTime.toString(), (await newGovernor.getCurrentTime()).toString());

    await moveToNextRound(voting);
    const roundId = await voting.getCurrentRoundId();
    const pendingRequests = await voting.getPendingRequests();
    const request = pendingRequests[0];

    // Vote the proposal through.
    const vote = toWei("1");
    const salt = getRandomUnsignedInt();
    const hash = computeVoteHash({
      price: vote,
      salt,
      account: proposer,
      time: request.time,
      roundId,
      identifier: request.identifier
    });
    await voting.commitVote(request.identifier, request.time, hash);
    await moveToNextPhase(voting);
    await voting.revealVote(request.identifier, request.time, vote, salt);
    await moveToNextRound(voting);

    // Check to make sure that the tokens get transferred at the time of execution.
    const startingBalance = await testToken.balanceOf(proposer);
    await newGovernor.executeProposal(startingId, 0);
    assert.equal((await testToken.balanceOf(proposer)).toString(), startingBalance.add(toBN(toWei("1"))).toString());

    // Reset IdentifierWhitelist implementation as to not interfere with other tests.
    await finder.changeImplementationAddress(
      utf8ToHex(interfaceName.IdentifierWhitelist),
      supportedIdentifiers.address
    );
  });

  it("startingId size", async function() {
    // Starting id of 10^18 is the upper limit -- that should be the largest that will work.
    await Governor.new(Finder.address, toWei("1"), Timer.address, { from: proposer });

    // Anything above 10^18 is rejected.
    assert(await didContractThrow(Governor.new(Finder.address, toWei("1.1"), Timer.address, { from: proposer })));
  });

  // _uintToUtf8() tests.
  it("Low-level _uintToUtf8(): 0 input", async function() {
    const governorTest = await GovernorTest.new(Timer.address);

    const input = "0";
    const output = await governorTest.uintToUtf8(input);

    assert.equal(hexToUtf8(output), "0");
  });

  it("Low-level _uintToUtf8(): nonzero input", async function() {
    const governorTest = await GovernorTest.new(Timer.address);

    // Arbitrary nonzero input.
    const input = "177203972462008655";
    const output = await governorTest.uintToUtf8(input);

    assert.equal(hexToUtf8(output), input);
  });

  it("Low-level _uintToUtf8(): largest input before truncation", async function() {
    const governorTest = await GovernorTest.new(Timer.address);

    // The largest representable number in 32 digits is 32 9s.
    const input = "9".repeat(32);
    const output = await governorTest.uintToUtf8(input);

    assert.equal(hexToUtf8(output), input);
  });

  it("Low-level _uintToUtf8(): truncates at least significant digit", async function() {
    const governorTest = await GovernorTest.new(Timer.address);

    // The smallest number to be truncated is 1 followed by 32 0s.
    const input = "1" + "0".repeat(32);

    // Remove the last 0 to emulate truncation.
    const expectedOutput = "1" + "0".repeat(31);

    const output = await governorTest.uintToUtf8(input);

    assert.equal(hexToUtf8(output), expectedOutput);
  });

  // _addPrefix() tests.
  it("Low-level _addPrefix(): no truncation", async function() {
    const governorTest = await GovernorTest.new(Timer.address);

    const input = utf8ToHex("input");
    const prefix = utf8ToHex("prefix ");
    const prefixLength = "7";
    const output = await governorTest.addPrefix(input, prefix, prefixLength);

    assert.equal(hexToUtf8(output), "prefix input");
  });

  it("Low-level _addPrefix(): output truncation", async function() {
    const governorTest = await GovernorTest.new(Timer.address);

    // Prefix output cannot be longer than 32 characters or the function will truncate.
    const input = utf8ToHex(" truncated");

    // A prefix of 23 characters will cause the last character of the 10 character input to be removed from the output.
    const prefixString = "a".repeat(23);
    const prefix = utf8ToHex(prefixString);
    const prefixLength = "23";
    const output = await governorTest.addPrefix(input, prefix, prefixLength);

    assert.equal(hexToUtf8(output), `${prefixString} truncate`);
  });

  // _constructIdentifier() tests.
  it("Low-level _constructIdentifier(): normal proposal id", async function() {
    const governorTest = await GovernorTest.new(Timer.address);

    // Construct an arbitrary identifier.
    const proposalId = "1234567890";
    const identifier = await governorTest.constructIdentifier(proposalId);

    assert.equal(hexToUtf8(identifier), `Admin ${proposalId}`);
  });

  it("Low-level _constructIdentifier(): correctly identifier for 26 characters", async function() {
    const governorTest = await GovernorTest.new(Timer.address);

    // Identifiers can be 32 digits long.
    // Since the identifier must start with "Admin " (6 characters), the number can only be 26 digits or fewer.
    // The max number that can be represented, then, is 10^26 - 1.
    const maxIdValue = "9".repeat(26);
    const identifier = await governorTest.constructIdentifier(maxIdValue);

    assert.equal(hexToUtf8(identifier), `Admin ${maxIdValue}`);
  });

  it("Low-level _constructIdentifier(): proposal id truncates after 26 characters", async function() {
    const governorTest = await GovernorTest.new(Timer.address);

    // Identifiers can be 32 digits long.
    // Since the identifier must start with "Admin " (6 characters), the number can only be 26 digits or fewer.
    // 10^26, then is above the max and will be truncated.
    const aboveMaxIdValue = "1" + "0".repeat(26);

    // Expected output truncates the last 0.
    const expectedOutputIdValue = "1" + "0".repeat(25);

    const identifier = await governorTest.constructIdentifier(aboveMaxIdValue);

    assert.equal(hexToUtf8(identifier), `Admin ${expectedOutputIdValue}`);
  });
});

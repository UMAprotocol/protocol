const { didContractThrow } = require("../../../common/SolidityTestUtils.js");
const { getRandomUnsignedInt } = require("../../../common/Random.js");
const { moveToNextRound, moveToNextPhase } = require("../../utils/Voting.js");
const truffleAssert = require("truffle-assertions");

const Governor = artifacts.require("Governor");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const Voting = artifacts.require("Voting");
const VotingToken = artifacts.require("VotingToken");
const TestnetERC20 = artifacts.require("TestnetERC20");

// Extract web3 functions into primary namespace.
const { toBN, toWei } = web3.utils;

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
    const hash = web3.utils.soliditySha3(vote, salt);
    await voting.commitVote(request1.identifier, request1.time, hash);
    await voting.commitVote(request2.identifier, request2.time, hash);
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
    const pendingRequests = await voting.getPendingRequests();
    const request = pendingRequests[0];

    // Vote the proposal through.
    const vote = toWei("1");
    const salt = getRandomUnsignedInt();
    const hash = web3.utils.soliditySha3(vote, salt);
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
        data: web3.utils.hexToBytes("0x0")
      }
    ]);

    await moveToNextRound(voting);
    const pendingRequests = await voting.getPendingRequests();
    const request = pendingRequests[0];

    // Vote the proposal through.
    const vote = toWei("1");
    const salt = getRandomUnsignedInt();
    const hash = web3.utils.soliditySha3(vote, salt);
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
        data: web3.utils.hexToBytes("0x0")
      }
    ]);

    await moveToNextRound(voting);
    const pendingRequests = await voting.getPendingRequests();
    const request = pendingRequests[0];

    // Vote the proposal through.
    const vote = toWei("1");
    const salt = getRandomUnsignedInt();
    const hash = web3.utils.soliditySha3(vote, salt);
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
    const pendingRequests = await voting.getPendingRequests();
    const request = pendingRequests[0];

    // Vote the proposal through.
    const vote = toWei("1");
    const salt = getRandomUnsignedInt();
    const hash = web3.utils.soliditySha3(vote, salt);
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
    const pendingRequests = await voting.getPendingRequests();
    const request = pendingRequests[0];

    // Vote the proposal through.
    const vote = toWei("1");
    const salt = getRandomUnsignedInt();
    const hash = web3.utils.soliditySha3(vote, salt);
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
    const pendingRequests = await voting.getPendingRequests();
    const request = pendingRequests[0];

    // Vote the proposal through.
    const vote = toWei("1");
    const salt = getRandomUnsignedInt();
    const hash = web3.utils.soliditySha3(vote, salt);
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
    const pendingRequests = await voting.getPendingRequests();
    const request = pendingRequests[0];

    // Vote down the proposal.
    const vote = "0";
    const salt = getRandomUnsignedInt();
    const hash = web3.utils.soliditySha3(vote, salt);
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
    const pendingRequests = await voting.getPendingRequests();
    const request = pendingRequests[0];

    // Vote on the proposal, but don't reach the GAT.
    const vote = toWei("1");
    const salt = getRandomUnsignedInt();
    const hash = web3.utils.soliditySha3(vote, salt);
    await voting.commitVote(request.identifier, request.time, hash, { from: account2 });
    await moveToNextPhase(voting);
    await voting.revealVote(request.identifier, request.time, vote, salt, { from: account2 });
    await moveToNextRound(voting);

    // Check to make sure that the execution fails and no tokens get transferred.
    const startingBalance = await testToken.balanceOf(proposer);
    assert(await didContractThrow(governor.executeProposal(id, 0)));
    assert.equal((await testToken.balanceOf(proposer)).toString(), startingBalance.toString());

    // Resolve the vote to clean up.
    await voting.commitVote(request.identifier, request.time, hash);
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
    const pendingRequests = await voting.getPendingRequests();
    const request = pendingRequests[0];

    // Vote the proposal through.
    const vote = toWei("1");
    const salt = getRandomUnsignedInt();
    const hash = web3.utils.soliditySha3(vote, salt);
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
    const pendingRequests = await voting.getPendingRequests();
    const request = pendingRequests[0];
    const vote = toWei("1");
    const salt = getRandomUnsignedInt();
    const hash = web3.utils.soliditySha3(vote, salt);
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
});

const { didContractThrow } = require("../../common/SolidityTestUtils.js");
const { RegistryRolesEnum, VotePhasesEnum } = require("../../common/Enums.js");
const { getRandomSignedInt, getRandomUnsignedInt } = require("../../common/Random.js");
const { decryptMessage, encryptMessage, deriveKeyPairFromSignatureTruffle } = require("../../common/Crypto");
const { moveToNextRound, moveToNextPhase } = require("../utils/Voting.js");
const { computeTopicHash, getKeyGenMessage } = require("../../common/EncryptionHelper.js");
const truffleAssert = require("truffle-assertions");

const Governor = artifacts.require("Governor");
const Registry = artifacts.require("Registry");
const Voting = artifacts.require("Voting");
const VotingToken = artifacts.require("VotingToken");
const TestnetERC20 = artifacts.require("TestnetERC20");

// Extract web3 functions into primary namespace.
const { toBN, toWei } = web3.utils;

contract("Governor", function(accounts) {
  let voting;
  let governor;
  let testToken;

  const account1 = accounts[0];
  const account2 = accounts[1];

  const setNewInflationRate = async inflationRate => {
    await voting.setInflationRate({ rawValue: inflationRate.toString() });
  };

  const constructTransferTransaction = (destination, amount) => {
    return testToken.contract.methods.transfer(destination, amount).encodeABI();
  };

  before(async function() {
    voting = await Voting.deployed();
    governor = await Governor.deployed();
    testToken = await TestnetERC20.deployed();
    let votingToken = await VotingToken.deployed();

    // Allow account1 to mint tokens.
    const minterRole = 1;
    await votingToken.addMember(minterRole, account1);

    // Mint 99 tokens to this account so it has 99% of the tokens.
    await votingToken.mint(account1, toWei("99", "ether"));

    // Mint 1 token to this account so it has 1% of the tokens (not enough to reach the GAT).
    await votingToken.mint(account2, toWei("1", "ether"));

    // Set the inflation rate to 0 by default, so the balances stay fixed.
    await setNewInflationRate("0");
  });

  it("Identifier construction", async function() {
    // Reset the rounds.
    await moveToNextRound(voting);

    // Construct the transaction to send 0 tokens.
    const txnData = constructTransferTransaction(account1, "0");

    // The id is the number of proposals before sending.
    const id1 = await governor.numProposals();

    // Send the proposal.
    await governor.propose(testToken.address, 0, txnData, { from: account1 });

    // Send a second proposal.
    const id2 = await governor.numProposals();
    await governor.propose(testToken.address, 0, txnData, { from: account1 });

    // The proposals should show up in the pending requests in the *next* round.
    await moveToNextRound(voting);
    const pendingRequests = await voting.getPendingRequests();

    // Check that the proposals shows up and that the identifiers are constructed correctly.
    //assert.equal(pendingRequests.length, 2);
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
    await governor.executeProposal(id1);
    await governor.executeProposal(id2);
  });

  it("Successful transaction", async function() {
    // Reset the rounds.
    await moveToNextRound(voting);

    // Issue some test tokens to the governor address.
    await testToken.allocateTo(governor.address, toWei("1"));

    // Construct the transaction data to send the newly minted tokens to account1.
    const txnData = constructTransferTransaction(account1, toWei("1"));

    // The id is the number of proposals before sending.
    const id = await governor.numProposals();

    // Send the proposal.
    await governor.propose(testToken.address, 0, txnData, { from: account1 });

    // The proposal should show up in the pending requests.
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

    // Check to make sure that the tokens get transferred at the time of execution.
    const startingBalance = await testToken.balanceOf(account1);
    await governor.executeProposal(id);
    assert.equal((await testToken.balanceOf(account1)).toString(), startingBalance.add(toBN(toWei("1"))).toString());
  });

  it("No repeated executions", async function() {});

  it("Unsuccessful proposal", async function() {});

  it("Unresolved vote", async function() {});

  it("Failed transaction", async function() {});

  it("Events", async function() {});
});

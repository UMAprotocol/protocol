const hre = require("hardhat");
const { web3 } = hre;
const { runVotingV2Fixture, ZERO_ADDRESS } = require("@uma/common");
const { getContract, assertEventEmitted, assertEventNotEmitted } = hre;
const {
  RegistryRolesEnum,
  VotePhasesEnum,
  didContractThrow,
  getRandomSignedInt,
  decryptMessage,
  encryptMessage,
  deriveKeyPairFromSignatureTruffle,
  computeVoteHash,
  computeVoteHashAncillary,
  getKeyGenMessage,
} = require("@uma/common");
const { moveToNextRound, moveToNextPhase } = require("../../utils/Voting.js");
const { assert } = require("chai");
const { toBN } = web3.utils;

const Finder = getContract("Finder");
const Registry = getContract("Registry");
const VotingV2 = getContract("VotingV2");
const VotingInterfaceTesting = getContract("VotingInterfaceTesting");
const VotingAncillaryInterfaceTesting = getContract("VotingAncillaryInterfaceTesting");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const VotingToken = getContract("VotingToken");
const VotingTest = getContract("VotingTest");
const Timer = getContract("Timer");
const SlashingLibrary = getContract("SlashingLibrary");

const { utf8ToHex, padRight } = web3.utils;

const toWei = (value) => toBN(web3.utils.toWei(value, "ether"));

describe("SpamGuard", function () {
  let voting, votingToken, registry, supportedIdentifiers, registeredContract, unregisteredContract, migratedVoting;
  let accounts, account1, account2, account3, account4;

  const setNewGatPercentage = async (gatPercentage) => {
    await voting.methods.setGatPercentage({ rawValue: gatPercentage.toString() }).send({ from: accounts[0] });
  };

  beforeEach(async function () {
    accounts = await web3.eth.getAccounts();
    [account1, account2, account3, account4, registeredContract, unregisteredContract, migratedVoting] = accounts;
    await runVotingV2Fixture(hre);
    voting = await await VotingV2.deployed();

    supportedIdentifiers = await IdentifierWhitelist.deployed();
    votingToken = await VotingToken.deployed();
    registry = await Registry.deployed();

    // Allow account1 to mint tokens.
    const minterRole = 1;
    await votingToken.methods.addMember(minterRole, account1).send({ from: accounts[0] });

    // Seed the account2 from account1 and stake from both accounts Account1 starts with 100MM tokens, so divide up as:
    // account1: 70MM. Stake 60mm. account2: 30MM. Stake 30mm.
    await votingToken.methods.approve(voting.options.address, toWei("70000000")).send({ from: account1 }); // over approve for subsequent tests
    await voting.methods.stake(toWei("60000000")).send({ from: account1 });
    await votingToken.methods.transfer(account2, toWei("30000000")).send({ from: accounts[0] });
    await votingToken.methods.approve(voting.options.address, toWei("30000000")).send({ from: account2 });
    await voting.methods.stake(toWei("30000000")).send({ from: account2 });

    // Register contract with Registry.
    await registry.methods.addMember(RegistryRolesEnum.CONTRACT_CREATOR, account1).send({ from: accounts[0] });
    await registry.methods.registerContract([], registeredContract).send({ from: account1 });

    // Reset the rounds.
    await moveToNextRound(voting, accounts[0]);
  });

  it.only("Simple flow can propose, vote on and execute request deletion", async function () {
    // Take the contract through a full proposal slashing life cycle and verify all steps work as expected.

    // Construct a simple price request that is valid and should not be considered as spam.
    const validIdentifier = padRight(utf8ToHex("valid-price"), 64);
    const spamIdentifier = padRight(utf8ToHex("spam-price"), 64);
    const time = Number(await voting.methods.getCurrentTime().call()) - 10; // 10 seconds in the past.

    // Make the Oracle support this identifier.
    await supportedIdentifiers.methods.addSupportedIdentifier(validIdentifier).send({ from: accounts[0] });
    await supportedIdentifiers.methods.addSupportedIdentifier(spamIdentifier).send({ from: accounts[0] });

    // Request a price and move to the next round where that will be voted on.
    await voting.methods.requestPrice(validIdentifier, time).send({ from: registeredContract });
    await voting.methods.requestPrice(spamIdentifier, time + 1).send({ from: registeredContract });
    await voting.methods.requestPrice(spamIdentifier, time + 2).send({ from: registeredContract });

    // Verify both requests are in active status. This should switch to inactive after deleted.
    let statuses = await voting.methods
      .getPriceRequestStatuses([
        { identifier: spamIdentifier, time: time + 1 },
        { identifier: spamIdentifier, time: time + 2 },
      ])
      .call();
    assert.equal(statuses[0].status, "3"); // Both should be in the Future state.
    assert.equal(statuses[1].status, "3"); // Both should be in the Future state.

    assert.equal(await voting.methods.getNumberOfPriceRequests().call(), 3);

    // Construct the request to delete the spam votes.
    // There should be no unexecutedSpamDeletionProposalIds.
    await voting.methods.signalRequestsAsSpamForDeletion([[1, 2]]).send({ from: account1 });
    const signalDeletionTime = await voting.methods.getCurrentTime().call();

    // There should now be 4 requests as the signal to delete votes as spam creates another vote.
    assert.equal(await voting.methods.getNumberOfPriceRequests().call(), 4);

    // the caller of this method should have lost 10k votingTokens as a bond when calling this function.
    assert.equal(await votingToken.methods.balanceOf(account1).call(), toWei("9990000")); // 10mm - 10k bond

    const spamDeletionProposal = await voting.methods.getSpamDeletionRequest(0).call();
    assert.equal(spamDeletionProposal.proposer, account1);
    assert.equal(spamDeletionProposal.requestTime, await voting.methods.getCurrentTime().call());
    assert.equal(spamDeletionProposal.spamRequestIndices.toString(), "1,2");

    // All the requests should be enqueued in the following voting round.

    await moveToNextRound(voting, accounts[0]);
    // There should be 4 requests this round: the valid request, the 2x spam and the 1x spam deletion request.
    assert.equal((await voting.methods.getPendingRequests().call()).length, 4);

    // We should expect the price request associated with the deletion to have expected data.
    const spamDeletionRequest = (await voting.methods.getPendingRequests().call())[3];
    const spamDeletionIdentifier = padRight(utf8ToHex("SpamDeletionProposal 0"), 64);
    assert.equal(spamDeletionRequest.identifier, spamDeletionIdentifier);
    assert.equal(spamDeletionRequest.ancillaryData, "0x");
    assert.equal(spamDeletionRequest.time, signalDeletionTime);
    assert.equal(spamDeletionRequest.time, signalDeletionTime);

    // Commit votes. Vote on the valid request and vote on spam deletion request. Voting to delete the spam is with a
    // vote of "1e18". Dont vote on the spam requests.
    const roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    const winningPrice = "42069";
    const salt = getRandomSignedInt();

    const hash1 = computeVoteHash({
      price: winningPrice,
      salt,
      account: account2,
      time,
      roundId,
      identifier: validIdentifier,
    });
    await voting.methods.commitVote(validIdentifier, time, hash1).send({ from: account2 });

    const hash2 = computeVoteHash({
      price: toWei("1"),
      salt,
      account: account2,
      time,
      roundId,
      time: signalDeletionTime,
      identifier: spamDeletionIdentifier,
    });
    await voting.methods.commitVote(spamDeletionIdentifier, signalDeletionTime, hash2).send({ from: account2 });

    // Reveal the votes.
    await moveToNextPhase(voting, accounts[0]);
    await voting.methods.revealVote(validIdentifier, time, winningPrice, salt).send({ from: account2 });
    await voting.methods
      .revealVote(spamDeletionIdentifier, signalDeletionTime, toWei("1"), salt)
      .send({ from: account2 });

    // Execute the spam deletion call.
    await moveToNextRound(voting, accounts[0]);
    await voting.methods.executeSpamDeletion(0).send({ from: account1 });
    assert(await didContractThrow(voting.methods.executeSpamDeletion(0).send({ from: account1 }))); // Cant re-execute the spam deletion proposal.

    // The requests should have been deleted, it should have been removed from pending requests and the spamDeletionProposal mapping should have been updated.
    assert.equal((await voting.methods.getPendingRequests().call()).length, 0); // All requests either deleted or resolved.
    statuses = await voting.methods
      .getPriceRequestStatuses([
        { identifier: spamIdentifier, time: time + 1 },
        { identifier: spamIdentifier, time: time + 2 },
      ])
      .call();

    // Both status should be 0; (not requested) as they were deleted.
    assert.equal(statuses[0].status, "0");
    assert.equal(statuses[1].status, "0");

    // There should be a mapping between the first deleted element and the last deleted element. i.e mapping from input of
    // 1 to 2, the two elements that have been deleted.
    assert.equal(await voting.methods.deletedRequestJumpMapping(1).call(), 2);

    // We are now in the next voting round. (commit phase). you should not be able to commit on either request.
    assert(await didContractThrow(voting.methods.commitVote(spamIdentifier, time + 1, hash2).send({ from: account2 })));
    assert(await didContractThrow(voting.methods.commitVote(spamIdentifier, time + 2, hash2).send({ from: account2 })));

    // Calling get price should obviously revert (price does not exist).
    assert(
      await didContractThrow(voting.methods.getPrice(spamIdentifier, time + 1).send({ from: registeredContract }))
    );
    assert(
      await didContractThrow(voting.methods.getPrice(spamIdentifier, time + 2).send({ from: registeredContract }))
    );
    // Move to the next phase to lock in the final votes.
    await moveToNextPhase(voting, accounts[0]);

    // There should be no slashing applied to the no-voting on the deleted spam price requests.
    await voting.methods.updateTrackers(account2).send({ from: account2 });

    // We should be able to see the request slashing trackers 0 and 3 (the valid request and spam deletion request) set
    // with values of the total correct voted at these indices. Requests 1 and 2 should have nothing at them as they
    // were deleted. Note that their indices are still kept!
    assert.equal((await voting.methods.requestSlashingTrackers(0).call()).totalCorrectVotes, toWei("30000000")); // 30mm staked that voted correctly
    assert.equal((await voting.methods.requestSlashingTrackers(1).call()).totalCorrectVotes, toWei("0")); // 0 voted on this.
    assert.equal((await voting.methods.requestSlashingTrackers(2).call()).totalCorrectVotes, toWei("0")); // 0 voted on this.
    assert.equal((await voting.methods.requestSlashingTrackers(3).call()).totalCorrectVotes, toWei("30000000")); // 30mm staked that voted correctly

    //We should see cumulatively that account 1 lost two independent rounds of slashing at 0.0016 of their 60mm staked.
    // This should be assigned to the second voter. 0.0016 * 60mm = 192000
    assert.equal(
      (await voting.methods.voterStakes(account2).call()).cumulativeStaked,
      toWei("30000000").add(toWei("192000")) // Their original stake amount of 30mm plus the positive slash of 192k.
    );

    await voting.methods.updateTrackers(account1).send({ from: account1 });
    assert.equal(
      (await voting.methods.voterStakes(account1).call()).cumulativeStaked,
      toWei("60000000").sub(toWei("192000")) // Their original stake amount of 90mm sub the negative slash of 192k.
    );
  });
  it("Blocks contract actions until spam has been deleted", async function () {});
  it("Correctly selects voting round based on request time", async function () {});
  it("Handles interspersed valid requests in deletion", async function () {});
  it("Correctly sends bond to store if voted down", async function () {});
});

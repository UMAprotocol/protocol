const hre = require("hardhat");
const { web3 } = hre;
const { runVotingV2Fixture } = require("@uma/common");
const { getContract, assertEventEmitted } = hre;
const { RegistryRolesEnum, didContractThrow, getRandomSignedInt, computeVoteHash } = require("@uma/common");
const { moveToNextRound, moveToNextPhase } = require("../utils/Voting.js");
const { assert } = require("chai");

const { toBN } = web3.utils;

const Registry = getContract("Registry");
const VotingV2 = getContract("VotingV2ControllableTiming");

const IdentifierWhitelist = getContract("IdentifierWhitelist");
const VotingToken = getContract("VotingToken");
const SlashingLibrary = getContract("SlashingLibrary");
const ZeroedSlashingSlashingLibraryTest = getContract("ZeroedSlashingSlashingLibraryTest");

const { utf8ToHex, padRight } = web3.utils;

const toWei = (value) => toBN(web3.utils.toWei(value, "ether"));

describe("SpamGuard", function () {
  let voting, votingToken, registry, supportedIdentifiers, registeredContract;
  let accounts, account1, account2;

  const validIdentifier = padRight(utf8ToHex("valid-price"), 64);
  const spamIdentifier = padRight(utf8ToHex("spam-price"), 64);

  beforeEach(async function () {
    accounts = await web3.eth.getAccounts();
    [account1, account2, registeredContract] = accounts;
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

    // Make the Oracle support the identifiers.
    await supportedIdentifiers.methods.addSupportedIdentifier(validIdentifier).send({ from: accounts[0] });
    await supportedIdentifiers.methods.addSupportedIdentifier(spamIdentifier).send({ from: accounts[0] });

    // Reset the rounds.
    await moveToNextRound(voting, accounts[0]);
  });

  it("Simple flow can propose, vote on and execute request deletion", async function () {
    // Take the contract through a full proposal slashing life cycle and verify all steps work as expected.

    // Construct a simple price request that is valid and should not be considered as spam.
    const time = Number(await voting.methods.getCurrentTime().call()) - 10; // 10 seconds in the past.

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
    const signalSpamEvents = await voting.getPastEvents("SignaledRequestsAsSpamForDeletion", {
      fromBlock: 0,
      filter: { proposalId: 0 },
    });
    assert.equal(signalSpamEvents[signalSpamEvents.length - 1].returnValues.spamRequestIndices[0].length, 2);
    const signalDeleteTime = await voting.methods.getCurrentTime().call();

    // There should now be 4 requests as the signal to delete votes as spam creates another vote.
    assert.equal(await voting.methods.getNumberOfPriceRequests().call(), 4);

    // The caller of this method should have lost 10k votingTokens as a bond when calling this function.
    assert.equal(await votingToken.methods.balanceOf(account1).call(), toWei("9990000")); // 10mm - 10k bond

    const spamDeletionProposal = await voting.methods.getSpamDeletionRequest(0).call();
    assert.equal(spamDeletionProposal.proposer, account1);
    assert.equal(spamDeletionProposal.requestTime, await voting.methods.getCurrentTime().call());
    assert.equal(spamDeletionProposal.spamRequestIndices.toString(), "1,2");

    // All the requests should be enqueued in the following voting round.
    await moveToNextRound(voting, accounts[0]);
    // There should be 4 requests this round: the valid request, the 2x spam and the 1x spam deletion request.
    assert.equal((await voting.methods.getPendingRequests().call()).length, 4);

    // We should expect the price request associated with the deletion to have expected data. Request3 (the 4th and last
    // one) is the request associated with the spam deletion. we had one valid request, two spam and the spam deletion
    // request.
    const spamDeletionRequest = (await voting.methods.getPendingRequests().call())[3];
    const spamDeleteIdentifier = padRight(utf8ToHex("SpamDeletionProposal 0"), 64);
    assert.equal(spamDeletionRequest.identifier, spamDeleteIdentifier);
    assert.equal(spamDeletionRequest.ancillaryData, "0x");
    assert.equal(spamDeletionRequest.time, signalDeleteTime);

    // Commit votes. Vote on the valid request and vote on spam deletion request. Voting to delete the spam is with a
    // vote of "1e18". Dont vote on the spam requests. Only vote from account2 to simplify the test.
    const account = account2;
    const roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    const winningPrice = "42069";
    const salt = getRandomSignedInt();

    const hash1 = computeVoteHash({ price: winningPrice, salt, account, time, roundId, identifier: validIdentifier });
    await voting.methods.commitVote(validIdentifier, time, hash1).send({ from: account2 });

    const hash2 = computeVoteHash({
      price: toWei("1"),
      salt,
      account,
      roundId,
      time: signalDeleteTime,
      identifier: spamDeleteIdentifier,
    });
    await voting.methods.commitVote(spamDeleteIdentifier, signalDeleteTime, hash2).send({ from: account2 });

    // Reveal the votes.
    await moveToNextPhase(voting, accounts[0]);
    await voting.methods.revealVote(validIdentifier, time, winningPrice, salt).send({ from: account2 });
    await voting.methods.revealVote(spamDeleteIdentifier, signalDeleteTime, toWei("1"), salt).send({ from: account2 });

    // Execute the spam deletion call.
    await moveToNextRound(voting, accounts[0]);
    await voting.methods.executeSpamDeletion(0).send({ from: account1 });

    const executeSpamEvents = await voting.getPastEvents("ExecutedSpamDeletion", {
      fromBlock: 0,
      filter: { proposalId: 0 },
    });
    assert.equal(executeSpamEvents[executeSpamEvents.length - 1].returnValues.executed, true);
    // Account 1 should have gotten their bond back.
    assert.equal(await votingToken.methods.balanceOf(account1).call(), toWei("10000000")); // 10mm.

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
    assert.equal(await voting.methods.skippedRequestIndexes(1).call(), 2);

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

    // We should see cumulatively that account1 lost two independent rounds of slashing at 0.0016 of their 60mm staked.
    // This should be assigned to the second voter. 0.0016 * 60mm = 192000
    assert.equal(
      (await voting.methods.voterStakes(account2).call()).stake,
      toWei("30000000").add(toWei("192000")) // Their original stake amount of 30mm plus the positive slash of 192k.
    );

    await voting.methods.updateTrackers(account1).send({ from: account1 });
    assert.equal(
      (await voting.methods.voterStakes(account1).call()).stake,
      toWei("60000000").sub(toWei("192000")) // Their original stake amount of 90mm sub the negative slash of 192k.
    );
  });

  it("Handles interspersed valid requests in deletion", async function () {
    // Mimic the spammer placing spam requests in between valid requests. we should be able to remove these spam requests
    // from within the set of valid requests and delete all of the spam in one go.
    const time = Number(await voting.methods.getCurrentTime().call()) - 10; // 10 seconds in the past.

    // Request a price and move to the next round where that will be voted on.
    await voting.methods.requestPrice(validIdentifier, time).send({ from: registeredContract }); // index0
    await voting.methods.requestPrice(spamIdentifier, time + 1).send({ from: registeredContract }); // index1
    await voting.methods.requestPrice(validIdentifier, time + 2).send({ from: registeredContract }); // index2
    await voting.methods.requestPrice(spamIdentifier, time + 3).send({ from: registeredContract }); // index3
    await voting.methods.requestPrice(validIdentifier, time + 4).send({ from: registeredContract }); // index4
    const signalDeleteTime = await voting.methods.getCurrentTime().call();

    await voting.methods
      .signalRequestsAsSpamForDeletion([
        [1, 1], // delete the one request in index1.
        [3, 3], // delete the other request in index3.
      ])
      .send({ from: account1 });

    // Move to the next round and vote on the valid requests and the spam deletion request. There should be 6 pending
    // requests: the 5 listed above and the spam deletion request.
    await moveToNextRound(voting, accounts[0]);
    assert.equal((await voting.methods.getPendingRequests().call()).length, 6);

    const spamDeleteIdentifier = padRight(utf8ToHex("SpamDeletionProposal 0"), 64);
    const account = account2;
    const roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    const price = 42069;
    const salt = getRandomSignedInt();
    const hash1 = computeVoteHash({ price, salt, account, time, roundId, identifier: validIdentifier });
    await voting.methods.commitVote(validIdentifier, time, hash1).send({ from: account2 });
    const hash2 = computeVoteHash({ price, salt, account, time: time + 2, roundId, identifier: validIdentifier });
    await voting.methods.commitVote(validIdentifier, time + 2, hash2).send({ from: account2 });
    const hash3 = computeVoteHash({ price, salt, account, time: time + 4, roundId, identifier: validIdentifier });
    await voting.methods.commitVote(validIdentifier, time + 4, hash3).send({ from: account2 });

    const hash4 = computeVoteHash({
      price: toWei("1"), // 1 indicates we intend on executing the deletion.
      salt,
      account,
      roundId,
      time: signalDeleteTime,
      identifier: spamDeleteIdentifier,
    });
    await voting.methods.commitVote(spamDeleteIdentifier, signalDeleteTime, hash4).send({ from: account2 });

    // Reveal the votes.
    await moveToNextPhase(voting, accounts[0]);
    await voting.methods.revealVote(validIdentifier, time, price, salt).send({ from: account2 });
    await voting.methods.revealVote(validIdentifier, time + 2, price, salt).send({ from: account2 });
    await voting.methods.revealVote(validIdentifier, time + 4, price, salt).send({ from: account2 });
    await voting.methods.revealVote(spamDeleteIdentifier, signalDeleteTime, toWei("1"), salt).send({ from: account2 });

    // Move to next voting round to ratify the vote.
    await moveToNextRound(voting, accounts[0]);

    // Check that pending request index 4 exists
    await voting.methods.pendingPriceRequests(4).call();

    // Next call updateTrackers which in turn will execute _resolvePriceRequest. This last function call
    // will delete the resolved price requests from pending requests and emit PriceResolved events.
    // We want to make sure that this doesn't affect the spam deletion that we will do next.
    const result = await voting.methods.updateTrackers(account1).send({ from: account1 });

    // Check that pending request index 4 doesn't exists anymore and emitted events
    assert(await didContractThrow(voting.methods.pendingPriceRequests(4).call()));
    await assertEventEmitted(result, voting, "PriceResolved");

    await voting.methods.executeSpamDeletion(0).send({ from: account1 });
    assert.equal((await voting.methods.getPendingRequests().call()).length, 0); // All requests either deleted or resolved.
    let statuses = await voting.methods
      .getPriceRequestStatuses([
        { identifier: validIdentifier, time: time }, // 0 should be resolved.
        { identifier: spamIdentifier, time: time + 1 }, // 1 should be deleted.
        { identifier: validIdentifier, time: time + 2 }, // 2 should be resolved.
        { identifier: spamIdentifier, time: time + 3 }, // 3 should be deleted.
        { identifier: validIdentifier, time: time + 4 }, // 4 should be resolved.
        { identifier: spamDeleteIdentifier, time: signalDeleteTime }, // 5 should be resolved.
      ])
      .call();

    assert.equal(statuses[0].status, "2"); // valid request 1. resolved.
    assert.equal(statuses[1].status, "0"); // spam request 1. deleted.
    assert.equal(statuses[2].status, "2"); // valid request 2. resolved.
    assert.equal(statuses[3].status, "0"); // spam request 2. deleted.
    assert.equal(statuses[4].status, "2"); // valid request 3. resolved.
    assert.equal(statuses[5].status, "2"); // spam deletion request. resolved.

    assert.equal(await voting.methods.skippedRequestIndexes(1).call(), 1);
    assert.equal(await voting.methods.skippedRequestIndexes(3).call(), 3);

    // Finally, validate that the slashing correctly traversed the two gaps added into the set of requests. In this case,
    // account1 should be slashed for the 4 votes they did not participate on (and no more). This is the 3 valid requests
    // and the spam deletion request and NOT the 2 spam requests. This should be 60mm * 0.0016 * 4 = 384000.
    await voting.methods.updateTrackers(account1).send({ from: account1 });
    await voting.methods.updateTrackers(account2).send({ from: account2 });

    assert.equal(
      (await voting.methods.requestSlashingTrackers(0).call()).toString(),
      (await voting.methods.requestSlashingTrackers(2).call()).toString(),
      (await voting.methods.requestSlashingTrackers(3).call()).toString(),
      (await voting.methods.requestSlashingTrackers(4).call()).toString()
    );
    const slashingTracker = await voting.methods.requestSlashingTrackers(0).call();
    assert.equal(slashingTracker.wrongVoteSlashPerToken, toWei("0.0016"));
    assert.equal(slashingTracker.noVoteSlashPerToken, toWei("0.0016"));
    assert.equal(slashingTracker.totalSlashed, toWei("96000")); // 60mm * 0.0016
    assert.equal(slashingTracker.totalCorrectVotes, toWei("30000000"));
    assert.equal(
      (await voting.methods.voterStakes(account1).call()).stake,
      toWei("60000000").sub(toWei("384000")) // Their original stake amount of 30mm plus the slashing of 384k.
    );
    assert.equal(
      (await voting.methods.voterStakes(account2).call()).stake,
      toWei("30000000").add(toWei("384000")) // Their original stake amount of 60mm minus the slashing of 384k.
    );
  });
  it("Can correctly create spam deletion requests even after the minRollToNextRoundLength period", async function () {
    // Consider that the spammer places the spam requests right before the end of the period that would place the requests
    // into the next round. We should be able to be able to use the spam deletion request to delete the spam request as
    // these kinds of requests bypass the minRollToNextRoundLength period.

    // Move to the next round and ensure we are right at the beginning of the commit phase.
    await moveToNextRound(voting, accounts[0]); // Move to the start of a voting round to be right at the beginning.
    const startingVotingRoundId = Number(await voting.methods.getCurrentRoundId().call());
    const roundEndTime = Number(await voting.methods.getRoundEndTime(startingVotingRoundId + 1).call());

    // Now move to right before the minRollToNextRoundLength period and make the spam requests.
    await voting.methods.setCurrentTime(roundEndTime - 60 * 60 * 2 - 1).send({ from: accounts[0] });
    const time = Number(await voting.methods.getCurrentTime().call()) - 10; // 10 seconds in the past.

    await voting.methods.requestPrice(spamIdentifier, time).send({ from: registeredContract }); // index0
    await voting.methods.requestPrice(spamIdentifier, time + 1).send({ from: registeredContract }); // index1
    await voting.methods.requestPrice(spamIdentifier, time + 2).send({ from: registeredContract }); // index2

    // Now, advance time after the minRollToNextRoundLength period and make the spam deletion request.
    await voting.methods.setCurrentTime(roundEndTime - 60 * 60 * 2 + 1).send({ from: accounts[0] });
    const spamDeletionTime = Number(await voting.methods.getCurrentTime().call());
    await voting.methods.signalRequestsAsSpamForDeletion([[0, 2]]).send({ from: account1 });

    // Make another legitimate request to verify that it is placed in the round after the next round as we are past the
    // minRollToNextRoundLength period.
    await voting.methods.requestPrice(validIdentifier, time).send({ from: registeredContract }); // index4

    assert.equal(await voting.methods.getNumberOfPriceRequests().call(), 5);

    // Now, move to the next round and ensure that all requests are votable within this round except for the valid request
    // that landed after the minRollToNextRoundLength period.
    await moveToNextRound(voting, accounts[0]);

    // Check all price requests are in the correct states.
    const spamDeletionIdentifier = padRight(utf8ToHex("SpamDeletionProposal 0"), 64);
    let statuses = await voting.methods
      .getPriceRequestStatuses([
        { identifier: spamIdentifier, time: time }, // 0 should be active.
        { identifier: spamIdentifier, time: time + 1 }, // 1 should be active.
        { identifier: spamIdentifier, time: time + 2 }, // 2 should be active.
        { identifier: spamDeletionIdentifier, time: spamDeletionTime }, // 3 should be active.
        { identifier: validIdentifier, time: time }, // 4 should in the future state.
      ])
      .call();

    assert.equal(statuses[0].status, "1"); // spam request 0. active.
    assert.equal(statuses[1].status, "1"); // spam request 1. active.
    assert.equal(statuses[2].status, "1"); // spam request 2. active.
    assert.equal(statuses[3].status, "1"); // spam deletion request. active.
    assert.equal(statuses[4].status, "3"); // valid request. in the following voting round.

    assert.equal((await voting.methods.getPendingRequests().call()).length, 4); // 4 of the 5 votes should be active now.

    // There is only one vote we need to vote on now: the spam deletion request.

    const account = account2;
    const salt = getRandomSignedInt();
    const roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    const hash1 = computeVoteHash({
      price: toWei("1"),
      salt,
      account,
      roundId,
      time: spamDeletionTime,
      identifier: spamDeletionIdentifier,
    });
    await voting.methods.commitVote(spamDeletionIdentifier, spamDeletionTime, hash1).send({ from: account2 });

    // Can not vote on the valid request as this should be placed within the following voting round due to the
    // minRollToNextRoundLength period. Note re-use the hash as we just need to check it reverts on the commit call.
    assert(await didContractThrow(voting.methods.commitVote(validIdentifier, time, hash1).send({ from: account2 })));

    // Move to next phase.
    await moveToNextPhase(voting, accounts[0]);

    // Reveal the votes and execute the spam deletion request.
    await voting.methods
      .revealVote(spamDeletionIdentifier, spamDeletionTime, toWei("1"), salt)
      .send({ from: account2 });
    await moveToNextPhase(voting, accounts[0]);
    await voting.methods.executeSpamDeletion(0).send({ from: account2 });

    statuses = await voting.methods
      .getPriceRequestStatuses([
        { identifier: spamIdentifier, time: time }, // 0 should be deleted.
        { identifier: spamIdentifier, time: time + 1 }, // 1 should be deleted.
        { identifier: spamIdentifier, time: time + 2 }, // 2 should be deleted.
        { identifier: spamDeletionIdentifier, time: spamDeletionTime }, // 3 should be executed.
        { identifier: validIdentifier, time: time }, // 4 should in the active state as it can be voted on now due to moving into this round.
      ])
      .call();

    assert.equal(statuses[0].status, "0"); // spam request 0. deleted
    assert.equal(statuses[1].status, "0"); // spam request 1. deleted.
    assert.equal(statuses[2].status, "0"); // spam request 2. deleted
    assert.equal(statuses[3].status, "2"); // spam deletion request. resolved.
    assert.equal(statuses[4].status, "1"); // valid request. now active in voting.
  });

  it("Correct bonds refund", async function () {
    // Construct a simple price request that is valid and should not be considered as spam.
    const time = Number(await voting.methods.getCurrentTime().call()) - 10; // 10 seconds in the past.

    // Request prices and move to the next round where that will be voted on.
    await voting.methods.requestPrice(validIdentifier, time).send({ from: registeredContract });
    await voting.methods.requestPrice(spamIdentifier, time).send({ from: registeredContract });

    // Construct the request to delete the spam votes.
    await voting.methods.signalRequestsAsSpamForDeletion([[1, 1]]).send({ from: account1 });
    const signalDeleteTime = await voting.methods.getCurrentTime().call();

    // The caller of this method should have lost 10k votingTokens as a bond when calling this function.
    assert.equal(await votingToken.methods.balanceOf(account1).call(), toWei("9990000")); // 10mm - 10k bond

    // All the requests should be enqueued in the following voting round.
    await moveToNextRound(voting, accounts[0]);

    const spamDeleteIdentifier = padRight(utf8ToHex("SpamDeletionProposal 0"), 64);

    // In the meantime update the spamDeletionProposalBond to 500 bond
    const tx = await voting.methods.setSpamDeletionProposalBond(toWei("0.5")).send({ from: account1 });
    assert.equal(tx.events.SpamDeletionProposalBondChanged.returnValues.newBond, toWei("0.5"));

    // Commit votes. Vote on the valid request and vote on spam deletion request. Voting to delete the spam is with a
    // vote of "1e18". Dont vote on the spam requests. Only vote from account2 to simplify the test.
    const account = account2;
    const roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    const salt = getRandomSignedInt();

    const hash2 = computeVoteHash({
      price: toWei("1"),
      salt,
      account,
      roundId,
      time: signalDeleteTime,
      identifier: spamDeleteIdentifier,
    });
    await voting.methods.commitVote(spamDeleteIdentifier, signalDeleteTime, hash2).send({ from: account2 });

    // Reveal the vote.
    await moveToNextPhase(voting, accounts[0]);

    await voting.methods.revealVote(spamDeleteIdentifier, signalDeleteTime, toWei("1"), salt).send({ from: account2 });

    // Execute the spam deletion call.
    await moveToNextRound(voting, accounts[0]);

    await voting.methods.executeSpamDeletion(0).send({ from: account1 });

    // Even if the bond changed in the meantime the user get's the original bond paid back.
    assert.equal(await votingToken.methods.balanceOf(account1).call(), toWei("10000000")); // 10mm.
    assert.equal(await votingToken.methods.balanceOf(account2).call(), toWei("0")); // 0mm.
  });

  it("Correctly sends bond to store if voted down", async function () {});
  it("Correctly handles rolled votes", async function () {
    // Request 2 spam requests and one valid request. Move to the next round before signaling them as spam.
    const time = Number(await voting.methods.getCurrentTime().call()) - 10; // 10 seconds in the past.
    await voting.methods.requestPrice(validIdentifier, time).send({ from: registeredContract });
    await voting.methods.requestPrice(spamIdentifier, time + 1).send({ from: registeredContract });
    await voting.methods.requestPrice(spamIdentifier, time + 2).send({ from: registeredContract });

    // There should be 3 requests to start (the ones just enqueue). Pending requests start at 0 as the votes are not yet
    // active and pending requests show votes that are currently being voted on.
    assert.equal(await voting.methods.getNumberOfPriceRequests().call(), 3);
    assert.equal((await voting.methods.getPendingRequests().call()).length, 0);

    // Logically, the first request should be index 0, spam request index 1 and 2.
    const validRequestId = await voting.methods.priceRequestIds(0).call();
    assert.equal((await voting.methods.priceRequests(validRequestId).call()).priceRequestIndex, 0);
    const spamRequestId1 = await voting.methods.priceRequestIds(1).call();
    assert.equal((await voting.methods.priceRequests(spamRequestId1).call()).priceRequestIndex, 1);
    const spamRequestId2 = await voting.methods.priceRequestIds(2).call();
    assert.equal((await voting.methods.priceRequests(spamRequestId2).call()).priceRequestIndex, 2);

    // Now move to the next round and signal the requests for deletion as spam. This should be index 1 and 2, the indexes
    // shown above.
    await moveToNextRound(voting, accounts[0]);
    await voting.methods.signalRequestsAsSpamForDeletion([[1, 2]]).send({ from: account1 });
    const signalDeleteTime = await voting.methods.getCurrentTime().call();
    const spamDeleteIdentifier = padRight(utf8ToHex("SpamDeletionProposal 0"), 64);

    // There should now be 4 requests as the signal to delete votes as spam creates another vote. There should be 3
    // pending requests as the spam deletion request was just enqueued and can only be voted on in the next round.
    assert.equal(await voting.methods.getNumberOfPriceRequests().call(), 4);
    assert.equal((await voting.methods.getPendingRequests().call()).length, 3);

    // Move to the next round to vote on the spam deletion request.
    await moveToNextRound(voting, accounts[0]);
    // Update account trackers to ensure rolling happens. After this there should be 7 requests: 3 original, 1 spam
    // deletion, 3 rolled.
    await voting.methods.updateTrackers(account2).send({ from: account2 });
    assert.equal(await voting.methods.getNumberOfPriceRequests().call(), 7);
    assert.equal((await voting.methods.getPendingRequests().call()).length, 4);

    // Now that the votes have been rolled we should expect the indices of all 3 requests to be updated.
    // (note that index 3 is occupied by the spam deletion request).
    assert.equal((await voting.methods.priceRequests(validRequestId).call()).priceRequestIndex, 4);
    assert.equal((await voting.methods.priceRequests(spamRequestId1).call()).priceRequestIndex, 5);
    assert.equal((await voting.methods.priceRequests(spamRequestId2).call()).priceRequestIndex, 6);

    // Now, vote on the valid requests and the spam deletion identifier.
    const account = account2;
    const roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    const salt = getRandomSignedInt();
    const hash1 = computeVoteHash({ price: toWei("1"), salt, account, roundId, time, identifier: validIdentifier });
    await voting.methods.commitVote(validIdentifier, time, hash1).send({ from: account2 });

    const hash2 = computeVoteHash({
      price: toWei("1"),
      salt,
      account,
      roundId,
      time: signalDeleteTime,
      identifier: spamDeleteIdentifier,
    });
    await voting.methods.commitVote(spamDeleteIdentifier, signalDeleteTime, hash2).send({ from: account2 });

    // There should still be 7 requests at this point.
    assert.equal(await voting.methods.getNumberOfPriceRequests().call(), 7);

    // Reveal the votes.
    await moveToNextPhase(voting, accounts[0]);
    await voting.methods.revealVote(spamDeleteIdentifier, signalDeleteTime, toWei("1"), salt).send({ from: account2 });
    await voting.methods.revealVote(validIdentifier, time, toWei("1"), salt).send({ from: account2 });

    // Execute the spam deletion call in the next round as the vote should have been resolved.
    await moveToNextRound(voting, accounts[0]);
    await voting.methods.executeSpamDeletion(0).send({ from: account1 });

    // The spam requests should have been deleted, they should have been removed from pending requests.
    assert.equal(await voting.methods.getNumberOfPriceRequests().call(), 7);
    assert.equal((await voting.methods.getPendingRequests().call()).length, 0);

    // All spam request status elements should be 0 (not requested) as they were deleted.
    let statuses = await voting.methods
      .getPriceRequestStatuses([
        { identifier: spamIdentifier, time: time + 1 },
        { identifier: spamIdentifier, time: time + 2 },
      ])
      .call();
    assert.equal(statuses[0].status, "0");
    assert.equal(statuses[1].status, "0");
    assert.equal(statuses[0].lastVotingRound, "0");
    assert.equal(statuses[1].lastVotingRound, "0");

    // Also all gettable spam request struct elements should be restored to defaults.
    let spamRequest1 = await voting.methods.priceRequests(spamRequestId1).call();
    let spamRequest2 = await voting.methods.priceRequests(spamRequestId2).call();
    assert.equal(spamRequest1.lastVotingRound, "0");
    assert.isFalse(spamRequest1.isGovernance);
    assert.equal(spamRequest1.pendingRequestIndex, "0");
    assert.equal(spamRequest1.priceRequestIndex, "0");
    assert.equal(spamRequest1.time, "0");
    assert.equal(spamRequest1.identifier, padRight(utf8ToHex(""), 64));
    assert.isNull(spamRequest1.ancillaryData);
    assert.equal(spamRequest2.lastVotingRound, "0");
    assert.isFalse(spamRequest2.isGovernance);
    assert.equal(spamRequest2.pendingRequestIndex, "0");
    assert.equal(spamRequest2.priceRequestIndex, "0");
    assert.equal(spamRequest2.time, "0");
    assert.equal(spamRequest2.identifier, padRight(utf8ToHex(""), 64));
    assert.isNull(spamRequest2.ancillaryData);

    // Update trackers should not add any new requests as the spam requests were deleted.

    assert.equal(await voting.methods.getNumberOfPriceRequests().call(), 7);
    await voting.methods.updateTrackers(account2).send({ from: account2 });
    assert.equal(await voting.methods.getNumberOfPriceRequests().call(), 7);

    // There should still be no pending requests.
    assert.equal((await voting.methods.getPendingRequests().call()).length, 0);

    // All spam request status elements should still be 0 (not requested).
    statuses = await voting.methods
      .getPriceRequestStatuses([
        { identifier: spamIdentifier, time: time },
        { identifier: spamIdentifier, time: time + 1 },
      ])
      .call();
    assert.equal(statuses[0].status, "0");
    assert.equal(statuses[1].status, "0");
    assert.equal(statuses[0].lastVotingRound, "0");
    assert.equal(statuses[1].lastVotingRound, "0");

    // Also all gettable spam request struct elements should still be initialized to defaults.
    spamRequest1 = await voting.methods.priceRequests(spamRequestId1).call();
    spamRequest2 = await voting.methods.priceRequests(spamRequestId2).call();
    assert.equal(spamRequest1.lastVotingRound, "0");
    assert.isFalse(spamRequest1.isGovernance);
    assert.equal(spamRequest1.pendingRequestIndex, "0");
    assert.equal(spamRequest1.priceRequestIndex, "0");
    assert.equal(spamRequest1.time, "0");
    assert.equal(spamRequest1.identifier, padRight(utf8ToHex(""), 64));
    assert.isNull(spamRequest1.ancillaryData);
    assert.equal(spamRequest2.lastVotingRound, "0");
    assert.isFalse(spamRequest2.isGovernance);
    assert.equal(spamRequest2.pendingRequestIndex, "0");
    assert.equal(spamRequest2.priceRequestIndex, "0");
    assert.equal(spamRequest2.time, "0");
    assert.equal(spamRequest2.identifier, padRight(utf8ToHex(""), 64));
    assert.isNull(spamRequest2.ancillaryData);

    // The valid request should have the correct properties.
    const validRequest = await voting.methods.priceRequests(validRequestId).call();
    assert.equal(validRequest.lastVotingRound, roundId.toString());
    assert.isFalse(validRequest.isGovernance);
    assert.equal(validRequest.pendingRequestIndex, "18446744073709551615"); // Int64 Max; used when a vote is resolved.
    assert.equal(validRequest.priceRequestIndex, "4");
    assert.equal(validRequest.time, time.toString());
    assert.equal(validRequest.identifier, validIdentifier);
    assert.isNull(validRequest.ancillaryData);
  });
  it("Rolled spam deletion does not balloon gas costs of other voters", async function () {
    // Consider the situation where someone spams the DVM with many requests and we are too slow to enqueue a spam
    // deletion request in time. In this situation the spam will need to be rolled to the next round. It is critical
    // that in this situation the core spam deletion logic continues to work such that gas costs for voter interactions
    // do not balloon out of control, enabling us to keep all the benefits of deletion while rolling. In theory, only the
    // first committer (or caller to updateTrackersRange after the roll) should have to pay the gas. This test shows this.

    await addNonSlashingVote();

    // Construct a test that creates 400 spam requests, This is 100 * 4.
    const numberOfRequestsPerMulticall = 100;
    const numberOfMulticallCalls = 4;
    const numberOfRequests = numberOfRequestsPerMulticall * numberOfMulticallCalls;
    await submitManySpamRequests(numberOfMulticallCalls, numberOfRequestsPerMulticall);

    // Mimic these being rolled to the following round, only in this subsequent round do we submit the spam deletion
    // request. This mimics us being too slow at submitting the deletion request.
    await moveToNextRound(voting, accounts[0]);
    assert.equal(await voting.methods.getNumberOfPriceRequests().call(), numberOfRequests + 1);

    let time = await voting.methods.getCurrentTime().call();
    await voting.methods.signalRequestsAsSpamForDeletion([[1, numberOfRequests]]).send({ from: account1 });

    // Move to the next round so we can vote on these.
    await moveToNextRound(voting, accounts[0]);

    // Due to the number of request we actually cant roll them all within the same transaction on the first commit.
    // To accommodate this we need to call updateTrackersRange multiple times. This idea here is that only ONE voter
    // needs to do this and no over voters should have to pay the gas.
    let didRunOutOfGas = false;
    try {
      await voting.methods.updateTrackers(account1).send({ from: account1 });
    } catch (error) {
      didRunOutOfGas = true;
      assert(error.data.stack.includes("Transaction ran out of gas"));
    }
    assert(didRunOutOfGas);

    await voting.methods.updateTrackersRange(account1, numberOfRequests / 2).send({ from: account1 });
    await voting.methods.updateTrackersRange(account1, numberOfRequests).send({ from: account1 });

    // Now we should be able to delete the spam requests by voting on them.
    const deleteIdentifier = padRight(utf8ToHex("SpamDeletionProposal 0"), 64);
    let account = account1;
    let roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    const salt = getRandomSignedInt();
    const hash = computeVoteHash({ price: toWei("1"), salt, account, roundId, time, identifier: deleteIdentifier });
    const tx = await voting.methods.commitVote(deleteIdentifier, time, hash).send({ from: account1 });
    assert.isBelow(tx.gasUsed, 200000); // The gas used by this commit action should be standard (<200k gas)

    // Reveal the votes.
    await moveToNextPhase(voting, accounts[0]);
    await voting.methods.revealVote(deleteIdentifier, time, toWei("1"), salt).send({ from: account1 });

    // Execute the spam deletion now that we've voted on it.
    await moveToNextRound(voting, accounts[0]);
    await voting.methods.executeSpamDeletion(0).send({ from: account1 });

    // After deletion, We should have 0 pending requests as they were all removed.
    assert.equal(await voting.methods.getPendingRequests().call(), 0);

    // Critically if a voter that did not participate in the spam deletion process tries to update their trackers
    // they should no pay any additional gas as this was covered by the: a) updateTrackersRange call and
    // b) executeSpamDeletion call.
    const tx2 = await voting.methods.updateTrackers(account2).send({ from: account2 });

    assert.isBelow(tx2.gasUsed, 150000); // The gas used by this commit action should be standard (<200k gas).

    // Tto prove the point, re-request another price and both voters when voting on this should not pay any outsized gas.
    time = (await voting.methods.getCurrentTime().call()) - 10;
    await voting.methods.requestPrice(validIdentifier, time).send({ from: registeredContract });

    await moveToNextRound(voting, accounts[0]); // Move to the next round so we can vote on these.
    roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    const hash1 = computeVoteHash({ price: toWei("1"), salt, account, roundId, time, identifier: validIdentifier });
    const tx3 = await voting.methods.commitVote(validIdentifier, time, hash1).send({ from: account1 });
    assert.isBelow(tx3.gasUsed, 200000); // The gas used by this commit action should be standard (<200k gas)
    account = account2;
    const hash2 = computeVoteHash({ price: toWei("1"), salt, account, roundId, time, identifier: validIdentifier });
    const tx4 = await voting.methods.commitVote(validIdentifier, time, hash2).send({ from: account2 });
    assert.isBelow(tx4.gasUsed, 200000); // The gas used by this commit action should be standard (<200k gas)

    // Reveal the votes.
    await moveToNextPhase(voting, accounts[0]);
    await voting.methods.revealVote(validIdentifier, time, toWei("1"), salt).send({ from: account1 });
    await voting.methods.revealVote(validIdentifier, time, toWei("1"), salt).send({ from: account2 });

    // Validate the price settled
    await moveToNextRound(voting, accounts[0]); // Move to the next round so we can get the price.
    assert.equal(await voting.methods.getPrice(validIdentifier, time).call({ from: registeredContract }), toWei("1"));
  });
  it("Can correctly handle more votes rolled on one round than can be deleted in one tx", async function () {
    // If enough votes are constructed in one round it is possible that we need to delete them in multiple spam deletion
    // requests (i.e due to the cost of the delete operation in executeSpamDeletion exceeding the block gas limit). This
    // test shows that, even in this situation, the spam deletion process is still able to delete all the spam votes and
    // That other voters are safe from paying any additional gas once the votes have been removed.

    // Construct a test that creates 1000 spam requests, This is 100 * 10.
    const numberOfRequestsPerMulticall = 100;
    const numberOfMulticallCalls = 10;
    const numberOfRequests = numberOfRequestsPerMulticall * numberOfMulticallCalls;
    await submitManySpamRequests(numberOfMulticallCalls, numberOfRequestsPerMulticall);

    // Mimic these being rolled.
    await moveToNextRound(voting, accounts[0]);
    assert.equal(await voting.methods.getNumberOfPriceRequests().call(), numberOfRequests);

    // From testing this directly, it is known that we can't execute a spam deletion for all the request in one go. To
    // Deal with this, we need to split this up over 3 spam deletion request so they can be executed separately later.
    const time = await voting.methods.getCurrentTime().call();
    await voting.methods.signalRequestsAsSpamForDeletion([[0, 333]]).send({ from: account1 });
    await voting.methods.signalRequestsAsSpamForDeletion([[334, 666]]).send({ from: account1 });
    await voting.methods.signalRequestsAsSpamForDeletion([[667, 1000]]).send({ from: account1 });
    assert.equal(await voting.methods.getNumberOfPriceRequests().call(), numberOfRequests + 3);
    await moveToNextRound(voting, accounts[0]);

    // Equally, We need to split up the update tracker process into multiple calls.
    await voting.methods.updateTrackersRange(account1, 300).send({ from: account1 });
    await voting.methods.updateTrackersRange(account1, 600).send({ from: account1 });
    await voting.methods.updateTrackersRange(account1, 900).send({ from: account1 });
    await voting.methods.updateTrackersRange(account1, 1000).send({ from: account1 });

    // Now, vote on the 3 spam deletion requests. Each of these votes should cost a standard amount of gas.
    const deleteIdentifier = padRight(utf8ToHex("SpamDeletionProposal 0"), 64);
    const account = account1;
    const roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    const salt = getRandomSignedInt();
    const hash = computeVoteHash({ price: toWei("1"), salt, account, roundId, time, identifier: deleteIdentifier });
    const tx1 = await voting.methods.commitVote(deleteIdentifier, time, hash).send({ from: account1 });
    assert.isBelow(tx1.gasUsed, 200000);

    const deleteIdentifier2 = padRight(utf8ToHex("SpamDeletionProposal 1"), 64);
    const hash2 = computeVoteHash({ price: toWei("1"), salt, account, roundId, time, identifier: deleteIdentifier2 });
    const tx2 = await voting.methods.commitVote(deleteIdentifier2, time, hash2).send({ from: account1 });
    assert.isBelow(tx2.gasUsed, 200000);

    const deleteIdentifier3 = padRight(utf8ToHex("SpamDeletionProposal 2"), 64);
    const hash3 = computeVoteHash({ price: toWei("1"), salt, account, roundId, time, identifier: deleteIdentifier3 });
    const tx3 = await voting.methods.commitVote(deleteIdentifier3, time, hash3).send({ from: account1 });
    assert.isBelow(tx3.gasUsed, 200000);

    // Reveal the votes.
    await moveToNextPhase(voting, accounts[0]);
    await voting.methods.revealVote(deleteIdentifier, time, toWei("1"), salt).send({ from: account1 });
    await voting.methods.revealVote(deleteIdentifier2, time, toWei("1"), salt).send({ from: account1 });
    await voting.methods.revealVote(deleteIdentifier3, time, toWei("1"), salt).send({ from: account1 });

    // Execute the spam deletion.
    await moveToNextRound(voting, accounts[0]);
    await voting.methods.executeSpamDeletion(0).send({ from: account1 });
    await voting.methods.executeSpamDeletion(1).send({ from: account1 });
    await voting.methods.executeSpamDeletion(2).send({ from: account1 });

    assert.equal((await voting.methods.getPendingRequests().call()).length, 0);

    // Finally, updating trackers, as per usual, should not cost an extra amount of gas due to the spam deletion.
    const tx4 = await voting.methods.updateTrackers(account1).send({ from: account1 });
    assert.isBelow(tx4.gasUsed, 200000);

    const tx5 = await voting.methods.updateTrackers(account2).send({ from: account2 });
    assert.isBelow(tx5.gasUsed, 200000);
  });
  const addNonSlashingVote = async () => {
    const zeroedSlashingSlashingLibraryTest = await ZeroedSlashingSlashingLibraryTest.new().send({ from: accounts[0] });
    await voting.methods
      .setSlashingLibrary(zeroedSlashingSlashingLibraryTest.options.address)
      .send({ from: accounts[0] });
    let identifier = padRight(utf8ToHex("slash-test-advance"), 64);
    let time = "420";
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });

    await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });
    let salt = getRandomSignedInt();
    let price = "69696969";
    await moveToNextRound(voting, accounts[0]); // Move into the commit phase.

    let baseRequest = { salt, roundId: (await voting.methods.getCurrentRoundId().call()).toString(), identifier };
    const hash = computeVoteHash({ ...baseRequest, price, account: account1, time });
    await voting.methods.commitVote(identifier, time, hash).send({ from: account1 });
    await moveToNextPhase(voting, accounts[0]);
    await voting.methods.revealVote(identifier, time, price, salt).send({ from: account1 });
    await moveToNextRound(voting, accounts[0]);

    await voting.methods.updateTrackers(account1).send({ from: account1 });
    await voting.methods.updateTrackers(account2).send({ from: account2 });

    await voting.methods
      .setSlashingLibrary((await SlashingLibrary.deployed()).options.address)
      .send({ from: accounts[0] });
  };

  const submitManySpamRequests = async (numberOfMulticallCalls, numberOfRequestsPerMulticall) => {
    const firstRequestTime = Number(await voting.methods.getCurrentTime().call()) - 10000;

    for (const j of [...Array(numberOfMulticallCalls).keys()]) {
      const priceRequestData = [];
      for (const i of [...Array(numberOfRequestsPerMulticall).keys()]) {
        const time = firstRequestTime + i + j * numberOfRequestsPerMulticall;
        priceRequestData.push(voting.methods.requestPrice(spamIdentifier, time).encodeABI());
      }
      await voting.methods.multicall(priceRequestData).send({ from: registeredContract });
    }
  };
});

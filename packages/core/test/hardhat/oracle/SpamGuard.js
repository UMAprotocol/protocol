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
  it("Correctly handles rolled votes", async function () {});
});

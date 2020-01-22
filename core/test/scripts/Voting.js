const VotingScript = require("../../scripts/Voting.js");
const Voting = artifacts.require("Voting");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const VotingToken = artifacts.require("VotingToken");
const Registry = artifacts.require("Registry");
const { RegistryRolesEnum, VotePhasesEnum } = require("../../../common/Enums.js");
const { moveToNextRound, moveToNextPhase } = require("../../utils/Voting.js");
const { computeTopicHash } = require("../../../common/EncryptionHelper.js");
const { createVisibleAccount } = require("../../../common/Crypto");

class MockNotifier {
  constructor() {
    this.notificationsSent = 0;
    this.lastSubject = null;
    this.lastBody = null;
  }

  async sendNotification(subject, body) {
    this.notificationsSent += 1;
    this.lastSubject = subject;
    this.lastBody = body;
  }
}

const TEST_IDENTIFIERS = {
  'test': {
    key: web3.utils.utf8ToHex("test"),
    expectedPrice: web3.utils.toWei("1.5")
  },
  'test-bad-reveal': {
    key: web3.utils.utf8ToHex("test-bad-reveal")
  },
  'test-overlapping1': {
    key: web3.utils.utf8ToHex("test-overlapping1"),
    expectedPrice: web3.utils.toWei("1.5")
  },
  'test-overlapping2': {
    key: web3.utils.utf8ToHex("test-overlapping2"),
    expectedPrice: web3.utils.toWei("1.5")
  },
  'TSLA': {
    key: web3.utils.utf8ToHex("TSLA"),
    hardcodedTimestamp: '1573513368',
    expectedPrice: web3.utils.toWei("345.07")
  },
  'Custom Index (1)': {
    key: web3.utils.utf8ToHex("Custom Index (1)"),
    expectedPrice: web3.utils.toWei("1")
  },
  'Custom Index (100)': {
    key: web3.utils.utf8ToHex("Custom Index (100)"),
    expectedPrice: web3.utils.toWei("100")
  },
  '0.5': {
    key: web3.utils.utf8ToHex("0.5"),
    expectedPrice: web3.utils.toWei("0.5")
  }
}

const getRandomTimestampInPast = () => {
  const salt = Math.floor(Math.random() * 100)
  return Math.round(Date.now()/1000 - 1000 * 60 * (60 + salt)).toString();
}

contract("scripts/Voting.js", function(accounts) {
  let voting;
  let votingToken;
  let registry;

  const account1 = accounts[0];
  const voter = accounts[1];

  before(async function() {
    voting = await Voting.deployed();
    supportedIdentifiers = await IdentifierWhitelist.deployed();
    votingToken = await VotingToken.deployed();
    registry = await Registry.deployed();

    // Register "derivative" with Registry, so we can make price requests in this test.
    await registry.addMember(RegistryRolesEnum.DERIVATIVE_CREATOR, account1);
    await registry.registerDerivative([], account1);

    // Give voter all of the tokens.
    const initialSupply = await votingToken.balanceOf(account1);
    await votingToken.transfer(voter, initialSupply);

    // Add supported identifiers
    for (k = 0; k < Object.keys(TEST_IDENTIFIERS).length; k++) {
      let key = TEST_IDENTIFIERS[Object.keys(TEST_IDENTIFIERS)[k]].key;
      await supportedIdentifiers.addSupportedIdentifier(key);
    }
  });

  beforeEach(async function() {
    // Each test starts at the beginning of a fresh round.
    await moveToNextRound(voting);
  });

  it("basic case", async function() {
    const identifier = TEST_IDENTIFIERS['test'].key;
    const time = getRandomTimestampInPast();

    // Request an Oracle price.
    await voting.requestPrice(identifier, time);

    // Move to the round in which voters will vote on the requested price.
    await moveToNextRound(voting);

    // Sanity check.
    assert.isFalse(await voting.hasPrice(identifier, time));

    const notifier = new MockNotifier();
    let votingSystem = new VotingScript.VotingSystem(voting, voter, [notifier], VotingScript.BATCH_MAX_TXNS);

    assert.equal(notifier.notificationsSent, 0);
    // The vote should have been committed.
    let result = await votingSystem.runIteration();
    assert.equal(result.batches, 1);
    assert.equal(result.updates.length, 1);
    assert.equal(result.skipped.length, 0);
    assert.equal(result.failures.length, 0);
    assert.equal(notifier.notificationsSent, 1);
    // Running again should send more emails but not execute any batch commits.
    result = await votingSystem.runIteration();
    assert.equal(result.batches, 0);
    assert.equal(result.updates.length, 0);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.failures.length, 0);
    assert.equal(notifier.notificationsSent, 2);

    // Move to the reveal phase.
    await moveToNextPhase(voting);

    // Replace the voting system object with a new one so the class can't persist the commit.
    votingSystem = new VotingScript.VotingSystem(voting, voter, [notifier], VotingScript.BATCH_MAX_TXNS);

    // This vote should have been removed from the persistence layer so we don't re-reveal.
    result = await votingSystem.runIteration();
    assert.equal(result.batches, 1);
    assert.equal(result.updates.length, 1);
    assert.equal(notifier.notificationsSent, 3);

    await moveToNextRound(voting);
    // The previous `runIteration()` should have revealed the vote, so the price request should be resolved.
    const hardcodedPrice = TEST_IDENTIFIERS['test'].expectedPrice;
    assert.equal(await voting.getPrice(identifier, time), hardcodedPrice);
  });

  it("reveal with bad data", async function() {
    const identifier = TEST_IDENTIFIERS["test-bad-reveal"].key;
    const time = getRandomTimestampInPast();

    // Request an Oracle price.
    await voting.requestPrice(identifier, time);

    // Move to the round in which voters will vote on the requested price.
    await moveToNextRound(voting);

    const notifier = new MockNotifier();
    let votingSystem = new VotingScript.VotingSystem(voting, voter, [notifier], VotingScript.BATCH_MAX_TXNS);

    assert.equal(notifier.notificationsSent, 0);
    // The vote should have been committed.
    let result = await votingSystem.runIteration();
    assert.equal(result.batches, 1);
    assert.equal(result.updates.length, 1);
    assert.equal(result.skipped.length, 0);
    assert.equal(result.failures.length, 0);
    assert.equal(notifier.notificationsSent, 1);

    // Move to the reveal phase.
    await moveToNextPhase(voting);

    // Replace the message with an indecipherable string.
    const roundId = await voting.getCurrentRoundId();
    const topicHash = computeTopicHash({ identifier, time }, roundId);
    await voting.sendMessage(voter, topicHash, web3.utils.randomHex(64), { from: voter });

    // Replace the voting system object with a new one so the class can't persist the commit.
    votingSystem = new VotingScript.VotingSystem(voting, voter, [notifier]);
    result = await votingSystem.runIteration();
    assert.equal(result.batches, 0);
    assert.equal(result.updates.length, 0);

    // Test that emails were sent.
    assert.equal(notifier.notificationsSent, 2);
  });

  it("simultaneous and overlapping votes", async function() {
    const identifier1 = TEST_IDENTIFIERS["test-overlapping1"].key;
    const time1 = "1000";
    const identifier2 = TEST_IDENTIFIERS["test-overlapping2"].key;
    const time2 = "1000";

    // Send three overlapping requests such that each parameter overlaps with one other request.
    await voting.requestPrice(identifier1, time1);
    await voting.requestPrice(identifier1, time2);
    await voting.requestPrice(identifier2, time2);

    // Move to the round in which voters will vote on the requested prices.
    await moveToNextRound(voting);
    const notifier = new MockNotifier();
    let votingSystem = new VotingScript.VotingSystem(voting, voter, [notifier], VotingScript.BATCH_MAX_TXNS);

    // The votes should have been committed.
    let result = await votingSystem.runIteration();
    assert.equal(result.batches, 1);
    assert.equal(result.updates.length, 3);
    assert.equal(result.skipped.length, 0);
    assert.equal(result.failures.length, 0);

    // Move to the reveal phase.
    await moveToNextPhase(voting);

    // Replace the voting system object with a new one so the class can't persist the commits.
    votingSystem = new VotingScript.VotingSystem(voting, voter, [notifier]);

    // This vote should have been removed from the persistence layer so we don't re-reveal.
    result = await votingSystem.runIteration();
    assert.equal(result.batches, 1);
    assert.equal(result.updates.length, 3);

    await moveToNextRound(voting);
    // The previous `runIteration()` should have revealed the vote, so the price request should be resolved.
    const hardcodedPrice = TEST_IDENTIFIERS["test-overlapping1"].expectedPrice;
    assert.equal(await voting.getPrice(identifier1, time1), hardcodedPrice);
    assert.equal(await voting.getPrice(identifier1, time2), hardcodedPrice);
    assert.equal(await voting.getPrice(identifier2, time2), hardcodedPrice);
  });

  it("Intrinio price", async function() {
    const identifier = TEST_IDENTIFIERS["TSLA"].key;
    const time = TEST_IDENTIFIERS["TSLA"].hardcodedTimestamp;

    // Request an Oracle price.
    await voting.requestPrice(identifier, time);

    // Move to the round in which voters will vote on the requested price.
    await moveToNextRound(voting);

    // Sanity check.
    assert.isFalse(await voting.hasPrice(identifier, time));

    const notifier = new MockNotifier();
    let votingSystem = new VotingScript.VotingSystem(voting, voter, [notifier], VotingScript.BATCH_MAX_TXNS);

    // The vote should have been committed.
    let result = await votingSystem.runIteration();
    assert.equal(result.batches, 1);
    assert.equal(result.updates.length, 1);
    assert.equal(result.skipped.length, 0);
    assert.equal(result.failures.length, 0);

    // Move to the reveal phase.
    await moveToNextPhase(voting);

    // Replace the voting system object with a new one so the class can't persist the commit.
    votingSystem = new VotingScript.VotingSystem(voting, voter, [notifier], VotingScript.BATCH_MAX_TXNS);

    // This vote should have been removed from the persistence layer so we don't re-reveal.
    result = await votingSystem.runIteration();
    assert.equal(result.batches, 1);
    assert.equal(result.updates.length, 1);

    await moveToNextRound(voting);
    // The previous `runIteration()` should have revealed the vote, so the price request should be resolved.
    assert.equal((await voting.getPrice(identifier, time)).toString(), TEST_IDENTIFIERS["TSLA"].expectedPrice);
  });

  it("Notification on crash", async function() {
    const identifier = TEST_IDENTIFIERS["Custom Index (1)"].key;
    const time = getRandomTimestampInPast();

    // Request an Oracle price.
    await voting.requestPrice(identifier, time);

    const notifier = new MockNotifier();
    const votingSystem = new VotingScript.VotingSystem(voting, voter, [notifier], VotingScript.BATCH_MAX_TXNS);

    // Simulate the commit reverting.
    const temp = votingSystem.voting.batchCommit;
    const errorMessage = "ABCDEF";
    votingSystem.voting.batchCommit = () => {
      throw errorMessage;
    };
    await moveToNextRound(voting);

    // Run an iteration, which should crash.
    await votingSystem.runIteration();

    // A notification email should be sent.
    assert.equal(notifier.notificationsSent, 1);
    assert(notifier.lastSubject.startsWith("Fatal error"));
    assert(notifier.lastBody.includes(errorMessage));

    // Restore the commit function and resolve the price request.
    votingSystem.voting.batchCommit = temp;
    await votingSystem.runIteration();
    await moveToNextPhase(voting);
    await votingSystem.runIteration();
    await moveToNextRound(voting);
  });

  it("Constant price", async function() {
    const identifier = TEST_IDENTIFIERS["Custom Index (1)"].key;
    const time = getRandomTimestampInPast();

    // Request an Oracle price.
    await voting.requestPrice(identifier, time);

    const votingSystem = new VotingScript.VotingSystem(
      voting,
      voter,
      [new MockNotifier()],
      VotingScript.BATCH_MAX_TXNS
    );
    await moveToNextRound(voting);
    let result = await votingSystem.runIteration();
    assert.equal(result.batches, 1);
    assert.equal(result.updates.length, 1);
    assert.equal(result.skipped.length, 0);
    assert.equal(result.failures.length, 0);
    await moveToNextPhase(voting);
    result = await votingSystem.runIteration();
    assert.equal(result.batches, 1);
    assert.equal(result.updates.length, 1);
    await moveToNextRound(voting);

    assert.equal((await voting.getPrice(identifier, time)).toString(), TEST_IDENTIFIERS["Custom Index (1)"].expectedPrice);
  });

  it("Numerator/Denominator", async function() {
    const identifier = TEST_IDENTIFIERS["0.5"].key;
    const time = getRandomTimestampInPast();

    // Request an Oracle price.
    await voting.requestPrice(identifier, time);

    const votingSystem = new VotingScript.VotingSystem(
      voting,
      voter,
      [new MockNotifier()],
      VotingScript.BATCH_MAX_TXNS
    );
    await moveToNextRound(voting);
    let result = await votingSystem.runIteration();
    assert.equal(result.batches, 1);
    assert.equal(result.updates.length, 1);
    assert.equal(result.skipped.length, 0);
    assert.equal(result.failures.length, 0);
    await moveToNextPhase(voting);
    result = await votingSystem.runIteration();
    assert.equal(result.batches, 1);
    assert.equal(result.updates.length, 1);
    await moveToNextRound(voting);

    assert.equal((await voting.getPrice(identifier, time)).toString(), TEST_IDENTIFIERS["0.5"].expectedPrice);
  });

  it("Only batches up to the maximum number of commits or reveals that can fit in one block", async function() {
    const identifier = TEST_IDENTIFIERS["Custom Index (100)"].key;
    const time = getRandomTimestampInPast();
    let testTransactions = Math.round(VotingScript.BATCH_MAX_TXNS * 2 + 1);

    // Request Oracle prices.
    for (i = 0; i < testTransactions; i++) {
      let timeToVote = parseInt(time) + i;
      await voting.requestPrice(identifier, timeToVote.toString());
    }

    // Sanity check.
    assert.isFalse(await voting.hasPrice(identifier, time));

    // Query pending requests to vote on during each phase.
    let pendingVotes = await voting.getPendingRequests();
    assert.equal(pendingVotes.length, 0, "There should be 0 pending requests during pre-commit phase");
    const votingSystem = new VotingScript.VotingSystem(
      voting,
      voter,
      [new MockNotifier()],
      VotingScript.BATCH_MAX_TXNS
    );

    // Move to commit phase.
    await moveToNextRound(voting);
    pendingVotes = await voting.getPendingRequests();
    assert.equal(
      pendingVotes.length,
      testTransactions,
      `There should be ${testTransactions} pending requests during commit phase`
    );
    await votingSystem.runIteration();

    // Move to reveal phase.
    await moveToNextPhase(voting);
    pendingVotes = await voting.getPendingRequests();
    assert.equal(
      pendingVotes.length,
      testTransactions,
      `There should be ${testTransactions} pending requests during reveal phase`
    );
    let result = await votingSystem.runIteration();
    let batchesExpected = Math.floor(testTransactions / VotingScript.BATCH_MAX_TXNS);
    if (testTransactions % VotingScript.BATCH_MAX_TXNS > 0) {
      batchesExpected += 1;
    }
    assert.equal(batchesExpected, result.batches);
    assert.equal(result.updates.length, testTransactions);
    assert.equal(result.skipped.length, 0);
    assert.equal(result.failures.length, 0);

    // End voting (commit & reveal) process.
    await moveToNextRound(voting);
    pendingVotes = await voting.getPendingRequests();
    assert.equal(pendingVotes.length, 0, `There should be 0 pending requests during post-reveal phase`);

    // Sanity check.
    assert.equal((await voting.getPrice(identifier, time)).toString(), TEST_IDENTIFIERS["Custom Index (100)"].expectedPrice);
  });
});

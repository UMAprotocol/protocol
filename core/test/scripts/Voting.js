const VotingScript = require("../../scripts/Voting.js");
const Voting = artifacts.require("Voting");
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

contract("scripts/Voting.js", function(accounts) {
  let voting;
  let votingToken;
  let registry;

  const account1 = accounts[0];
  const voter = accounts[1];

  before(async function() {
    voting = await Voting.deployed();
    votingToken = await VotingToken.deployed();
    registry = await Registry.deployed();

    // Register "derivative" with Registry, so we can make price requests in this test.
    await registry.addMember(RegistryRolesEnum.DERIVATIVE_CREATOR, account1);
    await registry.registerDerivative([], account1);

    // Give account1 all of the tokens.
    const minterRole = 1;
    await votingToken.addMember(minterRole, account1);
    await votingToken.mint(voter, web3.utils.toWei("1", "ether"));
  });

  beforeEach(async function() {
    // Each test starts at the beginning of a fresh round.
    await moveToNextRound(voting);
  });

  it("basic case", async function() {
    const identifier = web3.utils.utf8ToHex("test");
    const time = "1000";

    // Request an Oracle price.
    await voting.addSupportedIdentifier(identifier);
    await voting.requestPrice(identifier, time);

    // Move to the round in which voters will vote on the requested price.
    await moveToNextRound(voting);

    // Sanity check.
    assert.isFalse(await voting.hasPrice(identifier, time));

    const notifier = new MockNotifier();
    let votingSystem = new VotingScript.VotingSystem(voting, voter, [notifier]);

    assert.equal(notifier.notificationsSent, 0);
    // The vote should have been committed.
    await votingSystem.runIteration();
    assert.equal(notifier.notificationsSent, 1);
    // Running again should send more emails.
    await votingSystem.runIteration();
    assert.equal(notifier.notificationsSent, 2);

    // Move to the reveal phase.
    await moveToNextPhase(voting);

    // Replace the voting system object with a new one so the class can't persist the commit.
    votingSystem = new VotingScript.VotingSystem(voting, voter, [notifier]);

    // This vote should have been removed from the persistence layer so we don't re-reveal.
    await votingSystem.runIteration();
    assert.equal(notifier.notificationsSent, 3);

    await moveToNextRound(voting);
    // The previous `runIteration()` should have revealed the vote, so the price request should be resolved.
    const hardcodedPrice = web3.utils.toWei("1.5");
    assert.equal(await voting.getPrice(identifier, time), hardcodedPrice);
  });

  it("reveal with bad data", async function() {
    const identifier = web3.utils.utf8ToHex("test-bad-reveal");
    const time = "1000";

    // Request an Oracle price.
    await voting.addSupportedIdentifier(identifier);
    await voting.requestPrice(identifier, time);

    // Move to the round in which voters will vote on the requested price.
    await moveToNextRound(voting);

    const notifier = new MockNotifier();
    let votingSystem = new VotingScript.VotingSystem(voting, voter, [notifier]);

    assert.equal(notifier.notificationsSent, 0);
    // The vote should have been committed.
    await votingSystem.runIteration();
    assert.equal(notifier.notificationsSent, 1);

    // Move to the reveal phase.
    await moveToNextPhase(voting);

    // Replace the message with an indecipherable string.
    const roundId = await voting.getCurrentRoundId();
    const topicHash = computeTopicHash({ identifier, time }, roundId);
    await voting.sendMessage(voter, topicHash, web3.utils.randomHex(64), { from: voter });

    // Replace the voting system object with a new one so the class can't persist the commit.
    votingSystem = new VotingScript.VotingSystem(voting, voter, [notifier]);
    await votingSystem.runIteration();

    // Test that emails were sent.
    assert.equal(notifier.notificationsSent, 2);
  });

  it("simultaneous and overlapping votes", async function() {
    const identifier1 = web3.utils.utf8ToHex("test-overlapping1");
    const time1 = "1000";
    const identifier2 = web3.utils.utf8ToHex("test-overlapping2");
    const time2 = "1000";

    // Add both identifiers.
    await voting.addSupportedIdentifier(identifier1);
    await voting.addSupportedIdentifier(identifier2);

    // Send three overlapping requests such that each parameter overlaps with one other request.
    await voting.requestPrice(identifier1, time1);
    await voting.requestPrice(identifier1, time2);
    await voting.requestPrice(identifier2, time2);

    // Move to the round in which voters will vote on the requested prices.
    await moveToNextRound(voting);
    const notifier = new MockNotifier();
    let votingSystem = new VotingScript.VotingSystem(voting, voter, [notifier]);

    // The votes should have been committed.
    await votingSystem.runIteration();

    // Move to the reveal phase.
    await moveToNextPhase(voting);

    // Replace the voting system object with a new one so the class can't persist the commits.
    votingSystem = new VotingScript.VotingSystem(voting, voter, [notifier]);

    // This vote should have been removed from the persistence layer so we don't re-reveal.
    await votingSystem.runIteration();

    await moveToNextRound(voting);
    // The previous `runIteration()` should have revealed the vote, so the price request should be resolved.
    const hardcodedPrice = web3.utils.toWei("1.5");
    assert.equal(await voting.getPrice(identifier1, time1), hardcodedPrice);
    assert.equal(await voting.getPrice(identifier1, time2), hardcodedPrice);
    assert.equal(await voting.getPrice(identifier2, time2), hardcodedPrice);
  });

  it.only("Intrinio price", async function() {
    const identifier = web3.utils.utf8ToHex("TSLA");
    const time = "1573513368";

    // Request an Oracle price.
    await voting.addSupportedIdentifier(identifier);
    await voting.requestPrice(identifier, time);

    // Move to the round in which voters will vote on the requested price.
    await moveToNextRound(voting);

    // Sanity check.
    assert.isFalse(await voting.hasPrice(identifier, time));

    const notifier = new MockNotifier();
    let votingSystem = new VotingScript.VotingSystem(voting, voter, [notifier]);

    // The vote should have been committed.
    await votingSystem.runIteration();

    // Move to the reveal phase.
    await moveToNextPhase(voting);

    // Replace the voting system object with a new one so the class can't persist the commit.
    votingSystem = new VotingScript.VotingSystem(voting, voter, [notifier]);

    // This vote should have been removed from the persistence layer so we don't re-reveal.
    await votingSystem.runIteration();

    await moveToNextRound(voting);
    // The previous `runIteration()` should have revealed the vote, so the price request should be resolved.
    assert.equal((await voting.getPrice(identifier, time)).toString(), web3.utils.toWei("346.84"));
  });

  it("Notification on crash", async function() {
    const identifier = web3.utils.utf8ToHex("Custom Index (1)");
    const time = "1560762000";

    // Request an Oracle price.
    await voting.addSupportedIdentifier(identifier);
    await voting.requestPrice(identifier, time);

    const notifier = new MockNotifier();
    const votingSystem = new VotingScript.VotingSystem(voting, voter, [notifier]);

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
    const identifier = web3.utils.utf8ToHex("Custom Index (1)");
    const time = "1560762000";

    // Request an Oracle price.
    await voting.addSupportedIdentifier(identifier);
    await voting.requestPrice(identifier, time);

    const votingSystem = new VotingScript.VotingSystem(voting, voter, [new MockNotifier()]);
    await moveToNextRound(voting);
    await votingSystem.runIteration();
    await moveToNextPhase(voting);
    await votingSystem.runIteration();
    await moveToNextRound(voting);

    assert.equal((await voting.getPrice(identifier, time)).toString(), web3.utils.toWei("1"));
  });

  it("Numerator/Denominator", async function() {
    const identifier = web3.utils.utf8ToHex("0.5");
    const time = "1560762000";

    VotingScript.SUPPORTED_IDENTIFIERS["0.5"] = {
      numerator: {
        dataSource: "Constant",
        value: "1"
      },
      denominator: {
        dataSource: "Constant",
        value: "2"
      }
    };
    // Request an Oracle price.
    await voting.addSupportedIdentifier(identifier);
    await voting.requestPrice(identifier, time);

    const votingSystem = new VotingScript.VotingSystem(voting, voter, [new MockNotifier()]);
    await moveToNextRound(voting);
    await votingSystem.runIteration();
    await moveToNextPhase(voting);
    await votingSystem.runIteration();
    await moveToNextRound(voting);

    assert.equal((await voting.getPrice(identifier, time)).toString(), web3.utils.toWei("0.5"));
  });
});

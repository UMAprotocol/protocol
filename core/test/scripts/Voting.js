const VotingScript = require("../../scripts/Voting.js");
const Voting = artifacts.require("Voting");
const VotingToken = artifacts.require("VotingToken");
const Registry = artifacts.require("Registry");
const { RegistryRolesEnum, VotePhasesEnum } = require("../../utils/Enums.js");
const { moveToNextRound, moveToNextPhase } = require("../../utils/Voting.js");

class MockEmailSender {
  constructor() {
    this.emailsSent = 0;
  }

  sendEmailNotification() {
    this.emailsSent += 1;
  }
}

contract("scripts/Voting.js", function(accounts) {
  let voting;
  let votingToken;
  let registry;

  const account1 = accounts[0];

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
    await votingToken.mint(account1, web3.utils.toWei("1", "ether"));
  });

  beforeEach(async function() {
    // Each test starts at the beginning of a fresh round.
    await moveToNextRound(voting);
  });

  it("basic case", async function() {
    const identifier = web3.utils.utf8ToHex("one-voter");
    const time = "1000";

    // Request an Oracle price.
    await voting.addSupportedIdentifier(identifier);
    await voting.requestPrice(identifier, time);

    // Move to the round in which voters will vote on the requested price.
    await moveToNextRound(voting);

    const pendingRequest = (await voting.getPendingRequests())[0];
    const roundId = await voting.getCurrentRoundId();
    // Both the persistence and the actual price fetching haven't been implemented yet, so for the purpose of this
    // test case, we use these same hardcoded values.
    const persistenceKey = { pendingRequest, roundId };
    const hardcodedPrice = web3.utils.toWei("1.5");

    // Sanity check.
    assert.isFalse(await voting.hasPrice(identifier, time));

    const persistence = {};
    const emailSender = new MockEmailSender();
    const votingSystem = new VotingScript.VotingSystem(voting, persistence, emailSender);

    assert.equal(emailSender.emailsSent, 0);
    // The vote should have been committed.
    await votingSystem.runIteration();
    assert.equal(emailSender.emailsSent, 1);
    // Running again shouldn't send more emails.
    await votingSystem.runIteration();
    assert.equal(emailSender.emailsSent, 1);
    assert.equal(persistence[persistenceKey].price, hardcodedPrice);

    // Move to the reveal phase.
    await moveToNextPhase(voting);

    // This vote should have been removed from the persistence layer so we don't re-reveal.
    await votingSystem.runIteration();
    assert.isFalse({ pendingRequest, roundId } in persistence);
    assert.equal(emailSender.emailsSent, 2);
    // Running again shouldn't send more emails.
    await votingSystem.runIteration();
    assert.equal(emailSender.emailsSent, 2);

    await moveToNextRound(voting);
    // The previous `runIteration()` should have revealed the vote, so the price request should be resolved.
    assert.equal(await voting.getPrice(identifier, time), hardcodedPrice);
  });
});

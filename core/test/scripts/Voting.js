const VotingScript = require("../../scripts/Voting.js");
const Voting = artifacts.require("Voting");
const VotingToken = artifacts.require("VotingToken");
const Registry = artifacts.require("Registry");
const EncryptedSender = artifacts.require("EncryptedSender");
const { RegistryRolesEnum, VotePhasesEnum } = require("../../utils/Enums.js");
const { moveToNextRound, moveToNextPhase } = require("../../utils/Voting.js");
const { createVisibleAccount } = require("../../utils/Crypto");

contract("scripts/Voting.js", function(accounts) {
  let voting;
  let votingToken;
  let registry;
  let encryptedSender;

  const account1 = accounts[0];
  let voter;
  let privKey;

  before(async function() {
    voting = await Voting.deployed();
    votingToken = await VotingToken.deployed();
    registry = await Registry.deployed();
    encryptedSender = await EncryptedSender.deployed();

    // Load the keys and add them to the wallets object on the provider.
    let pubKey;
    ({ address: voter, privKey, pubKey } = await createVisibleAccount(web3));
    if (!web3.currentProvider.wallets) {
      // If no wallets object has been created, create one.
      web3.currentProvider.wallets = {};
    }
    // Format the private and public keys for the wallet.
    web3.currentProvider.wallets[voter] = {
      _privKey: Buffer.from(privKey.substr(2), "hex"),
      _pubKey: Buffer.from(pubKey.substr(2), "hex")
    };

    // Fund the voter account.
    await web3.eth.sendTransaction({ from: accounts[9], to: voter, value: web3.utils.toWei("5", "ether") });

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
    const identifier = web3.utils.utf8ToHex("one-voter");
    const time = "1000";

    // Request an Oracle price.
    await voting.addSupportedIdentifier(identifier);
    await voting.requestPrice(identifier, time);

    // Move to the round in which voters will vote on the requested price.
    await moveToNextRound(voting);

    // Sanity check.
    assert.isFalse(await voting.hasPrice(identifier, time));
    let votingSystem = new VotingScript.VotingSystem(voting, encryptedSender, voter);

    // The vote should have been committed.
    await votingSystem.runIteration();

    // Move to the reveal phase.
    await moveToNextPhase(voting);

    // Replace the voting system object with a new one so the class can't persist the commit.
    votingSystem = new VotingScript.VotingSystem(voting, encryptedSender, voter);

    // This vote should have been removed from the persistence layer so we don't re-reveal.
    await votingSystem.runIteration();

    await moveToNextRound(voting);
    // The previous `runIteration()` should have revealed the vote, so the price request should be resolved.
    const hardcodedPrice = web3.utils.toWei("1.5");
    assert.equal(await voting.getPrice(identifier, time), hardcodedPrice);
  });

  it("simultaneous and overlapping votes", async function() {
    const identifier1 = web3.utils.utf8ToHex("overlapping1");
    const time1 = "1000";
    const identifier2 = web3.utils.utf8ToHex("overlapping2");
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
    let votingSystem = new VotingScript.VotingSystem(voting, encryptedSender, voter);

    // The votes should have been committed.
    await votingSystem.runIteration();

    // Move to the reveal phase.
    await moveToNextPhase(voting);

    // Replace the voting system object with a new one so the class can't persist the commits.
    votingSystem = new VotingScript.VotingSystem(voting, encryptedSender, voter);

    // This vote should have been removed from the persistence layer so we don't re-reveal.
    await votingSystem.runIteration();

    await moveToNextRound(voting);
    // The previous `runIteration()` should have revealed the vote, so the price request should be resolved.
    const hardcodedPrice = web3.utils.toWei("1.5");
    assert.equal(await voting.getPrice(identifier1, time1), hardcodedPrice);
    assert.equal(await voting.getPrice(identifier1, time2), hardcodedPrice);
    assert.equal(await voting.getPrice(identifier2, time2), hardcodedPrice);
  });
});

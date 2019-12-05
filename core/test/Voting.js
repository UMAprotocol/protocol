const { didContractThrow } = require("../../common/SolidityTestUtils.js");
const { RegistryRolesEnum, VotePhasesEnum } = require("../../common/Enums.js");
const { getRandomSignedInt, getRandomUnsignedInt } = require("../../common/Random.js");
const { decryptMessage, encryptMessage, deriveKeyPairFromSignatureTruffle } = require("../../common/Crypto");
const { moveToNextRound, moveToNextPhase } = require("../utils/Voting.js");
const { computeTopicHash, getKeyGenMessage } = require("../../common/EncryptionHelper.js");
const truffleAssert = require("truffle-assertions");

const Finder = artifacts.require("Finder");
const Registry = artifacts.require("Registry");
const Voting = artifacts.require("Voting");
const VotingToken = artifacts.require("VotingToken");

contract("Voting", function(accounts) {
  let voting;
  let votingToken;
  let registry;

  const account1 = accounts[0];
  const account2 = accounts[1];
  const account3 = accounts[2];
  const account4 = accounts[3];
  const registeredDerivative = accounts[4];
  const unregisteredDerivative = accounts[5];
  const migratedVoting = accounts[6];

  const setNewInflationRate = async inflationRate => {
    await voting.setInflationRate({ rawValue: inflationRate.toString() });
  };

  before(async function() {
    voting = await Voting.deployed();
    votingToken = await VotingToken.deployed();
    registry = await Registry.deployed();

    // Allow account1 to mint tokens.
    const minterRole = 1;
    await votingToken.addMember(minterRole, account1);

    // Mint a single token to each of the 3 accounts so they all have ~33% of the vote.
    await votingToken.mint(account1, web3.utils.toWei("1", "ether"));
    await votingToken.mint(account2, web3.utils.toWei("1", "ether"));
    await votingToken.mint(account3, web3.utils.toWei("1", "ether"));

    // Mint 0.1 tokens to the last account so that its vote would not reach the GAT.
    await votingToken.mint(account4, web3.utils.toWei(".1", "ether"));

    // Set the inflation rate to 0 by default, so the balances stay fixed until inflation is tested.
    await setNewInflationRate("0");

    // Register derivative with Registry.
    await registry.addMember(RegistryRolesEnum.DERIVATIVE_CREATOR, account1);
    await registry.registerDerivative([], registeredDerivative, { from: account1 });
  });

  it("Constructor", async function() {
    const invalidGat = { rawValue: web3.utils.toWei("5") };
    const finder = await Finder.deployed();
    assert(
      await didContractThrow(
        Voting.new(5, invalidGat, { rawValue: web3.utils.toWei("1") }, votingToken.address, finder.address, true)
      )
    );
  });

  it("Vote phasing", async function() {
    // Reset the rounds.
    await moveToNextRound(voting);

    // Rounds should start with Commit.
    assert.equal((await voting.getVotePhase()).toString(), VotePhasesEnum.COMMIT);

    // Shift of one phase should be Reveal.
    await moveToNextPhase(voting);
    assert.equal((await voting.getVotePhase()).toString(), VotePhasesEnum.REVEAL);

    // A second shift should go back to commit.
    await moveToNextPhase(voting);
    assert.equal((await voting.getVotePhase()).toString(), VotePhasesEnum.COMMIT);
  });

  it("One voter, one request", async function() {
    const identifier = web3.utils.utf8ToHex("one-voter");
    const time = "1000";

    // Make the Oracle support this identifier.
    await voting.addSupportedIdentifier(identifier);

    // Request a price and move to the next round where that will be voted on.
    await voting.requestPrice(identifier, time, { from: registeredDerivative });
    assert.equal((await voting.getCurrentRoundId()).toString(), "2");
    assert.equal((await voting.getVotePhase()).toString(), VotePhasesEnum.COMMIT);
    await moveToNextRound(voting);

    const price = getRandomSignedInt();
    const salt = getRandomUnsignedInt();
    const hash = web3.utils.soliditySha3(price, salt);

    // Can't commit hash of 0.
    assert(await didContractThrow(voting.commitVote(identifier, time, "0x0")));

    // Can commit a new hash.
    await voting.commitVote(identifier, time, hash);

    // Voters can alter their commits.
    const newPrice = getRandomSignedInt();
    const newSalt = getRandomUnsignedInt();
    const newHash = web3.utils.soliditySha3(newPrice, newSalt);

    // Can alter a committed hash.
    await voting.commitVote(identifier, time, newHash);

    // Can't reveal before during the commit phase.
    assert(await didContractThrow(voting.revealVote(identifier, time, newPrice, newSalt)));

    // Move to the reveal phase.
    await moveToNextPhase(voting);

    // Can't commit during the reveal phase.
    assert(await didContractThrow(voting.commitVote(identifier, time, newHash)));

    // Can't reveal the overwritten commit.
    assert(await didContractThrow(voting.revealVote(identifier, time, price, salt)));

    // Can't reveal with the wrong price but right salt, and reverse.
    assert(await didContractThrow(voting.revealVote(identifier, time, newPrice, salt)));
    assert(await didContractThrow(voting.revealVote(identifier, time, price, newSalt)));

    // Successfully reveal the latest commit.
    await voting.revealVote(identifier, time, newPrice, newSalt);

    // Can't reveal the same commit again.
    assert(await didContractThrow(voting.revealVote(identifier, time, newPrice, newSalt)));
  });

  it("Multiple voters", async function() {
    const identifier = web3.utils.utf8ToHex("multiple-voters");
    const time = "1000";

    // Make the Oracle support this identifier.
    await voting.addSupportedIdentifier(identifier);

    await voting.requestPrice(identifier, time, { from: registeredDerivative });
    await moveToNextRound(voting);

    const price1 = getRandomSignedInt();
    const salt1 = getRandomUnsignedInt();
    const hash1 = web3.utils.soliditySha3(price1, salt1);

    const price2 = getRandomSignedInt();
    const salt2 = getRandomUnsignedInt();
    const hash2 = web3.utils.soliditySha3(price2, salt2);

    // Voter3 wants to vote the same price as voter1.
    const price3 = price1;
    const salt3 = getRandomUnsignedInt();
    const hash3 = web3.utils.soliditySha3(price3, salt3);

    // Multiple voters can commit.
    await voting.commitVote(identifier, time, hash1, { from: account1 });
    await voting.commitVote(identifier, time, hash2, { from: account2 });
    await voting.commitVote(identifier, time, hash3, { from: account3 });

    // Move to the reveal phase.
    await moveToNextPhase(voting);

    // They can't reveal each other's votes.
    assert(await didContractThrow(voting.revealVote(identifier, time, price2, salt2, { from: account1 })));
    assert(await didContractThrow(voting.revealVote(identifier, time, price3, salt3, { from: account1 })));
    assert(await didContractThrow(voting.revealVote(identifier, time, price1, salt1, { from: account2 })));
    assert(await didContractThrow(voting.revealVote(identifier, time, price3, salt3, { from: account2 })));
    assert(await didContractThrow(voting.revealVote(identifier, time, price1, salt1, { from: account3 })));
    assert(await didContractThrow(voting.revealVote(identifier, time, price2, salt2, { from: account3 })));

    // Someone who didn't even commit can't reveal anything either.
    assert(await didContractThrow(voting.revealVote(identifier, time, price1, salt1, { from: account4 })));
    assert(await didContractThrow(voting.revealVote(identifier, time, price2, salt2, { from: account4 })));
    assert(await didContractThrow(voting.revealVote(identifier, time, price3, salt3, { from: account4 })));

    // They can reveal their own votes.
    await voting.revealVote(identifier, time, price1, salt1, { from: account1 });
    await voting.revealVote(identifier, time, price2, salt2, { from: account2 });
    await voting.revealVote(identifier, time, price3, salt3, { from: account3 });
  });

  it("Overlapping request keys", async function() {
    // Verify that concurrent votes with the same identifier but different times, or the same time but different
    // identifiers don't cause any problems.
    const identifier1 = web3.utils.utf8ToHex("overlapping-keys1");
    const time1 = "1000";
    const identifier2 = web3.utils.utf8ToHex("overlapping-keys2");
    const time2 = "2000";

    // Make the Oracle support these two identifiers.
    await voting.addSupportedIdentifier(identifier1);
    await voting.addSupportedIdentifier(identifier2);

    // Send the requests.
    await voting.requestPrice(identifier1, time2, { from: registeredDerivative });
    await voting.requestPrice(identifier2, time1, { from: registeredDerivative });

    // Move to voting round.
    await moveToNextRound(voting);

    const price1 = getRandomSignedInt();
    const salt1 = getRandomUnsignedInt();
    const hash1 = web3.utils.soliditySha3(price1, salt1);

    const price2 = getRandomSignedInt();
    const salt2 = getRandomUnsignedInt();
    const hash2 = web3.utils.soliditySha3(price2, salt2);

    await voting.commitVote(identifier1, time2, hash1);
    await voting.commitVote(identifier2, time1, hash2);

    // Move to the reveal phase.
    await moveToNextPhase(voting);

    // Can't reveal the wrong combos.
    assert(await didContractThrow(voting.revealVote(identifier1, time2, price2, salt2)));
    assert(await didContractThrow(voting.revealVote(identifier2, time1, price1, salt1)));
    assert(await didContractThrow(voting.revealVote(identifier1, time1, price1, salt1)));
    assert(await didContractThrow(voting.revealVote(identifier1, time1, price2, salt2)));

    // Can reveal the right combos.
    await voting.revealVote(identifier1, time2, price1, salt1);
    await voting.revealVote(identifier2, time1, price2, salt2);
  });

  it("Request and retrieval", async function() {
    const identifier1 = web3.utils.utf8ToHex("request-retrieval1");
    const time1 = "1000";
    const identifier2 = web3.utils.utf8ToHex("request-retrieval2");
    const time2 = "2000";

    // Make the Oracle support these two identifiers.
    await voting.addSupportedIdentifier(identifier1);
    await voting.addSupportedIdentifier(identifier2);

    // Requests should not be added to the current voting round.
    await voting.requestPrice(identifier1, time1, { from: registeredDerivative });
    await voting.requestPrice(identifier2, time2, { from: registeredDerivative });

    // Since the round for these requests has not started, the price retrieval should fail.
    assert.isFalse(await voting.hasPrice(identifier1, time1, { from: registeredDerivative }));
    assert.isFalse(await voting.hasPrice(identifier2, time2, { from: registeredDerivative }));
    assert(await didContractThrow(voting.getPrice(identifier1, time1, { from: registeredDerivative })));
    assert(await didContractThrow(voting.getPrice(identifier2, time2, { from: registeredDerivative })));

    // Move to the voting round.
    await moveToNextRound(voting);

    // Commit vote 1.
    const price1 = getRandomSignedInt();
    const salt1 = getRandomUnsignedInt();
    const hash1 = web3.utils.soliditySha3(price1, salt1);
    await voting.commitVote(identifier1, time1, hash1);

    // Commit vote 2.
    const price2 = getRandomSignedInt();
    const salt2 = getRandomUnsignedInt();
    const hash2 = web3.utils.soliditySha3(price2, salt2);
    await voting.commitVote(identifier2, time2, hash2);

    // If the voting period is ongoing, prices cannot be returned since they are not finalized.
    assert.isFalse(await voting.hasPrice(identifier1, time1, { from: registeredDerivative }));
    assert.isFalse(await voting.hasPrice(identifier2, time2, { from: registeredDerivative }));
    assert(await didContractThrow(voting.getPrice(identifier1, time1, { from: registeredDerivative })));
    assert(await didContractThrow(voting.getPrice(identifier2, time2, { from: registeredDerivative })));

    // Move to the reveal phase of the voting period.
    await moveToNextPhase(voting);

    // Reveal both votes.
    await voting.revealVote(identifier1, time1, price1, salt1);
    await voting.revealVote(identifier2, time2, price2, salt2);

    // Prices cannot be provided until both commit and reveal for the current round have finished.
    assert.isFalse(await voting.hasPrice(identifier1, time1, { from: registeredDerivative }));
    assert.isFalse(await voting.hasPrice(identifier2, time2, { from: registeredDerivative }));
    assert(await didContractThrow(voting.getPrice(identifier1, time1, { from: registeredDerivative })));
    assert(await didContractThrow(voting.getPrice(identifier2, time2, { from: registeredDerivative })));

    // Move past the voting round.
    await moveToNextRound(voting);

    // Note: all voting results are currently hardcoded to 1.
    assert.isTrue(await voting.hasPrice(identifier1, time1, { from: registeredDerivative }));
    assert.isTrue(await voting.hasPrice(identifier2, time2, { from: registeredDerivative }));
    assert.equal(
      (await voting.getPrice(identifier1, time1, { from: registeredDerivative })).toString(),
      price1.toString()
    );
    assert.equal(
      (await voting.getPrice(identifier2, time2, { from: registeredDerivative })).toString(),
      price2.toString()
    );
  });

  it("Future price requests disallowed", async function() {
    await moveToNextRound(voting);

    const startingTime = await voting.getCurrentTime();
    const identifier = web3.utils.utf8ToHex("future-request");

    // Make the Oracle support this identifier.
    await voting.addSupportedIdentifier(identifier);

    // Time 1 is in the future and should fail.
    const timeFail = startingTime.addn(1).toString();

    // Time 2 is in the past and should succeed.
    const timeSucceed = startingTime.subn(1).toString();

    assert(await didContractThrow(voting.requestPrice(identifier, timeFail, { from: registeredDerivative })));
    await voting.requestPrice(identifier, timeSucceed, { from: registeredDerivative });

    // Finalize this vote.
    await moveToNextRound(voting);
    const price = getRandomSignedInt();
    const salt = getRandomUnsignedInt();
    const hash = web3.utils.soliditySha3(price, salt);
    await voting.commitVote(identifier, timeSucceed, hash);

    // Move to reveal phase and reveal vote.
    await moveToNextPhase(voting);
    await voting.revealVote(identifier, timeSucceed, price, salt);
  });

  it("Request timing", async function() {
    await moveToNextRound(voting);

    const startingTime = await voting.getCurrentTime();
    const identifier = web3.utils.utf8ToHex("request-timing");
    const time = "1000";

    // Make the Oracle support this identifier.
    await voting.addSupportedIdentifier(identifier);

    // Two stage call is required to get the expected return value from the second call.
    // The expected resolution time should be the end of the *next* round.
    const preRoundExpectedResolution = (await voting.requestPrice.call(identifier, time, {
      from: registeredDerivative
    })).toNumber();
    await voting.requestPrice(identifier, time, { from: registeredDerivative });
    // Calling request price again should be safe and should return the same value.
    const recheckedExpectedResolution = await voting.requestPrice.call(identifier, time, {
      from: registeredDerivative
    });
    await voting.requestPrice(identifier, time, { from: registeredDerivative });
    assert.equal(recheckedExpectedResolution.toString(), preRoundExpectedResolution.toString());

    const requestRoundTime = (await voting.getCurrentTime()).toNumber();

    // The expected resolution time should be after all times in the request round.
    assert.isAbove(preRoundExpectedResolution, requestRoundTime);

    // A redundant request in the same round should produce the exact same expected resolution time.
    assert.equal(
      (await voting.requestPrice.call(identifier, time, { from: registeredDerivative })).toNumber(),
      preRoundExpectedResolution
    );
    await voting.requestPrice(identifier, time, { from: registeredDerivative });

    // Move to the voting round.
    await moveToNextRound(voting);
    const votingRoundTime = (await voting.getCurrentTime()).toNumber();

    // Expected resolution time should be after the
    assert.isAbove(preRoundExpectedResolution, votingRoundTime);

    // A redundant request during the voting round should return the same estimated time.
    assert.equal(
      (await voting.requestPrice.call(identifier, time, { from: registeredDerivative })).toNumber(),
      preRoundExpectedResolution
    );
    await voting.requestPrice(identifier, time, { from: registeredDerivative });

    // Commit vote.
    const price = getRandomSignedInt();
    const salt = getRandomUnsignedInt();
    const hash = web3.utils.soliditySha3(price, salt);
    await voting.commitVote(identifier, time, hash);

    // Move to reveal phase and reveal vote.
    await moveToNextPhase(voting);
    await voting.revealVote(identifier, time, price, salt);

    await moveToNextRound(voting);
    const postVoteTime = (await voting.getCurrentTime()).toNumber();
    assert.isAtMost(preRoundExpectedResolution, postVoteTime);

    // Now that the request has been resolved, requestPrice should always return 0.
    assert.equal((await voting.requestPrice.call(identifier, time, { from: registeredDerivative })).toNumber(), 0);
    await voting.requestPrice(identifier, time, { from: registeredDerivative });
  });

  it("Retrieval timing", async function() {
    await moveToNextRound(voting);

    const identifier = web3.utils.utf8ToHex("retrieval-timing");
    const time = "1000";

    // Make the Oracle support this identifier.
    await voting.addSupportedIdentifier(identifier);

    // Two stage call is required to get the expected return value from the second call.
    // The expected resolution time should be the end of the *next* round.
    await voting.requestPrice(identifier, time, { from: registeredDerivative });

    // Cannot get the price before the voting round begins.
    assert(await didContractThrow(voting.getPrice(identifier, time, { from: registeredDerivative })));

    await moveToNextRound(voting);

    // Cannot get the price while the voting is ongoing.
    assert(await didContractThrow(voting.getPrice(identifier, time, { from: registeredDerivative })));

    // Commit vote.
    const price = getRandomSignedInt();
    const salt = getRandomUnsignedInt();
    const hash = web3.utils.soliditySha3(price, salt);
    await voting.commitVote(identifier, time, hash);

    // Move to reveal phase and reveal vote.
    await moveToNextPhase(voting);
    await voting.revealVote(identifier, time, price, salt);

    // Cannot get the price during the reveal phase.
    assert(await didContractThrow(voting.getPrice(identifier, time, { from: registeredDerivative })));

    await moveToNextRound(voting);

    // After the voting round is over, the price should be retrievable.
    assert.equal(
      (await voting.getPrice(identifier, time, { from: registeredDerivative })).toString(),
      price.toString()
    );
  });

  it("Pending Requests", async function() {
    await moveToNextRound(voting);

    const startingTime = await voting.getCurrentTime();
    const identifier1 = web3.utils.utf8ToHex("pending-requests1");
    const time1 = "1000";
    const identifier2 = web3.utils.utf8ToHex("pending-requests2");
    const time2 = "1001";

    // Make the Oracle support these identifiers.
    await voting.addSupportedIdentifier(identifier1);
    await voting.addSupportedIdentifier(identifier2);

    // Pending requests should be empty for this new round.
    assert.equal((await voting.getPendingRequests()).length, 0);

    // Two stage call is required to get the expected return value from the second call.
    // The expected resolution time should be the end of the *next* round.
    await voting.requestPrice(identifier1, time1, { from: registeredDerivative });

    // Pending requests should be empty before the voting round begins.
    assert.equal((await voting.getPendingRequests()).length, 0);

    // Pending requests should be have a single entry now that voting has started.
    await moveToNextRound(voting);
    assert.equal((await voting.getPendingRequests()).length, 1);

    // Add a new request during the voting round.
    await voting.requestPrice(identifier2, time2, { from: registeredDerivative });

    // Pending requests should still be 1 because this request should not be voted on until next round.
    assert.equal((await voting.getPendingRequests()).length, 1);

    // Move to next round and roll the first request over.
    await moveToNextRound(voting);

    // Pending requests should be 2 because one vote was rolled over and the second was dispatched after the previous
    // voting round started.
    assert.equal((await voting.getPendingRequests()).length, 2);

    // Commit votes.
    const price1 = getRandomSignedInt();
    const salt1 = getRandomUnsignedInt();
    const hash1 = web3.utils.soliditySha3(price1, salt1);
    await voting.commitVote(identifier1, time1, hash1);

    const price2 = getRandomSignedInt();
    const salt2 = getRandomUnsignedInt();
    const hash2 = web3.utils.soliditySha3(price2, salt2);
    await voting.commitVote(identifier2, time2, hash2);

    // Pending requests should still have a single entry in the reveal phase.
    await moveToNextPhase(voting);
    assert.equal((await voting.getPendingRequests()).length, 2);

    // Reveal vote.
    await voting.revealVote(identifier1, time1, price1, salt1);
    await voting.revealVote(identifier2, time2, price2, salt2);

    // Pending requests should be empty after the voting round ends and the price is resolved.
    await moveToNextRound(voting);
    assert.equal((await voting.getPendingRequests()).length, 0);
  });

  it("Supported identifiers", async function() {
    const voting = await Voting.deployed();

    const supported = web3.utils.utf8ToHex("supported");
    const unsupported = web3.utils.utf8ToHex("unsupported");

    // No identifiers are originally suppported.
    assert.isFalse(await voting.isIdentifierSupported(supported));
    assert.isFalse(await voting.isIdentifierSupported(unsupported));

    // Verify that supported identifiers can be added.
    await voting.addSupportedIdentifier(supported);
    assert.isTrue(await voting.isIdentifierSupported(supported));
    assert.isFalse(await voting.isIdentifierSupported(unsupported));

    // Can't request prices for unsupported identifiers.
    assert(await didContractThrow(voting.requestPrice(unsupported, "0", { from: registeredDerivative })));
  });

  it("Simple vote resolution", async function() {
    const identifier = web3.utils.utf8ToHex("simple-vote");
    const time = "1000";

    // Make the Oracle support this identifier.
    await voting.addSupportedIdentifier(identifier);

    // Request a price and move to the next round where that will be voted on.
    await voting.requestPrice(identifier, time, { from: registeredDerivative });

    const price = 123;
    const salt = getRandomUnsignedInt();
    const hash = web3.utils.soliditySha3(price, salt);

    // Can't commit without advancing the round forward.
    assert(await didContractThrow(voting.commitVote(identifier, time, hash)));

    await moveToNextRound(voting);

    // Commit vote.
    await voting.commitVote(identifier, time, hash);

    // Reveal the vote.
    await moveToNextPhase(voting);
    await voting.revealVote(identifier, time, price, salt);

    // Should resolve to the selected price since there was only one voter (100% for the mode) and the voter had enough
    // tokens to exceed the GAT.
    await moveToNextRound(voting);
    assert.equal(
      (await voting.getPrice(identifier, time, { from: registeredDerivative })).toString(),
      price.toString()
    );
  });

  it("Equally split vote", async function() {
    const identifier = web3.utils.utf8ToHex("equal-split");
    const time = "1000";

    // Make the Oracle support this identifier.
    await voting.addSupportedIdentifier(identifier);

    // Request a price and move to the next round where that will be voted on.
    await voting.requestPrice(identifier, time, { from: registeredDerivative });
    await moveToNextRound(voting);

    // Commit votes.
    const price1 = 123;
    const salt1 = getRandomUnsignedInt();
    const hash1 = web3.utils.soliditySha3(price1, salt1);
    await voting.commitVote(identifier, time, hash1, { from: account1 });

    const price2 = 456;
    const salt2 = getRandomUnsignedInt();
    const hash2 = web3.utils.soliditySha3(price2, salt2);
    await voting.commitVote(identifier, time, hash2, { from: account2 });

    // Reveal the votes.
    await moveToNextPhase(voting);
    await voting.revealVote(identifier, time, price1, salt1, { from: account1 });
    await voting.revealVote(identifier, time, price2, salt2, { from: account2 });

    // Should not have the price since the vote was equally split.
    await moveToNextRound(voting);
    assert.isFalse(await voting.hasPrice(identifier, time, { from: registeredDerivative }));

    // Cleanup: resolve the vote this round.
    await voting.commitVote(identifier, time, hash1, { from: account1 });
    await moveToNextPhase(voting);
    await voting.revealVote(identifier, time, price1, salt1, { from: account1 });
  });

  it("Two thirds majority", async function() {
    const identifier = web3.utils.utf8ToHex("two-thirds");
    const time = "1000";

    // Make the Oracle support this identifier.
    await voting.addSupportedIdentifier(identifier);

    // Request a price and move to the next round where that will be voted on.
    await voting.requestPrice(identifier, time, { from: registeredDerivative });
    await moveToNextRound(voting);

    // Commit votes.
    const losingPrice = 123;
    const salt1 = getRandomUnsignedInt();
    const hash1 = web3.utils.soliditySha3(losingPrice, salt1);
    await voting.commitVote(identifier, time, hash1, { from: account1 });

    // Both account 2 and 3 vote for 456.
    const winningPrice = 456;

    const salt2 = getRandomUnsignedInt();
    const hash2 = web3.utils.soliditySha3(winningPrice, salt2);
    await voting.commitVote(identifier, time, hash2, { from: account2 });

    const salt3 = getRandomUnsignedInt();
    const hash3 = web3.utils.soliditySha3(winningPrice, salt3);
    await voting.commitVote(identifier, time, hash3, { from: account3 });

    // Reveal the votes.
    await moveToNextPhase(voting);
    await voting.revealVote(identifier, time, losingPrice, salt1, { from: account1 });
    await voting.revealVote(identifier, time, winningPrice, salt2, { from: account2 });
    await voting.revealVote(identifier, time, winningPrice, salt3, { from: account3 });

    // Price should resolve to the one that 2 and 3 voted for.
    await moveToNextRound(voting);
    assert.equal(
      (await voting.getPrice(identifier, time, { from: registeredDerivative })).toString(),
      winningPrice.toString()
    );
  });

  it("GAT", async function() {
    const identifier = web3.utils.utf8ToHex("gat");
    const time = "1000";

    // Make the Oracle support this identifier.
    await voting.addSupportedIdentifier(identifier);

    // Request a price and move to the next round where that will be voted on.
    await voting.requestPrice(identifier, time, { from: registeredDerivative });
    await moveToNextRound(voting);

    // Commit vote.
    const price = 123;
    const salt = getRandomUnsignedInt();
    const hash = web3.utils.soliditySha3(price, salt);
    await voting.commitVote(identifier, time, hash, { from: account4 });

    // Reveal the vote.
    await moveToNextPhase(voting);
    await voting.revealVote(identifier, time, price, salt, { from: account4 });
    const initialRoundId = await voting.getCurrentRoundId();

    // Since the GAT was not hit, the price should not resolve.
    await moveToNextRound(voting);
    const newRoundId = await voting.getCurrentRoundId();
    assert.isFalse(await voting.hasPrice(identifier, time, { from: registeredDerivative }));

    // Can't claim rewards if the price wasn't resolved.
    const req = [{ identifier: identifier, time: time }];
    assert(await didContractThrow(voting.retrieveRewards(account4, initialRoundId, req)));

    // With a larger vote, the GAT should be hit and the price should resolve.
    // Commit votes.
    await voting.commitVote(identifier, time, hash, { from: account4 });
    await voting.commitVote(identifier, time, hash, { from: account1 });

    // Reveal votes.
    await moveToNextPhase(voting);
    await voting.revealVote(identifier, time, price, salt, { from: account4 });
    await voting.revealVote(identifier, time, price, salt, { from: account1 });

    await moveToNextRound(voting);
    assert.equal(
      (await voting.getPrice(identifier, time, { from: registeredDerivative })).toString(),
      price.toString()
    );

    // Must specify the right roundId when retrieving rewards.
    assert(await didContractThrow(voting.retrieveRewards(account4, initialRoundId, req)));
    await voting.retrieveRewards(account4, newRoundId, req);
  });

  it("Basic Snapshotting", async function() {
    const identifier = web3.utils.utf8ToHex("basic-snapshotting");
    const time = "1000";

    // Make the Oracle support this identifier.
    await voting.addSupportedIdentifier(identifier);

    // Request a price and move to the next round where that will be voted on.
    await voting.requestPrice(identifier, time, { from: registeredDerivative });
    await moveToNextRound(voting);

    // Commit votes.

    // account3 starts with only 1/3 of the tokens, but votes for 123.
    const winningPrice = 123;
    const salt3 = getRandomUnsignedInt();
    const hash3 = web3.utils.soliditySha3(winningPrice, salt3);
    await voting.commitVote(identifier, time, hash3, { from: account3 });

    // Both account 2 and 3, who start with 2/3 of the tokens, vote for 456.
    const losingPrice = 456;

    const salt1 = getRandomUnsignedInt();
    const hash1 = web3.utils.soliditySha3(losingPrice, salt1);
    await voting.commitVote(identifier, time, hash1, { from: account1 });

    const salt2 = getRandomUnsignedInt();
    const hash2 = web3.utils.soliditySha3(losingPrice, salt2);
    await voting.commitVote(identifier, time, hash2, { from: account2 });

    // All 3 accounts should have equal balances to start, so for winningPrice to win, account1 or account2 must
    // transfer more than half of their balance to account3 before the snapshot.
    await votingToken.transfer(account3, web3.utils.toWei("0.6", "ether"), { from: account1 });

    // Move to the reveal phase, where the snapshot should be taken.
    await moveToNextPhase(voting);

    // account2's reveal should create a snapshot since it's the first action of the reveal.
    await voting.revealVote(identifier, time, losingPrice, salt2, { from: account2 });

    // Transfer the tokens back. This should have no effect on the outcome since the snapshot has already been taken.
    await votingToken.transfer(account1, web3.utils.toWei("0.6", "ether"), { from: account3 });

    // Do the final two reveals.
    await voting.revealVote(identifier, time, losingPrice, salt1, { from: account1 });
    await voting.revealVote(identifier, time, winningPrice, salt3, { from: account3 });

    // The resulting price should be the winningPrice that account3 voted for.
    await moveToNextRound(voting);
    assert.equal(
      (await voting.getPrice(identifier, time, { from: registeredDerivative })).toString(),
      winningPrice.toString()
    );
  });

  it("Only registered derivatives", async function() {
    const identifier = web3.utils.utf8ToHex("only-registered");
    const time = "1000";

    // Make the Oracle support this identifier.
    await voting.addSupportedIdentifier(identifier);

    // Unregistered derivatives can't request prices.
    assert(await didContractThrow(voting.requestPrice(identifier, time, { from: unregisteredDerivative })));

    // Request the price and resolve the price.
    voting.requestPrice(identifier, time, { from: registeredDerivative });
    await moveToNextRound(voting);
    const winningPrice = 123;
    const salt = getRandomUnsignedInt();
    const hash = web3.utils.soliditySha3(winningPrice, salt);
    await voting.commitVote(identifier, time, hash, { from: account1 });
    await moveToNextPhase(voting);
    await voting.revealVote(identifier, time, winningPrice, salt, { from: account1 });
    await moveToNextRound(voting);

    // Sanity check that registered derivatives can retrieve prices.
    assert.isTrue(await voting.hasPrice(identifier, time, { from: registeredDerivative }));
    assert.equal(await voting.getPrice(identifier, time, { from: registeredDerivative }), winningPrice);

    // Unregistered derivatives can't retrieve prices.
    assert(await didContractThrow(voting.hasPrice(identifier, time, { from: unregisteredDerivative })));
    assert(await didContractThrow(voting.getPrice(identifier, time, { from: unregisteredDerivative })));
  });

  it("View methods", async function() {
    const identifier = web3.utils.utf8ToHex("view-methods");
    const time = "1000";

    // Make the Oracle support this identifier.
    await voting.addSupportedIdentifier(identifier);

    // Verify view methods `hasPrice` and `getPrice` for a price was that was never requested.
    assert.isFalse(await voting.hasPrice(identifier, time, { from: registeredDerivative }));
    assert(await didContractThrow(voting.getPrice(identifier, time, { from: registeredDerivative })));

    // Request a price and move to the next round where that will be voted on.
    await voting.requestPrice(identifier, time, { from: registeredDerivative });

    // Verify view methods `hasPrice` and `getPrice` for a price scheduled for the next round.
    assert.isFalse(await voting.hasPrice(identifier, time, { from: registeredDerivative }));
    assert(await didContractThrow(voting.getPrice(identifier, time, { from: registeredDerivative })));

    await moveToNextRound(voting);

    const price = 123;

    // Accounts 1 and 2 commit votes.
    const salt1 = getRandomUnsignedInt();
    const hash1 = web3.utils.soliditySha3(price, salt1);
    await voting.commitVote(identifier, time, hash1, { from: account1 });

    const salt2 = getRandomUnsignedInt();
    const hash2 = web3.utils.soliditySha3(price, salt1);
    await voting.commitVote(identifier, time, hash2, { from: account2 });

    await moveToNextPhase(voting);

    // Account 1 reveals.
    await voting.revealVote(identifier, time, price, salt1, { from: account1 });

    // Check if hasRevealedVote gives correct results for each voter.
    assert.isTrue(await voting.hasRevealedVote(identifier, time, { from: account1 }));
    assert.isFalse(await voting.hasRevealedVote(identifier, time, { from: account2 }));
    assert.isFalse(await voting.hasRevealedVote(identifier, time, { from: account3 }));

    // Once in the next round, no voter is considered to have revealed.
    await moveToNextRound(voting);
    assert.isFalse(await voting.hasRevealedVote(identifier, time, { from: account1 }));
    assert.isFalse(await voting.hasRevealedVote(identifier, time, { from: account2 }));
    assert.isFalse(await voting.hasRevealedVote(identifier, time, { from: account3 }));
  });

  it("Basic Inflation", async function() {
    // Set the inflation rate to 100% (for ease of computation).
    await setNewInflationRate(web3.utils.toWei("1", "ether"));

    const identifier = web3.utils.utf8ToHex("basic-inflation");
    const time1 = "1000";

    // Cache balances for later comparison.
    const initialAccount1Balance = await votingToken.balanceOf(account1);
    const initialAccount2Balance = await votingToken.balanceOf(account2);
    const initialAccount3Balance = await votingToken.balanceOf(account3);
    const initialAccount4Balance = await votingToken.balanceOf(account4);
    const initialTotalSupply = await votingToken.totalSupply();

    // Make the Oracle support this identifier.
    await voting.addSupportedIdentifier(identifier);

    // Request a price and move to the next round where that will be voted on.
    await voting.requestPrice(identifier, time1, { from: registeredDerivative });
    await moveToNextRound(voting);

    // Commit votes.
    const losingPrice = 123;
    const salt1 = getRandomUnsignedInt();
    const hash1 = web3.utils.soliditySha3(losingPrice, salt1);
    await voting.commitVote(identifier, time1, hash1, { from: account1 });

    // Both account 2 and 3 vote for 456.
    const winningPrice = 456;

    const salt2 = getRandomUnsignedInt();
    const hash2 = web3.utils.soliditySha3(winningPrice, salt2);
    await voting.commitVote(identifier, time1, hash2, { from: account2 });

    const salt3 = getRandomUnsignedInt();
    const hash3 = web3.utils.soliditySha3(winningPrice, salt3);
    await voting.commitVote(identifier, time1, hash3, { from: account3 });

    // Reveal the votes.
    await moveToNextPhase(voting);
    await voting.revealVote(identifier, time1, losingPrice, salt1, { from: account1 });
    await voting.revealVote(identifier, time1, winningPrice, salt2, { from: account2 });
    await voting.revealVote(identifier, time1, winningPrice, salt3, { from: account3 });

    const roundId = await voting.getCurrentRoundId();

    const req = [{ identifier: identifier, time: time1 }];
    // Can't claim rewards for current round (even if the request will definitely be resolved).
    assert(await didContractThrow(voting.retrieveRewards(account1, roundId, req)));

    // Move to the next round to begin retrieving rewards.
    await moveToNextRound(voting);

    const account1Rewards = await voting.retrieveRewards.call(account1, roundId, req);
    await voting.retrieveRewards(account1, roundId, req);
    const account2Rewards = await voting.retrieveRewards.call(account2, roundId, req);
    await voting.retrieveRewards(account2, roundId, req);

    // Voters can wait until the next round to claim rewards.
    await moveToNextRound(voting);
    const account3Rewards = await voting.retrieveRewards.call(account3, roundId, req);
    await voting.retrieveRewards(account3, roundId, req);
    const account4Rewards = await voting.retrieveRewards.call(account4, roundId, req);
    await voting.retrieveRewards(account4, roundId, req);

    // account1 is not rewarded because account1 was wrong.
    assert.equal(account1Rewards.toString(), "0");
    assert.equal((await votingToken.balanceOf(account1)).toString(), initialAccount1Balance.toString());

    // Accounts 2 and 3 split the 100% token inflation since each contributed the same number of tokens to the correct
    // answer.
    assert.equal(account2Rewards.toString(), initialTotalSupply.divn(2).toString());
    assert.equal(
      (await votingToken.balanceOf(account2)).toString(),
      initialAccount2Balance.add(initialTotalSupply.divn(2)).toString()
    );
    assert.equal(account3Rewards.toString(), initialTotalSupply.divn(2).toString());
    assert.equal(
      (await votingToken.balanceOf(account3)).toString(),
      initialAccount3Balance.add(initialTotalSupply.divn(2)).toString()
    );

    // account4 is not rewarded because it did not participate.
    assert.equal(account4Rewards.toString(), "0");
    assert.equal((await votingToken.balanceOf(account4)).toString(), initialAccount4Balance.toString());

    // Reset the inflation rate to 0%.
    await setNewInflationRate("0");
  });

  it("Events", async function() {
    // Set the inflation rate to 100% (for ease of computation).
    await setNewInflationRate(web3.utils.toWei("1", "ether"));

    const identifier = web3.utils.utf8ToHex("events");
    const time = "1000";

    // An event should be emitted when a new supported identifier is added (but not on repeated no-op calls).
    let result = await voting.addSupportedIdentifier(identifier);
    truffleAssert.eventEmitted(result, "SupportedIdentifierAdded", ev => {
      return web3.utils.hexToUtf8(ev.identifier) == web3.utils.hexToUtf8(identifier);
    });
    result = await voting.addSupportedIdentifier(identifier);
    truffleAssert.eventNotEmitted(result, "SupportedIdentifierAdded");

    await moveToNextRound(voting);
    let currentRoundId = await voting.getCurrentRoundId();

    // New price requests trigger events.
    result = await voting.requestPrice(identifier, time, { from: registeredDerivative });
    truffleAssert.eventEmitted(result, "PriceRequestAdded", ev => {
      return (
        // The vote is added to the next round, so we have to add 1 to the current round id.
        ev.votingRoundId.toString() == currentRoundId.addn(1).toString() &&
        web3.utils.hexToUtf8(ev.identifier) == web3.utils.hexToUtf8(identifier) &&
        ev.time.toString() == time.toString()
      );
    });

    await moveToNextRound(voting);
    currentRoundId = await voting.getCurrentRoundId();

    // Repeated price requests don't trigger events.
    result = await voting.requestPrice(identifier, time, { from: registeredDerivative });
    truffleAssert.eventNotEmitted(result, "PriceRequestAdded");

    // Commit vote.
    const price = 123;
    const salt = getRandomUnsignedInt();
    const hash = web3.utils.soliditySha3(price, salt);
    result = await voting.commitVote(identifier, time, hash, { from: account4 });
    truffleAssert.eventEmitted(result, "VoteCommitted", ev => {
      return (
        ev.voter.toString() == account4 &&
        ev.roundId.toString() == currentRoundId.toString() &&
        web3.utils.hexToUtf8(ev.identifier) == web3.utils.hexToUtf8(identifier) &&
        ev.time.toString() == time
      );
    });

    await moveToNextPhase(voting);

    const account4Balance = await votingToken.balanceOf(account4);
    result = await voting.revealVote(identifier, time, price, salt, { from: account4 });
    truffleAssert.eventEmitted(result, "VoteRevealed", ev => {
      return (
        ev.voter.toString() == account4 &&
        ev.roundId.toString() == currentRoundId.toString() &&
        web3.utils.hexToUtf8(ev.identifier) == web3.utils.hexToUtf8(identifier) &&
        ev.time.toString() == time &&
        ev.price.toString() == price.toString() &&
        ev.numTokens.toString() == account4Balance.toString()
      );
    });

    await moveToNextRound(voting);
    currentRoundId = await voting.getCurrentRoundId();
    // Since none of the whales voted, the price couldn't be resolved.

    // Now the whale votes and the vote resolves.
    await voting.commitVote(identifier, time, hash, { from: account1 });
    await moveToNextPhase(voting);
    await voting.revealVote(identifier, time, price, salt, { from: account1 });
    const initialTotalSupply = await votingToken.totalSupply();
    const roundId = await voting.getCurrentRoundId();
    await moveToNextRound(voting);

    // When the round updates, the price request should be resolved.
    result = await voting.retrieveRewards(account1, roundId, [{ identifier, time }]);
    truffleAssert.eventEmitted(result, "PriceResolved", ev => {
      return (
        ev.resolutionRoundId.toString() == currentRoundId.toString() &&
        web3.utils.hexToUtf8(ev.identifier) == web3.utils.hexToUtf8(identifier) &&
        ev.time == time &&
        ev.price.toString() == price.toString()
      );
    });
    truffleAssert.eventEmitted(result, "RewardsRetrieved", ev => {
      return (
        ev.voter.toString() == account1.toString() &&
        ev.rewardsRoundId.toString() == currentRoundId.toString() &&
        // Inflation is 100% and there was only one voter.
        ev.numTokens.toString() == initialTotalSupply.toString()
      );
    });

    // Events only get emitted if there were actually rewards issued. Is this the behavior we want?
    result = await voting.retrieveRewards(account4, roundId, [{ identifier, time }]);
    truffleAssert.eventNotEmitted(result, "RewardsRetrieved");
  });

  it("Commit and persist the encrypted price", async function() {
    const identifier = web3.utils.utf8ToHex("commit-and-persist");
    const time = "1000";
    await voting.addSupportedIdentifier(identifier);

    await voting.requestPrice(identifier, time, { from: registeredDerivative });
    await moveToNextRound(voting);

    const price = getRandomSignedInt();
    const salt = getRandomUnsignedInt();
    const hash = web3.utils.soliditySha3(price, salt);
    const roundId = await voting.getCurrentRoundId();

    const { privateKey, publicKey } = await deriveKeyPairFromSignatureTruffle(
      web3,
      getKeyGenMessage(roundId),
      account1
    );
    const vote = { price: price.toString(), salt: salt.toString() };
    const encryptedMessage = await encryptMessage(publicKey, JSON.stringify(vote));

    await voting.commitAndPersistEncryptedVote(identifier, time, hash, encryptedMessage);

    const topicHash = computeTopicHash({ identifier, time }, roundId);
    const retrievedEncryptedMessage = await voting.getMessage(account1, topicHash);

    // Check that the stored message is correct.
    assert.equal(encryptedMessage, retrievedEncryptedMessage);

    await moveToNextPhase(voting);

    const decryptedMessage = await decryptMessage(privateKey, retrievedEncryptedMessage);
    const retrievedVote = JSON.parse(decryptedMessage);

    assert(await didContractThrow(voting.revealVote(identifier, time, getRandomSignedInt(), getRandomUnsignedInt())));

    // Check that the message was not deleted.
    assert.isNotNull(await voting.getMessage(account1, topicHash));

    await voting.revealVote(identifier, time, retrievedVote.price, retrievedVote.salt);

    // Check that the message was deleted.
    assert.isNull(await voting.getMessage(account1, topicHash));
  });

  it("Commit and persist the encrypted price against the same identifier/time pair multiple times", async function() {
    const identifier = web3.utils.utf8ToHex("commit-and-persist2");
    const time = "1000";
    await voting.addSupportedIdentifier(identifier);

    await voting.requestPrice(identifier, time, { from: registeredDerivative });
    await moveToNextRound(voting);

    const price = getRandomSignedInt();
    const salt = getRandomUnsignedInt();
    const hash = web3.utils.soliditySha3(price, salt);
    const roundId = await voting.getCurrentRoundId();

    const { privateKey, publicKey } = await deriveKeyPairFromSignatureTruffle(
      web3,
      getKeyGenMessage(roundId),
      account1
    );
    const vote = { price: price.toString(), salt: salt.toString() };
    const encryptedMessage = await encryptMessage(publicKey, JSON.stringify(vote));

    await voting.commitAndPersistEncryptedVote(identifier, time, hash, encryptedMessage);

    const topicHash = computeTopicHash({ identifier, time }, roundId);
    const retrievedEncryptedMessage = await voting.getMessage(account1, topicHash);

    const secondEncryptedMessage = await encryptMessage(publicKey, getRandomUnsignedInt());

    await voting.commitAndPersistEncryptedVote(identifier, time, hash, secondEncryptedMessage);
    const secondRetrievedEncryptedMessage = await voting.getMessage(account1, topicHash);

    assert.equal(secondEncryptedMessage, secondRetrievedEncryptedMessage);
  });

  it("Batches multiple commits into one", async function() {
    const numRequests = 5;
    const requestTime = "1000";
    const priceRequests = [];

    for (let i = 0; i < numRequests; i++) {
      let identifier = web3.utils.utf8ToHex(`batch-request-${i}`);
      priceRequests.push({
        identifier,
        time: requestTime,
        hash: web3.utils.soliditySha3(getRandomUnsignedInt()),
        encryptedVote: web3.utils.utf8ToHex(`some encrypted message ${i}`)
      });

      await voting.addSupportedIdentifier(identifier);
      await voting.requestPrice(identifier, requestTime, { from: registeredDerivative });
    }

    await moveToNextRound(voting);

    const roundId = await voting.getCurrentRoundId();

    // Commit without storing any encrypted messages
    await voting.batchCommit(
      priceRequests.map(request => ({
        identifier: request.identifier,
        time: request.time,
        hash: request.hash,
        encryptedVote: []
      }))
    );

    // Verify that no messages were stored
    for (let i = 0; i < numRequests; i++) {
      let request = priceRequests[i];
      let topicHash = computeTopicHash({ identifier: request.identifier, time: request.time }, roundId);

      assert.isNull(await voting.getMessage(account1, topicHash));
    }

    // This time we commit while storing the encrypted messages
    await voting.batchCommit(priceRequests);

    // Test that the encrypted messages were stored properly
    for (let i = 0; i < numRequests; i++) {
      let priceRequest = priceRequests[i];
      let topicHash = computeTopicHash({ identifier: priceRequest.identifier, time: priceRequest.time }, roundId);
      let retrievedEncryptedMessage = await voting.getMessage(account1, topicHash);

      assert.equal(retrievedEncryptedMessage, priceRequest.encryptedVote);
    }

    // Edit a single commit
    const modifiedPriceRequest = priceRequests[0];
    modifiedPriceRequest.hash = web3.utils.soliditySha3(getRandomUnsignedInt());
    modifiedPriceRequest.encryptedVote = web3.utils.utf8ToHex(`some other encrypted message`);
    await voting.commitAndPersistEncryptedVote(
      modifiedPriceRequest.identifier,
      modifiedPriceRequest.time,
      modifiedPriceRequest.hash,
      modifiedPriceRequest.encryptedVote
    );

    // Test that the encrypted messages are still correct
    for (let i = 0; i < numRequests; i++) {
      let priceRequest = priceRequests[i];
      let topicHash = computeTopicHash({ identifier: priceRequest.identifier, time: priceRequest.time }, roundId);
      let retrievedEncryptedMessage = await voting.getMessage(account1, topicHash);

      assert.equal(retrievedEncryptedMessage, priceRequest.encryptedVote);
    }
  });

  it("Batch reveal multiple commits", async function() {
    const identifier = web3.utils.utf8ToHex("batch-reveal");
    const time1 = "1000";
    const time2 = "1001";
    await voting.addSupportedIdentifier(identifier);

    await voting.requestPrice(identifier, time1, { from: registeredDerivative });
    await voting.requestPrice(identifier, time2, { from: registeredDerivative });
    await moveToNextRound(voting);

    const price1 = getRandomSignedInt();
    const price2 = getRandomSignedInt();
    const salt1 = getRandomUnsignedInt();
    const salt2 = getRandomUnsignedInt();
    const hash1 = web3.utils.soliditySha3(price1, salt1);
    const hash2 = web3.utils.soliditySha3(price2, salt2);
    const roundId = await voting.getCurrentRoundId();

    const { privateKey, publicKey } = await deriveKeyPairFromSignatureTruffle(
      web3,
      getKeyGenMessage(roundId),
      account1
    );
    const vote = { price: price1.toString(), salt: salt2.toString() };
    const encryptedMessage = await encryptMessage(publicKey, JSON.stringify(vote));

    await voting.commitAndPersistEncryptedVote(identifier, time1, hash1, encryptedMessage);
    await voting.commitVote(identifier, time2, hash2);

    const topicHash1 = computeTopicHash({ identifier, time: time1 }, roundId);
    const topicHash2 = computeTopicHash({ identifier, time: time2 }, roundId);

    // Check the encrypted message storage slot.
    assert.isNotNull(await voting.getMessage(account1, topicHash1));
    assert.isNull(await voting.getMessage(account1, topicHash2));

    await moveToNextPhase(voting);

    // NOTE: Signed integers inside structs must be supplied as a string rather than a BN.
    const result = await voting.batchReveal([
      {
        identifier,
        time: time1,
        price: price1.toString(),
        salt: salt1.toString()
      },
      {
        identifier,
        time: time2,
        price: price2.toString(),
        salt: salt2.toString()
      }
    ]);

    truffleAssert.eventEmitted(result, "VoteRevealed", ev => {
      return (
        ev.voter.toString() == account1 &&
        ev.roundId.toString() == roundId.toString() &&
        web3.utils.hexToUtf8(ev.identifier) == web3.utils.hexToUtf8(identifier) &&
        ev.time.toString() == time1 &&
        ev.price.toString() == price1.toString()
      );
    });
    truffleAssert.eventEmitted(result, "VoteRevealed", ev => {
      return (
        ev.voter.toString() == account1 &&
        ev.roundId.toString() == roundId.toString() &&
        web3.utils.hexToUtf8(ev.identifier) == web3.utils.hexToUtf8(identifier) &&
        ev.time.toString() == time2 &&
        ev.price.toString() == price2.toString()
      );
    });

    // Check that the encrypted message has been removed from storage
    assert.isNull(await voting.getMessage(account1, topicHash1));
    assert.isNull(await voting.getMessage(account1, topicHash2));
  });

  it("Migration", async function() {
    const identifier = web3.utils.utf8ToHex("migration");
    const time1 = "1000";
    // Deploy our own voting because this test case will migrate it.
    const voting = await Voting.new(
      "86400",
      { rawValue: "0" },
      { rawValue: "0" },
      votingToken.address,
      (await Finder.deployed()).address,
      true
    );
    await voting.addSupportedIdentifier(identifier);

    await voting.requestPrice(identifier, time1, { from: registeredDerivative });
    await moveToNextRound(voting);
    const price = 123;
    const salt = getRandomSignedInt();
    const hash = web3.utils.soliditySha3(price, salt);
    await voting.commitVote(identifier, time1, hash, { from: account1 });
    await moveToNextPhase(voting);
    await voting.revealVote(identifier, time1, price, salt, { from: account1 });
    await moveToNextRound(voting);

    // New voting can only call methods after the migration, not before.
    assert(await voting.hasPrice(identifier, time1, { from: registeredDerivative }));
    assert(await didContractThrow(voting.hasPrice(identifier, time1, { from: migratedVoting })));

    // Need permissions to migrate.
    assert(await didContractThrow(voting.setMigrated(migratedVoting, { from: migratedVoting })));
    await voting.setMigrated(migratedVoting);

    // Now only new voting can call methods.
    assert(await voting.hasPrice(identifier, time1, { from: migratedVoting }));
    assert(await didContractThrow(voting.hasPrice(identifier, time1, { from: registeredDerivative })));
  });
});

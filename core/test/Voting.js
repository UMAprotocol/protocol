const { didContractThrow } = require("../../common/SolidityTestUtils.js");

const Voting = artifacts.require("Voting");

contract("Voting", function(accounts) {
  let voting;

  const account1 = accounts[0];
  const account2 = accounts[1];
  const account3 = accounts[2];
  const account4 = accounts[3];

  const secondsPerDay = web3.utils.toBN(86400);

  const COMMIT_PHASE = "0";
  const REVEAL_PHASE = "1";

  const getRandomSignedInt = () => {
    // Generate a random unsigned 256 bit int.
    const unsignedValue = web3.utils.toBN(web3.utils.randomHex(32));

    // The signed range is just the unsigned range decreased by 2^255.
    const signedOffset = web3.utils.toBN(2).pow(web3.utils.toBN(255));
    return unsignedValue.sub(signedOffset);
  };

  const getRandomUnsignedInt = () => {
    return web3.utils.toBN(web3.utils.randomHex(32));
  };

  const moveToNextRound = async () => {
    const phase = await voting.getVotePhase();
    const currentTime = await voting.getCurrentTime();
    let timeIncrement;
    if (phase.toString() === COMMIT_PHASE) {
      // Commit phase, so it will take 2 days to move to the next round.
      timeIncrement = secondsPerDay.muln(2);
    } else {
      // Reveal phase, so it will take 1 day to move to the next round.
      timeIncrement = secondsPerDay;
    }

    await voting.setCurrentTime(currentTime.add(timeIncrement));
  };

  const moveToNextPhase = async () => {
    const currentTime = await voting.getCurrentTime();
    await voting.setCurrentTime(currentTime.add(secondsPerDay));
  };

  before(async function() {
    voting = await Voting.deployed();
  });

  it("Vote phasing", async function() {
    // Reset the rounds.
    await moveToNextRound();

    // Rounds should start with Commit.
    assert.equal((await voting.getVotePhase()).toString(), COMMIT_PHASE);

    // Shift of one phase should be Reveal.
    await moveToNextPhase();
    assert.equal((await voting.getVotePhase()).toString(), REVEAL_PHASE);

    // A second shift should go back to commit.
    await moveToNextPhase();
    assert.equal((await voting.getVotePhase()).toString(), COMMIT_PHASE);
  });

  it("One voter, one request", async function() {
    const identifier = web3.utils.utf8ToHex("one-voter");
    const time = "1000";

    // Make the Oracle support this identifier.
    await voting.addSupportedIdentifier(identifier);

    // Request a price and move to the next round where that will be voted on.
    await voting.requestPrice(identifier, time);
    assert.equal((await voting.getCurrentRoundId()).toString(), "2");
    assert.equal((await voting.getVotePhase()).toString(), COMMIT_PHASE);
    await moveToNextRound();

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
    await moveToNextPhase();

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

    await voting.requestPrice(identifier, time);
    await moveToNextRound();

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
    await moveToNextPhase();

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
    await voting.requestPrice(identifier1, time2);
    await voting.requestPrice(identifier2, time1);

    // Move to voting round.
    await moveToNextRound();

    const price1 = getRandomSignedInt();
    const salt1 = getRandomUnsignedInt();
    const hash1 = web3.utils.soliditySha3(price1, salt1);

    const price2 = getRandomSignedInt();
    const salt2 = getRandomUnsignedInt();
    const hash2 = web3.utils.soliditySha3(price2, salt2);

    await voting.commitVote(identifier1, time2, hash1);
    await voting.commitVote(identifier2, time1, hash2);

    // Move to the reveal phase.
    await moveToNextPhase();

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
    await voting.requestPrice(identifier1, time1);
    await voting.requestPrice(identifier2, time2);

    // Since the round for these requests has not started, the price retrieval should fail.
    assert.isFalse(await voting.hasPrice(identifier1, time1));
    assert.isFalse(await voting.hasPrice(identifier2, time2));
    assert(await didContractThrow(voting.getPrice(identifier1, time1)));
    assert(await didContractThrow(voting.getPrice(identifier2, time2)));

    // Move to the voting round.
    await moveToNextRound();

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
    assert.isFalse(await voting.hasPrice(identifier1, time1));
    assert.isFalse(await voting.hasPrice(identifier2, time2));
    assert(await didContractThrow(voting.getPrice(identifier1, time1)));
    assert(await didContractThrow(voting.getPrice(identifier2, time2)));

    // Move to the reveal phase of the voting period.
    await moveToNextPhase();

    // Reveal both votes.
    await voting.revealVote(identifier1, time1, price1, salt1);
    await voting.revealVote(identifier2, time2, price2, salt2);

    // Prices cannot be provided until both commit and reveal for the current round have finished.
    assert.isFalse(await voting.hasPrice(identifier1, time1));
    assert.isFalse(await voting.hasPrice(identifier2, time2));
    assert(await didContractThrow(voting.getPrice(identifier1, time1)));
    assert(await didContractThrow(voting.getPrice(identifier2, time2)));

    // Move past the voting round.
    await moveToNextRound();

    // Note: all voting results are currently hardcoded to 1.
    assert.isTrue(await voting.hasPrice(identifier1, time1));
    assert.isTrue(await voting.hasPrice(identifier2, time2));
    assert.equal((await voting.getPrice(identifier1, time1)).toString(), price1.toString());
    assert.equal((await voting.getPrice(identifier2, time2)).toString(), price2.toString());
  });

  it("Future price requests disallowed", async function() {
    await moveToNextRound();

    const startingTime = await voting.getCurrentTime();
    const identifier = web3.utils.utf8ToHex("future-request");

    // Make the Oracle support this identifier.
    await voting.addSupportedIdentifier(identifier);

    // Time 1 is in the future and should fail.
    const timeFail = startingTime.addn(1).toString();

    // Time 2 is in the past and should succeed.
    const timeSucceed = startingTime.subn(1).toString();

    assert(await didContractThrow(voting.requestPrice(identifier, timeFail)));
    await voting.requestPrice(identifier, timeSucceed);

    // Finalize this vote.
    await moveToNextRound();
    const price = getRandomSignedInt();
    const salt = getRandomUnsignedInt();
    const hash = web3.utils.soliditySha3(price, salt);
    await voting.commitVote(identifier, timeSucceed, hash);

    // Move to reveal phase and reveal vote.
    await moveToNextPhase();
    await voting.revealVote(identifier, timeSucceed, price, salt);
  });

  it("Request timing", async function() {
    await moveToNextRound();

    const startingTime = await voting.getCurrentTime();
    const identifier = web3.utils.utf8ToHex("request-timing");
    const time = "1000";

    // Make the Oracle support this identifier.
    await voting.addSupportedIdentifier(identifier);

    // Two stage call is required to get the expected return value from the second call.
    // The expected resolution time should be the end of the *next* round.
    const preRoundExpectedResolution = (await voting.requestPrice.call(identifier, time)).toNumber();
    await voting.requestPrice(identifier, time);
    const requestRoundTime = (await voting.getCurrentTime()).toNumber();

    // The expected resolution time should be after all times in the request round.
    assert.isAbove(preRoundExpectedResolution, requestRoundTime);

    // A redundant request in the same round should produce the exact same expected resolution time.
    assert.equal((await voting.requestPrice.call(identifier, time)).toNumber(), preRoundExpectedResolution);
    await voting.requestPrice(identifier, time);

    // Move to the voting round.
    await moveToNextRound();
    const votingRoundTime = (await voting.getCurrentTime()).toNumber();

    // Expected resolution time should be after the
    assert.isAbove(preRoundExpectedResolution, votingRoundTime);

    // A redundant request during the voting round should return the same estimated time.
    assert.equal((await voting.requestPrice.call(identifier, time)).toNumber(), preRoundExpectedResolution);
    await voting.requestPrice(identifier, time);

    // Commit vote.
    const price = getRandomSignedInt();
    const salt = getRandomUnsignedInt();
    const hash = web3.utils.soliditySha3(price, salt);
    await voting.commitVote(identifier, time, hash);

    // Move to reveal phase and reveal vote.
    await moveToNextPhase();
    await voting.revealVote(identifier, time, price, salt);

    await moveToNextRound();
    const postVoteTime = (await voting.getCurrentTime()).toNumber();
    assert.isAtMost(preRoundExpectedResolution, postVoteTime);

    // Now that the request has been resolved, requestPrice should always return 0.
    assert.equal((await voting.requestPrice.call(identifier, time)).toNumber(), 0);
    await voting.requestPrice(identifier, time);
  });

  it("Retrieval timing", async function() {
    await moveToNextRound();

    const identifier = web3.utils.utf8ToHex("retrieval-timing");
    const time = "1000";

    // Make the Oracle support this identifier.
    await voting.addSupportedIdentifier(identifier);

    // Two stage call is required to get the expected return value from the second call.
    // The expected resolution time should be the end of the *next* round.
    await voting.requestPrice(identifier, time);

    // Cannot get the price before the voting round begins.
    assert(await didContractThrow(voting.getPrice(identifier, time)));

    await moveToNextRound();

    // Cannot get the price while the voting is ongoing.
    assert(await didContractThrow(voting.getPrice(identifier, time)));

    // Commit vote.
    const price = getRandomSignedInt();
    const salt = getRandomUnsignedInt();
    const hash = web3.utils.soliditySha3(price, salt);
    await voting.commitVote(identifier, time, hash);

    // Move to reveal phase and reveal vote.
    await moveToNextPhase();
    await voting.revealVote(identifier, time, price, salt);

    // Cannot get the price during the reveal phase.
    assert(await didContractThrow(voting.getPrice(identifier, time)));

    await moveToNextRound();

    // After the voting round is over, the price should be retrievable.
    assert.equal((await voting.getPrice(identifier, time)).toString(), price.toString());
  });

  it("Pending Requests", async function() {
    await moveToNextRound();

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
    await voting.requestPrice(identifier1, time1);

    // Pending requests should be empty before the voting round begins.
    assert.equal((await voting.getPendingRequests()).length, 0);

    // Pending requests should be have a single entry now that voting has started.
    await moveToNextRound();
    assert.equal((await voting.getPendingRequests()).length, 1);

    // Add a new request during the voting round.
    await voting.requestPrice(identifier2, time2);

    // Pending requests should still be 1 because this request should not be voted on until next round.
    assert.equal((await voting.getPendingRequests()).length, 1);

    // Move to next round and roll the first request over.
    await moveToNextRound();

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
    await moveToNextPhase();
    assert.equal((await voting.getPendingRequests()).length, 2);

    // Reveal vote.
    await voting.revealVote(identifier1, time1, price1, salt1);
    await voting.revealVote(identifier2, time2, price2, salt2);

    // Pending requests should be empty after the voting round ends and the price is resolved.
    await moveToNextRound();
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
    assert(await didContractThrow(voting.requestPrice(unsupported, "0")));
  });

  it("Simple vote resolution", async function() {
    const identifier = web3.utils.utf8ToHex("simple-vote");
    const time = "1000";

    // Make the Oracle support this identifier.
    await voting.addSupportedIdentifier(identifier);

    // Request a price and move to the next round where that will be voted on.
    await voting.requestPrice(identifier, time);
    await moveToNextRound();

    // Commit vote.
    const price = 123;
    const salt = getRandomUnsignedInt();
    const hash = web3.utils.soliditySha3(price, salt);
    await voting.commitVote(identifier, time, hash);

    // Reveal the vote.
    await moveToNextPhase();
    await voting.revealVote(identifier, time, price, salt);

    // Should resolve to the selected price since there was only one voter (100% for the mode) and the voter had enough
    // tokens to exceed the GAT.
    await moveToNextRound();
    assert.equal((await voting.getPrice(identifier, time)).toString(), price.toString());
  });

  it("Equally split vote", async function() {
    const identifier = web3.utils.utf8ToHex("equal-split");
    const time = "1000";

    // Make the Oracle support this identifier.
    await voting.addSupportedIdentifier(identifier);

    // Request a price and move to the next round where that will be voted on.
    await voting.requestPrice(identifier, time);
    await moveToNextRound();

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
    await moveToNextPhase();
    await voting.revealVote(identifier, time, price1, salt1, { from: account1 });
    await voting.revealVote(identifier, time, price2, salt2, { from: account2 });

    // Should not have the price since the vote was equally split.
    await moveToNextRound();
    assert.isFalse(await voting.hasPrice(identifier, time));

    // Cleanup: resolve the vote this round.
    await voting.commitVote(identifier, time, hash1, { from: account1 });
    await moveToNextPhase();
    await voting.revealVote(identifier, time, price1, salt1, { from: account1 });
  });

  it("Two thirds majority", async function() {
    const identifier = web3.utils.utf8ToHex("two-thirds");
    const time = "1000";

    // Make the Oracle support this identifier.
    await voting.addSupportedIdentifier(identifier);

    // Request a price and move to the next round where that will be voted on.
    await voting.requestPrice(identifier, time);
    await moveToNextRound();

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
    await moveToNextPhase();
    await voting.revealVote(identifier, time, losingPrice, salt1, { from: account1 });
    await voting.revealVote(identifier, time, winningPrice, salt2, { from: account2 });
    await voting.revealVote(identifier, time, winningPrice, salt3, { from: account3 });

    // Price should resolve to the one that 2 and 3 voted for.
    await moveToNextRound();
    assert.equal((await voting.getPrice(identifier, time)).toString(), winningPrice.toString());
  });
});

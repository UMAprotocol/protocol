const { didContractThrow } = require("../../common/SolidityTestUtils.js");

const Voting = artifacts.require("Voting");

contract("Voting", function(accounts) {
  let voting;

  const account1 = accounts[0];
  const account2 = accounts[1];
  const account3 = accounts[2];
  const account4 = accounts[3];

  const secondsPerDay = web3.utils.toBN(86400);

  const getRandomInt = () => {
    return web3.utils.toBN(web3.utils.randomHex(32));
  };

  const moveToNextRound = async () => {
    const phase = await voting.getVotePhase();
    const currentTime = await voting.getCurrentTime();
    let timeIncrement;
    if (phase.toString() === "0") {
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
    assert.equal((await voting.getVotePhase()).toString(), "0");

    // Shift of one phase should be Reveal.
    await moveToNextPhase();
    assert.equal((await voting.getVotePhase()).toString(), "1");

    // A seconds shift should go back to commit.
    await moveToNextPhase();
    assert.equal((await voting.getVotePhase()).toString(), "0");
  });

  it("One voter, one request", async function() {
    const identifier = web3.utils.utf8ToHex("one-voter");
    const time = "1000";

    // Request a price and move to the next round where that will be voted on.
    await voting.requestPrice(identifier, time);
    assert.equal((await voting.getCurrentRoundId()).toString(), "2");
    assert.equal((await voting.getVotePhase()).toString(), "0");
    await moveToNextRound();

    const price = getRandomInt();
    const salt = getRandomInt();
    const hash = web3.utils.soliditySha3(price, salt);

    // Can't commit hash of 0.
    assert(await didContractThrow(voting.commitVote(identifier, time, "0x0")));

    // Can commit a new hash.
    await voting.commitVote(identifier, time, hash);

    // Voters can alter their commits.
    const newPrice = getRandomInt();
    const newSalt = getRandomInt();
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

    await voting.requestPrice(identifier, time);
    await moveToNextRound();

    const price1 = getRandomInt();
    const salt1 = getRandomInt();
    const hash1 = web3.utils.soliditySha3(price1, salt1);

    const price2 = getRandomInt();
    const salt2 = getRandomInt();
    const hash2 = web3.utils.soliditySha3(price2, salt2);

    // Voter3 wants to vote the same price as voter1.
    const price3 = price1;
    const salt3 = getRandomInt();
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

    // Send the requests.
    await voting.requestPrice(identifier1, time2);
    await voting.requestPrice(identifier2, time1);

    // Move to voting round.
    await moveToNextRound();

    const price1 = getRandomInt();
    const salt1 = getRandomInt();
    const hash1 = web3.utils.soliditySha3(price1, salt1);

    const price2 = getRandomInt();
    const salt2 = getRandomInt();
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

    // Requests should not be added to the current voting round.
    await voting.setCurrentTime("1001");
    await voting.requestPrice(identifier1, time1);

    await voting.setCurrentTime("2001");
    await voting.requestPrice(identifier2, time2);

    // Since the round for these requests has not started, the price retrieval should fail.
    assert(await didContractThrow(voting.getPrice(identifier1, time1)));
    assert(await didContractThrow(voting.getPrice(identifier2, time2)));

    // Move to the voting round.
    await moveToNextRound();

    // At least one commit must be sent to push the round forward.
    const price = getRandomInt();
    const salt = getRandomInt();
    const hash = web3.utils.soliditySha3(price, salt);
    await voting.commitVote(identifier1, time1, hash);

    // If the voting period is ongoing, prices cannot be returned since they are not finalized.
    assert(await didContractThrow(voting.getPrice(identifier1, time1)));
    assert(await didContractThrow(voting.getPrice(identifier2, time2)));

    // Move to the reveal phase of the voting period.
    await moveToNextPhase();

    // Prices cannot be provided until both commit and reveal for the current round have finished.
    assert(await didContractThrow(voting.getPrice(identifier1, time1)));
    assert(await didContractThrow(voting.getPrice(identifier2, time2)));

    // Move past the voting round.
    await moveToNextRound();

    // Note: all voting results are currently hardcoded to 1.
    assert.equal((await voting.getPrice(identifier1, time1)).toString(), "1");
    assert.equal((await voting.getPrice(identifier2, time2)).toString(), "1");
  });

  it("Future price requests disallowed", async function() {
    await moveToNextRound();

    const startingTime = await voting.getCurrentTime();
    const identifier = web3.utils.utf8ToHex("future-request");

    // Time 1 is in the future and should fail.
    const timeFail = startingTime.addn(1).toString();

    // Time 2 is in the past and should succeed.
    const timeSucceed = startingTime.subn(1).toString();

    assert(await didContractThrow(voting.requestPrice(identifier, timeFail)));
    await voting.requestPrice(identifier, timeSucceed);
  });

  it("Request timing", async function() {
    await moveToNextRound();

    const startingTime = await voting.getCurrentTime();
    const identifier = web3.utils.utf8ToHex("request-timing");
    const time = "1000";

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

    // A single commit is required to cause the round to advance and resolve.
    const price = getRandomInt();
    const salt = getRandomInt();
    const hash = web3.utils.soliditySha3(price, salt);
    await voting.commitVote(identifier, time, hash);

    await moveToNextRound();
    const postVoteTime = (await voting.getCurrentTime()).toNumber();
    assert.isAtMost(preRoundExpectedResolution, postVoteTime);

    // Now that the request has been resolved, requestPrice should always return 0.
    assert.equal((await voting.requestPrice.call(identifier, time)).toNumber(), 0);
    await voting.requestPrice(identifier, time);
  });
});

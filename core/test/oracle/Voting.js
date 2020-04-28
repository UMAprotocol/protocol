const { didContractThrow } = require("../../../common/SolidityTestUtils.js");
const { RegistryRolesEnum, VotePhasesEnum } = require("../../../common/Enums.js");
const { getRandomSignedInt, getRandomUnsignedInt } = require("../../../common/Random.js");
const { decryptMessage, encryptMessage, deriveKeyPairFromSignatureTruffle } = require("../../../common/Crypto");
const { moveToNextRound, moveToNextPhase } = require("../../utils/Voting.js");
const { computeTopicHash, computeVoteHash, getKeyGenMessage } = require("../../../common/EncryptionHelper.js");
const truffleAssert = require("truffle-assertions");

const Finder = artifacts.require("Finder");
const Registry = artifacts.require("Registry");
const Voting = artifacts.require("Voting");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const VotingToken = artifacts.require("VotingToken");
const VotingTest = artifacts.require("VotingTest");
const Timer = artifacts.require("Timer");

contract("Voting", function(accounts) {
  let voting;
  let votingToken;
  let registry;

  const account1 = accounts[0];
  const account2 = accounts[1];
  const account3 = accounts[2];
  const account4 = accounts[3];
  const registeredContract = accounts[4];
  const unregisteredContract = accounts[5];
  const migratedVoting = accounts[6];

  const setNewInflationRate = async inflationRate => {
    await voting.setInflationRate({ rawValue: inflationRate.toString() });
  };

  const setNewGatPercentage = async gatPercentage => {
    await voting.setGatPercentage({ rawValue: gatPercentage.toString() });
  };

  before(async function() {
    voting = await Voting.deployed();
    supportedIdentifiers = await IdentifierWhitelist.deployed();
    votingToken = await VotingToken.deployed();
    registry = await Registry.deployed();

    // Allow account1 to mint tokens.
    const minterRole = 1;
    await votingToken.addMember(minterRole, account1);

    // account1 starts with 100MM tokens, so divide up the tokens accordingly:
    // 1: 32MM
    // 2: 32MM
    // 3: 32MM
    // 4: 4MM (can't reach the 5% GAT alone)
    await votingToken.transfer(account2, web3.utils.toWei("32000000", "ether"));
    await votingToken.transfer(account3, web3.utils.toWei("32000000", "ether"));
    await votingToken.transfer(account4, web3.utils.toWei("4000000", "ether"));

    // Set the inflation rate to 0 by default, so the balances stay fixed until inflation is tested.
    await setNewInflationRate("0");

    // Register contract with Registry.
    await registry.addMember(RegistryRolesEnum.CONTRACT_CREATOR, account1);
    await registry.registerContract([], registeredContract, { from: account1 });
  });

  it("Constructor", async function() {
    // GAT must be <= 1.0 (100%)
    const invalidGat = { rawValue: web3.utils.toWei("1.000001") };
    assert(
      await didContractThrow(
        Voting.new(
          5,
          invalidGat,
          { rawValue: web3.utils.toWei("1") },
          1,
          votingToken.address,
          Finder.address,
          Timer.address
        )
      )
    );
  });

  it("Vote phasing", async function() {
    // Reset the rounds.
    await moveToNextRound(voting);

    // RoundId is a function of the voting time defined by floor(timestamp/phaseLength).
    // RoundId for Commit and Reveal phases should be the same.
    const currentTime = (await voting.getCurrentTime()).toNumber();
    const commitRoundId = await voting.getCurrentRoundId();
    assert.equal(commitRoundId.toString(), Math.floor(currentTime / 172800));

    // Rounds should start with Commit.
    assert.equal((await voting.getVotePhase()).toString(), VotePhasesEnum.COMMIT);

    // Shift of one phase should be Reveal.
    await moveToNextPhase(voting);
    assert.equal((await voting.getVotePhase()).toString(), VotePhasesEnum.REVEAL);

    // Round ID between Commit and Reveal phases should be the same.
    assert.equal(commitRoundId.toString(), (await voting.getCurrentRoundId()).toString());

    // A second shift should go back to commit.
    await moveToNextPhase(voting);
    assert.equal((await voting.getVotePhase()).toString(), VotePhasesEnum.COMMIT);
  });

  it("One voter, one request", async function() {
    const identifier = web3.utils.utf8ToHex("one-voter");
    const time = "1000";
    // Make the Oracle support this identifier.
    await supportedIdentifiers.addSupportedIdentifier(identifier);

    // Request a price and move to the next round where that will be voted on.
    await voting.requestPrice(identifier, time, { from: registeredContract });
    await moveToNextRound(voting);
    // RoundId is a function of the voting time defined by floor(timestamp/phaseLength).
    // RoundId for Commit and Reveal phases should be the same.
    const currentRoundId = await voting.getCurrentRoundId();

    const price = getRandomSignedInt();
    const salt = getRandomUnsignedInt();
    const hash = computeVoteHash({
      price,
      salt,
      account: account1,
      time: time,
      roundId: currentRoundId,
      identifier
    });

    // Can't commit hash of 0.
    assert(await didContractThrow(voting.commitVote(identifier, time, "0x0")));

    // Can commit a new hash.
    await voting.commitVote(identifier, time, hash);

    // Voters can alter their commits.
    const newPrice = getRandomSignedInt();
    const newSalt = getRandomUnsignedInt();
    const newHash = computeVoteHash({
      price: newPrice,
      salt: newSalt,
      account: account1,
      time: time,
      roundId: currentRoundId,
      identifier
    });

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

    // Can't reveal with the incorrect address.
    assert(await didContractThrow(voting.revealVote(identifier, time, newPrice, newSalt, { from: account2 })));

    // Can't reveal with incorrect timestamp.
    assert(await didContractThrow(voting.revealVote(identifier, (Number(time) + 1).toString(), newPrice, salt)));

    // Can't reveal with incorrect identifier.
    assert(
      await didContractThrow(
        voting.revealVote(web3.utils.utf8ToHex("wrong-identifier"), time, newPrice, newSalt, { from: account2 })
      )
    );

    // Successfully reveal the latest commit.
    await voting.revealVote(identifier, time, newPrice, newSalt);

    // Can't reveal the same commit again.
    assert(await didContractThrow(voting.revealVote(identifier, time, newPrice, newSalt)));
  });

  it("Overlapping request keys", async function() {
    // Verify that concurrent votes with the same identifier but different times, or the same time but different
    // identifiers don't cause any problems.
    const identifier1 = web3.utils.utf8ToHex("overlapping-keys1");
    const time1 = "1000";
    const identifier2 = web3.utils.utf8ToHex("overlapping-keys2");
    const time2 = "2000";

    // Make the Oracle support these two identifiers.
    await supportedIdentifiers.addSupportedIdentifier(identifier1);
    await supportedIdentifiers.addSupportedIdentifier(identifier2);

    // Send the requests.
    await voting.requestPrice(identifier1, time2, { from: registeredContract });
    await voting.requestPrice(identifier2, time1, { from: registeredContract });

    // Move to voting round.
    await moveToNextRound(voting);
    const roundId = (await voting.getCurrentRoundId()).toString();

    const price1 = getRandomSignedInt();
    const salt1 = getRandomUnsignedInt();
    const hash1 = computeVoteHash({
      price: price1,
      salt: salt1,
      account: account1,
      time: time2,
      roundId,
      identifier: identifier1
    });

    const price2 = getRandomSignedInt();
    const salt2 = getRandomUnsignedInt();
    const hash2 = computeVoteHash({
      price: price2,
      salt: salt2,
      account: account1,
      time: time1,
      roundId,
      identifier: identifier2
    });

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
    await supportedIdentifiers.addSupportedIdentifier(identifier1);
    await supportedIdentifiers.addSupportedIdentifier(identifier2);

    // Requests should not be added to the current voting round.
    await voting.requestPrice(identifier1, time1, { from: registeredContract });
    await voting.requestPrice(identifier2, time2, { from: registeredContract });

    // Since the round for these requests has not started, the price retrieval should fail.
    assert.isFalse(await voting.hasPrice(identifier1, time1, { from: registeredContract }));
    assert.isFalse(await voting.hasPrice(identifier2, time2, { from: registeredContract }));
    assert(await didContractThrow(voting.getPrice(identifier1, time1, { from: registeredContract })));
    assert(await didContractThrow(voting.getPrice(identifier2, time2, { from: registeredContract })));

    // Move to the voting round.
    await moveToNextRound(voting);
    const roundId = (await voting.getCurrentRoundId()).toString();

    // Commit vote 1.
    const price1 = getRandomSignedInt();
    const salt1 = getRandomUnsignedInt();
    const hash1 = computeVoteHash({
      price: price1,
      salt: salt1,
      account: account1,
      time: time1,
      roundId,
      identifier: identifier1
    });

    await voting.commitVote(identifier1, time1, hash1);

    // Commit vote 2.
    const price2 = getRandomSignedInt();
    const salt2 = getRandomUnsignedInt();
    const hash2 = computeVoteHash({
      price: price2,
      salt: salt2,
      account: account1,
      time: time2,
      roundId,
      identifier: identifier2
    });
    await voting.commitVote(identifier2, time2, hash2);

    // If the voting period is ongoing, prices cannot be returned since they are not finalized.
    assert.isFalse(await voting.hasPrice(identifier1, time1, { from: registeredContract }));
    assert.isFalse(await voting.hasPrice(identifier2, time2, { from: registeredContract }));
    assert(await didContractThrow(voting.getPrice(identifier1, time1, { from: registeredContract })));
    assert(await didContractThrow(voting.getPrice(identifier2, time2, { from: registeredContract })));

    // Move to the reveal phase of the voting period.
    await moveToNextPhase(voting);

    // Reveal both votes.
    await voting.revealVote(identifier1, time1, price1, salt1);
    await voting.revealVote(identifier2, time2, price2, salt2);

    // Prices cannot be provided until both commit and reveal for the current round have finished.
    assert.isFalse(await voting.hasPrice(identifier1, time1, { from: registeredContract }));
    assert.isFalse(await voting.hasPrice(identifier2, time2, { from: registeredContract }));
    assert(await didContractThrow(voting.getPrice(identifier1, time1, { from: registeredContract })));
    assert(await didContractThrow(voting.getPrice(identifier2, time2, { from: registeredContract })));

    // Move past the voting round.
    await moveToNextRound(voting);

    // Note: all voting results are currently hardcoded to 1.
    assert.isTrue(await voting.hasPrice(identifier1, time1, { from: registeredContract }));
    assert.isTrue(await voting.hasPrice(identifier2, time2, { from: registeredContract }));
    assert.equal(
      (await voting.getPrice(identifier1, time1, { from: registeredContract })).toString(),
      price1.toString()
    );
    assert.equal(
      (await voting.getPrice(identifier2, time2, { from: registeredContract })).toString(),
      price2.toString()
    );
  });

  it("Future price requests disallowed", async function() {
    await moveToNextRound(voting);

    const startingTime = await voting.getCurrentTime();
    const identifier = web3.utils.utf8ToHex("future-request");

    // Make the Oracle support this identifier.
    await supportedIdentifiers.addSupportedIdentifier(identifier);

    // Time 1 is in the future and should fail.
    const timeFail = startingTime.addn(1).toString();

    // Time 2 is in the past and should succeed.
    const timeSucceed = startingTime.subn(1).toString();

    assert(await didContractThrow(voting.requestPrice(identifier, timeFail, { from: registeredContract })));
    await voting.requestPrice(identifier, timeSucceed, { from: registeredContract });

    // Finalize this vote.
    await moveToNextRound(voting);
    const roundId = (await voting.getCurrentRoundId()).toString();
    const price = getRandomSignedInt();
    const salt = getRandomUnsignedInt();
    const hash = computeVoteHash({
      price: price,
      salt: salt,
      account: account1,
      time: timeSucceed,
      roundId,
      identifier
    });
    await voting.commitVote(identifier, timeSucceed, hash);

    // Move to reveal phase and reveal vote.
    await moveToNextPhase(voting);
    await voting.revealVote(identifier, timeSucceed, price, salt);
  });

  it("Retrieval timing", async function() {
    await moveToNextRound(voting);

    const identifier = web3.utils.utf8ToHex("retrieval-timing");
    const time = "1000";

    // Make the Oracle support this identifier.
    await supportedIdentifiers.addSupportedIdentifier(identifier);

    // Two stage call is required to get the expected return value from the second call.
    // The expected resolution time should be the end of the *next* round.
    await voting.requestPrice(identifier, time, { from: registeredContract });

    // Cannot get the price before the voting round begins.
    assert(await didContractThrow(voting.getPrice(identifier, time, { from: registeredContract })));

    await moveToNextRound(voting);
    const roundId = (await voting.getCurrentRoundId()).toString();

    // Cannot get the price while the voting is ongoing.
    assert(await didContractThrow(voting.getPrice(identifier, time, { from: registeredContract })));

    // Commit vote.
    const price = getRandomSignedInt();
    const salt = getRandomUnsignedInt();
    const hash = computeVoteHash({
      price,
      salt,
      account: account1,
      time,
      roundId,
      identifier
    });
    await voting.commitVote(identifier, time, hash);

    // Move to reveal phase and reveal vote.
    await moveToNextPhase(voting);
    await voting.revealVote(identifier, time, price, salt);

    // Cannot get the price during the reveal phase.
    assert(await didContractThrow(voting.getPrice(identifier, time, { from: registeredContract })));

    await moveToNextRound(voting);

    // After the voting round is over, the price should be retrievable.
    assert.equal((await voting.getPrice(identifier, time, { from: registeredContract })).toString(), price.toString());
  });

  it("Pending Requests", async function() {
    await moveToNextRound(voting);

    const identifier1 = web3.utils.utf8ToHex("pending-requests1");
    const time1 = "1000";
    const identifier2 = web3.utils.utf8ToHex("pending-requests2");
    const time2 = "1001";

    // Make the Oracle support these identifiers.
    await supportedIdentifiers.addSupportedIdentifier(identifier1);
    await supportedIdentifiers.addSupportedIdentifier(identifier2);

    // Pending requests should be empty for this new round.
    assert.equal((await voting.getPendingRequests()).length, 0);

    // Two stage call is required to get the expected return value from the second call.
    // The expected resolution time should be the end of the *next* round.
    await voting.requestPrice(identifier1, time1, { from: registeredContract });

    // Pending requests should be empty before the voting round begins.
    assert.equal((await voting.getPendingRequests()).length, 0);

    // Pending requests should be have a single entry now that voting has started.
    await moveToNextRound(voting);
    assert.equal((await voting.getPendingRequests()).length, 1);

    // Add a new request during the voting round.
    await voting.requestPrice(identifier2, time2, { from: registeredContract });

    // Pending requests should still be 1 because this request should not be voted on until next round.
    assert.equal((await voting.getPendingRequests()).length, 1);

    // Move to next round and roll the first request over.
    await moveToNextRound(voting);
    const roundId = (await voting.getCurrentRoundId()).toString();

    // Pending requests should be 2 because one vote was rolled over and the second was dispatched after the previous
    // voting round started.
    assert.equal((await voting.getPendingRequests()).length, 2);

    // Commit votes.
    const price1 = getRandomSignedInt();
    const salt1 = getRandomUnsignedInt();
    const hash1 = computeVoteHash({
      price: price1,
      salt: salt1,
      account: account1,
      time: time1,
      roundId,
      identifier: identifier1
    });
    await voting.commitVote(identifier1, time1, hash1);

    const price2 = getRandomSignedInt();
    const salt2 = getRandomUnsignedInt();
    const hash2 = computeVoteHash({
      price: price2,
      salt: salt2,
      account: account1,
      time: time2,
      roundId,
      identifier: identifier2
    });
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
    const supported = web3.utils.utf8ToHex("supported");

    // No identifiers are originally suppported.
    assert.isFalse(await supportedIdentifiers.isIdentifierSupported(supported));

    // Verify that supported identifiers can be added.
    await supportedIdentifiers.addSupportedIdentifier(supported);
    assert.isTrue(await supportedIdentifiers.isIdentifierSupported(supported));

    // Verify that supported identifiers can be removed.
    await supportedIdentifiers.removeSupportedIdentifier(supported);
    assert.isFalse(await supportedIdentifiers.isIdentifierSupported(supported));

    // Can't request prices for unsupported identifiers.
    assert(await didContractThrow(voting.requestPrice(supported, "0", { from: registeredContract })));
  });

  it("Simple vote resolution", async function() {
    const identifier = web3.utils.utf8ToHex("simple-vote");
    const time = "1000";

    // Make the Oracle support this identifier.
    await supportedIdentifiers.addSupportedIdentifier(identifier);

    // Request a price and move to the next round where that will be voted on.
    await voting.requestPrice(identifier, time, { from: registeredContract });

    const price = 123;
    const salt = getRandomUnsignedInt();
    const invalidHash = computeVoteHash({
      price,
      salt,
      account: account1,
      time,
      roundId: (await voting.getCurrentRoundId()).toString(),
      identifier
    });
    // Can't commit without advancing the round forward.
    assert(await didContractThrow(voting.commitVote(identifier, time, invalidHash)));

    await moveToNextRound(voting);
    const roundId = (await voting.getCurrentRoundId()).toString();

    // Commit vote.
    const hash = computeVoteHash({
      price,
      salt,
      account: account1,
      time,
      roundId,
      identifier
    });
    await voting.commitVote(identifier, time, hash);

    // Reveal the vote.
    await moveToNextPhase(voting);
    await voting.revealVote(identifier, time, price, salt);

    // Should resolve to the selected price since there was only one voter (100% for the mode) and the voter had enough
    // tokens to exceed the GAT.
    await moveToNextRound(voting);
    assert.equal((await voting.getPrice(identifier, time, { from: registeredContract })).toString(), price.toString());
  });

  it("Equally split vote", async function() {
    const identifier = web3.utils.utf8ToHex("equal-split");
    const time = "1000";

    // Make the Oracle support this identifier.
    await supportedIdentifiers.addSupportedIdentifier(identifier);

    // Request a price and move to the next round where that will be voted on.
    await voting.requestPrice(identifier, time, { from: registeredContract });
    await moveToNextRound(voting);
    let roundId = (await voting.getCurrentRoundId()).toString();

    // Commit votes.
    const price1 = 123;
    const salt1 = getRandomUnsignedInt();
    let hash1 = computeVoteHash({
      price: price1,
      salt: salt1,
      account: account1,
      time,
      roundId,
      identifier
    });
    await voting.commitVote(identifier, time, hash1, { from: account1 });

    const price2 = 456;
    const salt2 = getRandomUnsignedInt();
    const hash2 = computeVoteHash({
      price: price2,
      salt: salt2,
      account: account2,
      time,
      roundId,
      identifier
    });
    await voting.commitVote(identifier, time, hash2, { from: account2 });

    // Reveal the votes.
    await moveToNextPhase(voting);
    await voting.revealVote(identifier, time, price1, salt1, { from: account1 });
    await voting.revealVote(identifier, time, price2, salt2, { from: account2 });

    // Should not have the price since the vote was equally split.
    await moveToNextRound(voting);
    roundId = (await voting.getCurrentRoundId()).toString();
    assert.isFalse(await voting.hasPrice(identifier, time, { from: registeredContract }));

    // Cleanup: resolve the vote this round.
    hash1 = computeVoteHash({
      price: price1,
      salt: salt1,
      account: account1,
      time,
      roundId,
      identifier
    });
    await voting.commitVote(identifier, time, hash1, { from: account1 });
    await moveToNextPhase(voting);
    await voting.revealVote(identifier, time, price1, salt1, { from: account1 });
  });

  it("Two thirds majority", async function() {
    const identifier = web3.utils.utf8ToHex("two-thirds");
    const time = "1000";

    // Make the Oracle support this identifier.
    await supportedIdentifiers.addSupportedIdentifier(identifier);

    // Request a price and move to the next round where that will be voted on.
    await voting.requestPrice(identifier, time, { from: registeredContract });
    await moveToNextRound(voting);
    const roundId = (await voting.getCurrentRoundId()).toString();

    // Commit votes.
    const losingPrice = 123;
    const salt1 = getRandomUnsignedInt();
    const hash1 = computeVoteHash({
      price: losingPrice,
      salt: salt1,
      account: account1,
      time,
      roundId,
      identifier
    });
    await voting.commitVote(identifier, time, hash1, { from: account1 });

    // Both account 2 and 3 vote for 456.
    const winningPrice = 456;

    const salt2 = getRandomUnsignedInt();
    const hash2 = computeVoteHash({
      price: winningPrice,
      salt: salt2,
      account: account2,
      time,
      roundId,
      identifier
    });
    await voting.commitVote(identifier, time, hash2, { from: account2 });

    const salt3 = getRandomUnsignedInt();
    const hash3 = computeVoteHash({
      price: winningPrice,
      salt: salt3,
      account: account3,
      time,
      roundId,
      identifier
    });
    await voting.commitVote(identifier, time, hash3, { from: account3 });

    // Reveal the votes.
    await moveToNextPhase(voting);
    await voting.revealVote(identifier, time, losingPrice, salt1, { from: account1 });
    await voting.revealVote(identifier, time, winningPrice, salt2, { from: account2 });
    await voting.revealVote(identifier, time, winningPrice, salt3, { from: account3 });

    // Price should resolve to the one that 2 and 3 voted for.
    await moveToNextRound(voting);
    assert.equal(
      (await voting.getPrice(identifier, time, { from: registeredContract })).toString(),
      winningPrice.toString()
    );
  });

  it("GAT", async function() {
    const identifier = web3.utils.utf8ToHex("gat");
    let time = "1000";

    // Make the Oracle support this identifier.
    await supportedIdentifiers.addSupportedIdentifier(identifier);

    // Request a price and move to the next round where that will be voted on.
    await voting.requestPrice(identifier, time, { from: registeredContract });
    await moveToNextRound(voting);
    let roundId = (await voting.getCurrentRoundId()).toString();

    // Commit vote.
    const price = 123;
    const salt = getRandomUnsignedInt();
    let hash1 = computeVoteHash({
      price,
      salt,
      account: account1,
      time,
      roundId,
      identifier
    });
    await voting.commitVote(identifier, time, hash1, { from: account1 });
    let hash4 = computeVoteHash({
      price,
      salt,
      account: account4,
      time,
      roundId,
      identifier
    });
    await voting.commitVote(identifier, time, hash4, { from: account4 });

    // Reveal the vote.
    await moveToNextPhase(voting);
    await voting.revealVote(identifier, time, price, salt, { from: account4 });
    const initialRoundId = await voting.getCurrentRoundId();

    // Since the GAT was not hit, the price should not resolve.
    await moveToNextRound(voting);
    const newRoundId = await voting.getCurrentRoundId();
    assert.isFalse(await voting.hasPrice(identifier, time, { from: registeredContract }));

    // Can't claim rewards if the price wasn't resolved.
    const req = [{ identifier: identifier, time: time }];
    assert(await didContractThrow(voting.retrieveRewards(account4, initialRoundId, req)));

    // Setting GAT should revert if larger than 100%
    assert(await didContractThrow(voting.setGatPercentage({ rawvalue: web3.utils.toWei("1.1", "ether") })));

    // With a smaller GAT value of 3%, account4 can pass the vote on their own with 4% of all tokens.
    await setNewGatPercentage(web3.utils.toWei("0.03", "ether"));

    // Create new vote hashes with the new round ID and commit votes.
    roundId = (await voting.getCurrentRoundId()).toString();
    hash4 = computeVoteHash({
      price,
      salt,
      account: account4,
      time,
      roundId,
      identifier
    });
    await voting.commitVote(identifier, time, hash4, { from: account4 });

    // Reveal votes.
    await moveToNextPhase(voting);
    await voting.revealVote(identifier, time, price, salt, { from: account4 });

    await moveToNextRound(voting);
    assert.equal((await voting.getPrice(identifier, time, { from: registeredContract })).toString(), price.toString());

    // Must specify the right roundId when retrieving rewards.
    assert(await didContractThrow(voting.retrieveRewards(account4, initialRoundId, req)));
    await voting.retrieveRewards(account4, newRoundId, req);

    // Set GAT back to 5% and test a larger vote. With more votes the GAT should be hit
    // and the price should resolve.
    await setNewGatPercentage(web3.utils.toWei("0.05", "ether"));

    // As the previous request has been filled, we need to progress time such that we
    // can vote on the same identifier and request a new price to vote on.
    time += 10;
    await voting.requestPrice(identifier, time, { from: registeredContract });
    await moveToNextRound(voting);

    // Commit votes.
    roundId = (await voting.getCurrentRoundId()).toString();
    hash4 = computeVoteHash({
      price,
      salt,
      account: account4,
      time,
      roundId,
      identifier
    });
    hash1 = computeVoteHash({
      price,
      salt,
      account: account1,
      time,
      roundId,
      identifier
    });
    await voting.commitVote(identifier, time, hash4, { from: account4 });
    await voting.commitVote(identifier, time, hash1, { from: account1 });

    // Reveal votes.
    await moveToNextPhase(voting);
    await voting.revealVote(identifier, time, price, salt, { from: account4 });
    await voting.revealVote(identifier, time, price, salt, { from: account1 });

    await moveToNextRound(voting);
    assert.equal((await voting.getPrice(identifier, time, { from: registeredContract })).toString(), price.toString());

    // Must specify the right roundId when retrieving rewards.
    assert(await didContractThrow(voting.retrieveRewards(account4, initialRoundId, req)));
    await voting.retrieveRewards(account4, newRoundId, req);
  });

  it("Basic Snapshotting", async function() {
    const identifier = web3.utils.utf8ToHex("basic-snapshotting");
    const time = "1000";

    // Make the Oracle support this identifier.
    await supportedIdentifiers.addSupportedIdentifier(identifier);

    // Request a price and move to the next round where that will be voted on.
    await voting.requestPrice(identifier, time, { from: registeredContract });
    await moveToNextRound(voting);
    const roundId = (await voting.getCurrentRoundId()).toString();

    // Commit votes.

    // account3 starts with only 1/3 of the tokens, but votes for 123.
    const winningPrice = 123;
    const salt3 = getRandomUnsignedInt();
    const hash3 = computeVoteHash({
      price: winningPrice,
      salt: salt3,
      account: account3,
      time,
      roundId,
      identifier
    });
    await voting.commitVote(identifier, time, hash3, { from: account3 });

    // Both account 2 and 3, who start with 2/3 of the tokens, vote for 456.
    const losingPrice = 456;

    const salt1 = getRandomUnsignedInt();
    const hash1 = computeVoteHash({
      price: losingPrice,
      salt: salt1,
      account: account1,
      time,
      roundId,
      identifier
    });
    await voting.commitVote(identifier, time, hash1, { from: account1 });

    const salt2 = getRandomUnsignedInt();
    const hash2 = computeVoteHash({
      price: losingPrice,
      salt: salt2,
      account: account2,
      time,
      roundId,
      identifier
    });
    await voting.commitVote(identifier, time, hash2, { from: account2 });

    // All 3 accounts should have equal balances to start, so for winningPrice to win, account1 or account2 must
    // transfer more than half of their balance to account3 before the snapshot.
    await votingToken.transfer(account3, web3.utils.toWei("24000000", "ether"), { from: account1 });

    // Move to the reveal phase, where the snapshot should be taken.
    await moveToNextPhase(voting);

    // The snapshotId of the current round should be zero before initiating the snapshot
    assert.equal((await voting.rounds(await voting.getCurrentRoundId())).snapshotId.toString(), "0");

    // Directly snapshot the current round to lock in token balances.
    await voting.snapshotCurrentRound();

    // The snapshotId of the current round should be non zero after the snapshot is taken
    assert.notEqual((await voting.rounds(await voting.getCurrentRoundId())).snapshotId.toString(), "0");

    // Account2 can now reveal their vote.
    await voting.revealVote(identifier, time, losingPrice, salt2, { from: account2 });

    // Transfer the tokens back. This should have no effect on the outcome since the snapshot has already been taken.
    await votingToken.transfer(account1, web3.utils.toWei("24000000", "ether"), { from: account3 });

    // Modification of the GAT or inflation rate should also not effect this rounds vote outcome as these have been locked into the snapshot. Increasing the GAT to 90% (requiring close to unanimous agreement) should therefore have no effect.
    await setNewGatPercentage(web3.utils.toWei("0.9", "ether"));

    // Do the final two reveals.
    await voting.revealVote(identifier, time, losingPrice, salt1, { from: account1 });
    await voting.revealVote(identifier, time, winningPrice, salt3, { from: account3 });

    // The resulting price should be the winningPrice that account3 voted for.
    await moveToNextRound(voting);
    assert.equal(
      (await voting.getPrice(identifier, time, { from: registeredContract })).toString(),
      winningPrice.toString()
    );

    // Reset the GAT to 5% for subsequent rounds.
    await setNewGatPercentage(web3.utils.toWei("0.05", "ether"));
  });

  it("Snapshotting from initial reveal", async function() {
    const identifier = web3.utils.utf8ToHex("basic-snapshotting2");
    const time = "1000";

    // Make the Oracle support this identifier.
    await supportedIdentifiers.addSupportedIdentifier(identifier);

    // Request a price and move to the next round where that will be voted on.
    await voting.requestPrice(identifier, time, { from: registeredContract });
    await moveToNextRound(voting);
    const roundId = (await voting.getCurrentRoundId()).toString();

    // Commit votes
    const price = 456;
    const salt1 = getRandomUnsignedInt();
    const hash1 = computeVoteHash({
      price: price,
      salt: salt1,
      account: account1,
      time,
      roundId,
      identifier
    });
    await voting.commitVote(identifier, time, hash1, { from: account1 });

    const salt2 = getRandomUnsignedInt();
    const hash2 = computeVoteHash({
      price: price,
      salt: salt2,
      account: account2,
      time,
      roundId,
      identifier
    });
    await voting.commitVote(identifier, time, hash2, { from: account2 });

    // Move to the reveal phase, where the snapshot should be taken.
    await moveToNextPhase(voting);

    // The snapshotId of the current round should be zero before initiating the snapshot.
    assert.equal((await voting.rounds(await voting.getCurrentRoundId())).snapshotId.toString(), "0");

    // The first revealer should result in a snapshot being taken.
    await voting.revealVote(identifier, time, price, salt1, { from: account1 });

    // The snapshotId of the current round should be non zero after the snapshot is taken.
    const snapShotId = (await voting.rounds(await voting.getCurrentRoundId())).snapshotId.toString();
    assert.notEqual(snapShotId, "0");

    // A second reveal should or a direct snapshot call should not modify the shapshot id.
    await voting.revealVote(identifier, time, price, salt2, { from: account2 });
    await voting.snapshotCurrentRound();
    assert.equal((await voting.rounds(await voting.getCurrentRoundId())).snapshotId.toString(), snapShotId);
  });

  it("Only registered contracts", async function() {
    const identifier = web3.utils.utf8ToHex("only-registered");
    const time = "1000";

    // Make the Oracle support this identifier.
    await supportedIdentifiers.addSupportedIdentifier(identifier);

    // Unregistered contracts can't request prices.
    assert(await didContractThrow(voting.requestPrice(identifier, time, { from: unregisteredContract })));

    // Request the price and resolve the price.
    voting.requestPrice(identifier, time, { from: registeredContract });
    await moveToNextRound(voting);
    const roundId = (await voting.getCurrentRoundId()).toString();
    const winningPrice = 123;
    const salt = getRandomUnsignedInt();
    const hash = computeVoteHash({
      price: winningPrice,
      salt,
      account: account1,
      time,
      roundId,
      identifier
    });
    await voting.commitVote(identifier, time, hash, { from: account1 });
    await moveToNextPhase(voting);
    await voting.revealVote(identifier, time, winningPrice, salt, { from: account1 });
    await moveToNextRound(voting);

    // Sanity check that registered contracts can retrieve prices.
    assert.isTrue(await voting.hasPrice(identifier, time, { from: registeredContract }));
    assert.equal(await voting.getPrice(identifier, time, { from: registeredContract }), winningPrice);

    // Unregistered contracts can't retrieve prices.
    assert(await didContractThrow(voting.hasPrice(identifier, time, { from: unregisteredContract })));
    assert(await didContractThrow(voting.getPrice(identifier, time, { from: unregisteredContract })));
  });

  it("View methods", async function() {
    const identifier = web3.utils.utf8ToHex("view-methods");
    const time = "1000";

    // Make the Oracle support this identifier.
    await supportedIdentifiers.addSupportedIdentifier(identifier);

    // Verify view methods `hasPrice`, `getPrice`, and `getPriceRequestStatuses`` for a price was that was never requested.
    assert.isFalse(await voting.hasPrice(identifier, time, { from: registeredContract }));
    assert(await didContractThrow(voting.getPrice(identifier, time, { from: registeredContract })));
    let statuses = await voting.getPriceRequestStatuses([{ identifier, time: time }]);
    assert.equal(statuses[0].status.toString(), "0");
    assert.equal(statuses[0].lastVotingRound.toString(), "0");

    // Request a price and move to the next round where that will be voted on.
    await voting.requestPrice(identifier, time, { from: registeredContract });

    // Verify view methods `hasPrice`, `getPrice`, and `getPriceRequestStatuses` for a price scheduled for the next round.
    assert.isFalse(await voting.hasPrice(identifier, time, { from: registeredContract }));
    assert(await didContractThrow(voting.getPrice(identifier, time, { from: registeredContract })));
    statuses = await voting.getPriceRequestStatuses([{ identifier, time: time }]);
    assert.equal(statuses[0].status.toString(), "3");
    assert.equal(statuses[0].lastVotingRound.toString(), (await voting.getCurrentRoundId()).addn(1).toString());

    await moveToNextRound(voting);
    const roundId = (await voting.getCurrentRoundId()).toString();

    // Verify `getPriceRequestStatuses` for a price request scheduled for this round.
    statuses = await voting.getPriceRequestStatuses([{ identifier, time: time }]);
    assert.equal(statuses[0].status.toString(), "1");
    assert.equal(statuses[0].lastVotingRound.toString(), (await voting.getCurrentRoundId()).toString());

    const price = 123;

    // Accounts 1 and 2 commit votes.
    const salt1 = getRandomUnsignedInt();
    const hash1 = computeVoteHash({
      price,
      salt: salt1,
      account: account1,
      time,
      roundId,
      identifier
    });
    await voting.commitVote(identifier, time, hash1, { from: account1 });

    const salt2 = getRandomUnsignedInt();
    const hash2 = computeVoteHash({
      price,
      salt: salt2,
      account: account2,
      time,
      roundId,
      identifier
    });
    await voting.commitVote(identifier, time, hash2, { from: account2 });

    await moveToNextPhase(voting);

    await voting.revealVote(identifier, time, price, salt1, { from: account1 });
    await voting.revealVote(identifier, time, price, salt2, { from: account2 });

    await moveToNextRound(voting);

    // Verify view methods `hasPrice`, `getPrice`, and `getPriceRequestStatuses` for a resolved price request.
    assert.isTrue(await voting.hasPrice(identifier, time, { from: registeredContract }));
    assert.equal((await voting.getPrice(identifier, time, { from: registeredContract })).toString(), price.toString());
    statuses = await voting.getPriceRequestStatuses([{ identifier, time: time }]);
    assert.equal(statuses[0].status.toString(), "2");
    assert.equal(statuses[0].lastVotingRound.toString(), (await voting.getCurrentRoundId()).subn(1).toString());
  });

  it("Rewards expiration", async function() {
    // Set the inflation rate to 100% (for ease of computation).
    await setNewInflationRate(web3.utils.toWei("1", "ether"));

    const identifier = web3.utils.utf8ToHex("rewards-expiration");
    const time = "1000";

    const initialTotalSupply = await votingToken.totalSupply();

    // Make the Oracle support this identifier.
    await supportedIdentifiers.addSupportedIdentifier(identifier);

    // Request a price and move to the next round where that will be voted on.
    await voting.requestPrice(identifier, time, { from: registeredContract });
    await moveToNextRound(voting);
    let roundId = (await voting.getCurrentRoundId()).toString();

    const winningPrice = 456;

    const salt = getRandomUnsignedInt();
    const hash = computeVoteHash({
      price: winningPrice,
      salt,
      account: account1,
      time,
      roundId,
      identifier
    });
    await voting.commitVote(identifier, time, hash, { from: account1 });

    // Reveal the votes.
    await moveToNextPhase(voting);
    await voting.revealVote(identifier, time, winningPrice, salt, { from: account1 });

    // This should have no effect because the expiration has been captured.
    await voting.setRewardsExpirationTimeout(1);
    // Only the owner should be able to call this method, however.
    assert(await didContractThrow(voting.setRewardsExpirationTimeout(1, { from: account2 })));

    roundId = await voting.getCurrentRoundId();
    const req = [{ identifier: identifier, time: time }];

    // Wait 7 rounds before retrieving rewards => still OK.
    for (let i = 0; i < 7; i++) {
      await moveToNextRound(voting);
    }
    let account1Rewards = await voting.retrieveRewards.call(account1, roundId, req);
    assert.equal(account1Rewards.toString(), initialTotalSupply.toString());

    // Wait 8 rounds => rewards have expired.
    await moveToNextRound(voting);

    // No change in balances because the rewards have expired.
    account1Rewards = await voting.retrieveRewards.call(account1, roundId, req);
    assert.equal(account1Rewards.toString(), "0");

    // The price is still resolved and the expected events are emitted.
    const result = await voting.retrieveRewards(account1, roundId, req);
    truffleAssert.eventEmitted(result, "PriceResolved", ev => {
      return (
        ev.roundId.toString() == roundId.toString() &&
        web3.utils.hexToUtf8(ev.identifier) == web3.utils.hexToUtf8(identifier) &&
        ev.time == time &&
        ev.price.toString() == winningPrice.toString()
      );
    });
    truffleAssert.eventEmitted(result, "RewardsRetrieved", ev => {
      return (
        ev.voter.toString() == account1.toString() &&
        ev.roundId.toString() == roundId.toString() &&
        ev.time == time &&
        ev.numTokens.toString() == "0"
      );
    });

    // Check overflow edge case by setting really long expiration timeout that'll overflow.
    await voting.setRewardsExpirationTimeout(
      web3.utils
        .toBN(2)
        .pow(web3.utils.toBN(256))
        .subn(10)
        .toString()
    );
    await moveToNextPhase(voting);
    const time2 = "1001";
    await voting.requestPrice(identifier, time2, { from: registeredContract });
    await moveToNextRound(voting);
    const price = 456;
    const salt2 = getRandomUnsignedInt();
    const hash2 = web3.utils.soliditySha3(price, salt2);
    await voting.commitVote(identifier, time2, hash2, { from: account1 });
    await moveToNextPhase(voting);
    assert(await didContractThrow(voting.revealVote(identifier, time2, price, salt2, { from: account1 })));

    // Reset the inflation rate and rewards expiration time.
    await setNewInflationRate("0");
    await voting.setRewardsExpirationTimeout(60 * 60 * 24 * 14);
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
    await supportedIdentifiers.addSupportedIdentifier(identifier);

    // Request a price and move to the next round where that will be voted on.
    await voting.requestPrice(identifier, time1, { from: registeredContract });
    await moveToNextRound(voting);
    let roundId = (await voting.getCurrentRoundId()).toString();

    // Commit votes.
    const losingPrice = 123;
    const salt1 = getRandomUnsignedInt();
    const hash1 = computeVoteHash({
      price: losingPrice,
      salt: salt1,
      account: account1,
      time: time1,
      roundId,
      identifier
    });
    await voting.commitVote(identifier, time1, hash1, { from: account1 });

    // Both account 2 and 3 vote for 456.
    const winningPrice = 456;

    const salt2 = getRandomUnsignedInt();
    const hash2 = computeVoteHash({
      price: winningPrice,
      salt: salt2,
      account: account2,
      time: time1,
      roundId,
      identifier
    });
    await voting.commitVote(identifier, time1, hash2, { from: account2 });

    const salt3 = getRandomUnsignedInt();
    const hash3 = computeVoteHash({
      price: winningPrice,
      salt: salt3,
      account: account3,
      time: time1,
      roundId,
      identifier
    });
    await voting.commitVote(identifier, time1, hash3, { from: account3 });

    // Reveal the votes.
    await moveToNextPhase(voting);
    await voting.revealVote(identifier, time1, losingPrice, salt1, { from: account1 });
    await voting.revealVote(identifier, time1, winningPrice, salt2, { from: account2 });
    await voting.revealVote(identifier, time1, winningPrice, salt3, { from: account3 });

    roundId = await voting.getCurrentRoundId();

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

    let result = await supportedIdentifiers.addSupportedIdentifier(identifier);

    await moveToNextRound(voting);
    let currentRoundId = await voting.getCurrentRoundId();

    // New price requests trigger events.
    result = await voting.requestPrice(identifier, time, { from: registeredContract });
    truffleAssert.eventEmitted(result, "PriceRequestAdded", ev => {
      return (
        // The vote is added to the next round, so we have to add 1 to the current round id.
        ev.roundId.toString() == currentRoundId.addn(1).toString() &&
        web3.utils.hexToUtf8(ev.identifier) == web3.utils.hexToUtf8(identifier) &&
        ev.time.toString() == time.toString()
      );
    });

    await moveToNextRound(voting);
    currentRoundId = await voting.getCurrentRoundId();

    // Repeated price requests don't trigger events.
    result = await voting.requestPrice(identifier, time, { from: registeredContract });
    truffleAssert.eventNotEmitted(result, "PriceRequestAdded");

    // Commit vote.
    const price = 123;
    const salt = getRandomUnsignedInt();
    let hash4 = computeVoteHash({
      price,
      salt,
      account: account4,
      time,
      roundId: currentRoundId,
      identifier
    });
    result = await voting.commitVote(identifier, time, hash4, { from: account4 });
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

    // Now the whale and account4 vote and the vote resolves.
    const hash1 = computeVoteHash({
      price,
      salt,
      account: account1,
      time,
      roundId: currentRoundId,
      identifier
    });
    const wrongPrice = 124;
    hash4 = computeVoteHash({
      price: wrongPrice,
      salt,
      account: account4,
      time,
      roundId: currentRoundId,
      identifier
    });
    await voting.commitVote(identifier, time, hash1, { from: account1 });
    result = await voting.commitVote(identifier, time, hash4, { from: account4 });
    await moveToNextPhase(voting);
    await voting.revealVote(identifier, time, price, salt, { from: account1 });
    await voting.revealVote(identifier, time, wrongPrice, salt, { from: account4 });
    const initialTotalSupply = await votingToken.totalSupply();
    const roundId = await voting.getCurrentRoundId();
    await moveToNextRound(voting);

    // When the round updates, the price request should be resolved.
    result = await voting.retrieveRewards(account1, roundId, [{ identifier, time }]);
    truffleAssert.eventEmitted(result, "PriceResolved", ev => {
      return (
        ev.roundId.toString() == currentRoundId.toString() &&
        web3.utils.hexToUtf8(ev.identifier) == web3.utils.hexToUtf8(identifier) &&
        ev.time == time &&
        ev.price.toString() == price.toString()
      );
    });
    truffleAssert.eventEmitted(result, "RewardsRetrieved", ev => {
      return (
        ev.voter.toString() == account1.toString() &&
        ev.roundId.toString() == currentRoundId.toString() &&
        web3.utils.hexToUtf8(ev.identifier) == web3.utils.hexToUtf8(identifier) &&
        ev.time == time &&
        // Inflation is 100% and there was only one voter.
        ev.numTokens.toString() == initialTotalSupply.toString()
      );
    });

    // RewardsRetrieved event gets emitted for every reward retrieval that's attempted, even if no tokens are minted
    // because the vote was wrong.
    result = await voting.retrieveRewards(account4, roundId, [{ identifier, time }]);
    truffleAssert.eventEmitted(result, "RewardsRetrieved");

    // No duplicate events if the same user tries to claim rewards again.
    result = await voting.retrieveRewards(account1, roundId, [{ identifier, time }]);
    truffleAssert.eventNotEmitted(result, "RewardsRetrieved");

    // No RewardsRetrieved event if the user didn't vote at all.
    result = await voting.retrieveRewards(account3, roundId, [{ identifier, time }]);
    truffleAssert.eventNotEmitted(result, "RewardsRetrieved");
  });

  it("Commit and persist the encrypted price", async function() {
    const identifier = web3.utils.utf8ToHex("commit-and-persist");
    const time = "1000";
    await supportedIdentifiers.addSupportedIdentifier(identifier);

    await voting.requestPrice(identifier, time, { from: registeredContract });
    await moveToNextRound(voting);
    let roundId = (await voting.getCurrentRoundId()).toString();

    const price = getRandomSignedInt();
    const salt = getRandomUnsignedInt();
    const hash = computeVoteHash({
      price,
      salt,
      account: account1,
      time,
      roundId,
      identifier
    });
    roundId = await voting.getCurrentRoundId();

    const { privateKey, publicKey } = await deriveKeyPairFromSignatureTruffle(
      web3,
      getKeyGenMessage(roundId),
      account1
    );
    const vote = { price: price.toString(), salt: salt.toString() };
    const encryptedMessage = await encryptMessage(publicKey, JSON.stringify(vote));

    let result = await voting.commitAndEmitEncryptedVote(identifier, time, hash, encryptedMessage);
    truffleAssert.eventEmitted(result, "EncryptedVote", ev => {
      return (
        ev.voter.toString() === account1 &&
        ev.roundId.toString() === roundId.toString() &&
        web3.utils.hexToUtf8(ev.identifier) == web3.utils.hexToUtf8(identifier) &&
        ev.time.toString() == time &&
        ev.encryptedVote === encryptedMessage
      );
    });

    const events = await voting.getPastEvents("EncryptedVote", { fromBlock: 0 });
    const retrievedEncryptedMessage = events[events.length - 1].returnValues.encryptedVote;

    // Check that the emitted message is correct.
    assert.equal(encryptedMessage, retrievedEncryptedMessage);

    await moveToNextPhase(voting);

    const decryptedMessage = await decryptMessage(privateKey, retrievedEncryptedMessage);
    const retrievedVote = JSON.parse(decryptedMessage);

    assert(await didContractThrow(voting.revealVote(identifier, time, getRandomSignedInt(), getRandomUnsignedInt())));
    await voting.revealVote(identifier, time, retrievedVote.price, retrievedVote.salt);
  });

  it("Commit and persist the encrypted price against the same identifier/time pair multiple times", async function() {
    const identifier = web3.utils.utf8ToHex("commit-and-persist2");
    const time = "1000";
    await supportedIdentifiers.addSupportedIdentifier(identifier);

    await voting.requestPrice(identifier, time, { from: registeredContract });
    await moveToNextRound(voting);
    const roundId = (await voting.getCurrentRoundId()).toString();

    const price = getRandomSignedInt();
    const salt = getRandomUnsignedInt();
    const hash = computeVoteHash({
      price,
      salt,
      account: account1,
      time,
      roundId,
      identifier
    });

    const { publicKey } = await deriveKeyPairFromSignatureTruffle(web3, getKeyGenMessage(roundId), account1);
    const vote = { price: price.toString(), salt: salt.toString() };
    const encryptedMessage = await encryptMessage(publicKey, JSON.stringify(vote));
    await voting.commitAndEmitEncryptedVote(identifier, time, hash, encryptedMessage);

    const secondEncryptedMessage = await encryptMessage(publicKey, getRandomUnsignedInt());
    await voting.commitAndEmitEncryptedVote(identifier, time, hash, secondEncryptedMessage);

    const events = await voting.getPastEvents("EncryptedVote", { fromBlock: 0 });
    const secondRetrievedEncryptedMessage = events[events.length - 1].returnValues.encryptedVote;

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

      await supportedIdentifiers.addSupportedIdentifier(identifier);
      await voting.requestPrice(identifier, requestTime, { from: registeredContract });
    }

    await moveToNextRound(voting);

    const roundId = await voting.getCurrentRoundId();

    // Commit without emitting any encrypted messages
    const result = await voting.batchCommit(
      priceRequests.map(request => ({
        identifier: request.identifier,
        time: request.time,
        hash: request.hash,
        encryptedVote: []
      }))
    );
    truffleAssert.eventNotEmitted(result, "EncryptedVote");

    // This time we commit while storing the encrypted messages
    await voting.batchCommit(priceRequests);

    for (let i = 0; i < numRequests; i++) {
      let priceRequest = priceRequests[i];
      let events = await voting.getPastEvents("EncryptedVote", {
        fromBlock: 0,
        filter: { identifier: priceRequest.identifier, time: priceRequest.time }
      });
      let retrievedEncryptedMessage = events[events.length - 1].returnValues.encryptedVote;
      assert.equal(retrievedEncryptedMessage, priceRequest.encryptedVote);
    }

    // Edit a single commit
    const modifiedPriceRequest = priceRequests[0];
    modifiedPriceRequest.hash = web3.utils.soliditySha3(getRandomUnsignedInt());
    modifiedPriceRequest.encryptedVote = web3.utils.utf8ToHex("some other encrypted message");
    await voting.commitAndEmitEncryptedVote(
      modifiedPriceRequest.identifier,
      modifiedPriceRequest.time,
      modifiedPriceRequest.hash,
      modifiedPriceRequest.encryptedVote
    );

    // Test that the encrypted messages are still correct
    for (let i = 0; i < numRequests; i++) {
      let priceRequest = priceRequests[i];
      let events = await voting.getPastEvents("EncryptedVote", {
        fromBlock: 0,
        filter: { identifier: priceRequest.identifier, time: priceRequest.time }
      });
      let retrievedEncryptedMessage = events[events.length - 1].returnValues.encryptedVote;
      assert.equal(retrievedEncryptedMessage, priceRequest.encryptedVote);
    }
  });

  it("Batch reveal multiple commits", async function() {
    const identifier = web3.utils.utf8ToHex("batch-reveal");
    const time1 = "1000";
    const time2 = "1001";
    await supportedIdentifiers.addSupportedIdentifier(identifier);

    await voting.requestPrice(identifier, time1, { from: registeredContract });
    await voting.requestPrice(identifier, time2, { from: registeredContract });
    await moveToNextRound(voting);
    const roundId = (await voting.getCurrentRoundId()).toString();

    const price1 = getRandomSignedInt();
    const price2 = getRandomSignedInt();
    const salt1 = getRandomUnsignedInt();
    const salt2 = getRandomUnsignedInt();
    const hash1 = computeVoteHash({
      price: price1,
      salt: salt1,
      account: account1,
      time: time1,
      roundId,
      identifier
    });
    const hash2 = computeVoteHash({
      price: price2,
      salt: salt2,
      account: account1,
      time: time2,
      roundId,
      identifier
    });

    const { publicKey } = await deriveKeyPairFromSignatureTruffle(web3, getKeyGenMessage(roundId), account1);
    const vote = { price: price1.toString(), salt: salt2.toString() };
    const encryptedMessage = await encryptMessage(publicKey, JSON.stringify(vote));

    await voting.commitAndEmitEncryptedVote(identifier, time1, hash1, encryptedMessage);
    await voting.commitVote(identifier, time2, hash2);

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
  });

  it("Migration", async function() {
    const identifier = web3.utils.utf8ToHex("migration");
    const time1 = "1000";
    const time2 = "2000";
    // Deploy our own voting because this test case will migrate it.
    const voting = await Voting.new(
      "86400",
      { rawValue: "0" },
      { rawValue: "0" },
      "86400",
      votingToken.address,
      (await Finder.deployed()).address,
      Timer.address
    );
    await supportedIdentifiers.addSupportedIdentifier(identifier);

    await voting.requestPrice(identifier, time1, { from: registeredContract });
    await voting.requestPrice(identifier, time2, { from: registeredContract });
    await moveToNextRound(voting);
    const roundId = (await voting.getCurrentRoundId()).toString();
    const price = 123;
    const salt = getRandomSignedInt();
    const hash = computeVoteHash({
      price,
      salt,
      account: account1,
      time: time1,
      roundId,
      identifier
    });
    await voting.commitVote(identifier, time1, hash, { from: account1 });
    await moveToNextPhase(voting);
    await voting.revealVote(identifier, time1, price, salt, { from: account1 });
    await moveToNextRound(voting);

    // New voting can only call methods after the migration, not before.
    assert(await voting.hasPrice(identifier, time1, { from: registeredContract }));
    assert(await didContractThrow(voting.hasPrice(identifier, time1, { from: migratedVoting })));

    // Need permissions to migrate.
    assert(await didContractThrow(voting.setMigrated(migratedVoting, { from: migratedVoting })));
    await voting.setMigrated(migratedVoting);

    // Now only new voting can call methods.
    assert(await voting.hasPrice(identifier, time1, { from: migratedVoting }));
    assert(await didContractThrow(voting.hasPrice(identifier, time1, { from: registeredContract })));
    assert(await didContractThrow(voting.commitVote(identifier, time2, hash, { from: account1 })));
  });

  it("pendingPriceRequests array length", async function() {
    // Use a test derived contract to expose the internal array (and its length).
    const votingTest = await VotingTest.new(
      "86400", // 1 day phase length
      { rawValue: web3.utils.toWei("0.05") }, // 5% GAT
      { rawValue: "0" }, // No inflation
      "1209600", // 2 week reward expiration
      votingToken.address,
      Finder.address,
      Timer.address
    );

    await moveToNextRound(votingTest);

    const identifier = web3.utils.utf8ToHex("array-size");
    const time = "1000";
    const startingLength = (await votingTest.getPendingPriceRequestsArray()).length;

    // pendingPriceRequests should start with no elements.
    assert.equal(startingLength, 0);

    // Make the Oracle support the identifier.
    await supportedIdentifiers.addSupportedIdentifier(identifier);

    // Request a price.
    await votingTest.requestPrice(identifier, time, { from: registeredContract });

    // There should be one element in the array after the first price request.
    assert.equal((await votingTest.getPendingPriceRequestsArray()).length, 1);

    // Move to voting round.
    await moveToNextRound(votingTest);
    const votingRound = await votingTest.getCurrentRoundId();

    // Commit vote.
    const price = getRandomSignedInt();
    const salt = getRandomUnsignedInt();
    const hash = computeVoteHash({
      price,
      salt,
      account: account1,
      time,
      roundId: votingRound.toString(),
      identifier
    });
    await votingTest.commitVote(identifier, time, hash);

    // Reveal phase.
    await moveToNextPhase(votingTest);

    // Reveal vote.
    await votingTest.revealVote(identifier, time, price, salt);

    // Pending requests should be empty after the voting round ends and the price is resolved.
    await moveToNextRound(votingTest);

    await votingTest.retrieveRewards(account1, votingRound, [{ identifier, time }]);

    // After retrieval, the length should be decreased back to 0 since the element added in this test is now deleted.
    assert.equal((await votingTest.getPendingPriceRequestsArray()).length, 0);
  });
});

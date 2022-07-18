const hre = require("hardhat");
const { web3 } = hre;
const { runVotingV2Fixture, ZERO_ADDRESS } = require("@uma/common");
const { getContract, assertEventEmitted, assertEventNotEmitted } = hre;
const {
  RegistryRolesEnum,
  VotePhasesEnum,
  didContractThrow,
  getRandomSignedInt,
  decryptMessage,
  encryptMessage,
  deriveKeyPairFromSignatureTruffle,
  computeVoteHash,
  computeVoteHashAncillary,
  getKeyGenMessage,
} = require("@uma/common");
const { moveToNextRound, moveToNextPhase } = require("../../utils/Voting.js");
const { assert } = require("chai");
const { toBN } = web3.utils;

const Finder = getContract("Finder");
const Registry = getContract("Registry");
const VotingV2 = getContract("VotingV2");
const VotingInterfaceTesting = getContract("VotingInterfaceTesting");
const VotingAncillaryInterfaceTesting = getContract("VotingAncillaryInterfaceTesting");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const VotingToken = getContract("VotingToken");
const VotingV2Test = getContract("VotingV2Test");
const Timer = getContract("Timer");
const SlashingLibrary = getContract("SlashingLibrary");

const { utf8ToHex, padRight } = web3.utils;

const toWei = (value) => toBN(web3.utils.toWei(value, "ether"));

describe("VotingV2", function () {
  let voting, votingToken, registry, supportedIdentifiers, registeredContract, unregisteredContract, migratedVoting;
  let accounts, account1, account2, account3, account4, rand;

  const setNewGat = async (gat) => {
    await voting.methods.setGat(gat).send({ from: accounts[0] });
  };

  beforeEach(async function () {
    accounts = await web3.eth.getAccounts();
    [account1, account2, account3, account4, rand, registeredContract, unregisteredContract, migratedVoting] = accounts;
    await runVotingV2Fixture(hre);
    voting = await await VotingV2.deployed();

    supportedIdentifiers = await IdentifierWhitelist.deployed();
    votingToken = await VotingToken.deployed();
    registry = await Registry.deployed();

    // Allow account1 to mint tokens.
    const minterRole = 1;
    await votingToken.methods.addMember(minterRole, account1).send({ from: accounts[0] });

    // Seed the three accounts and stake into the voting contract.  account1 starts with 100MM tokens, so divide up as:
    // 1: 32MM
    // 2: 32MM
    // 3: 32MM
    // 4: 4MM (can't reach the 5% GAT alone)
    await votingToken.methods.approve(voting.options.address, toWei("3200000000")).send({ from: account1 });
    await voting.methods.stake(toWei("32000000")).send({ from: account1 });
    await votingToken.methods.transfer(account2, toWei("32000000")).send({ from: accounts[0] });
    await votingToken.methods.approve(voting.options.address, toWei("3200000000")).send({ from: account2 });
    await voting.methods.stake(toWei("32000000")).send({ from: account2 });
    await votingToken.methods.transfer(account3, toWei("32000000")).send({ from: accounts[0] });
    await votingToken.methods.approve(voting.options.address, toWei("3200000000")).send({ from: account3 });
    await voting.methods.stake(toWei("32000000")).send({ from: account3 });
    await votingToken.methods.transfer(account4, toWei("4000000")).send({ from: accounts[0] });
    await votingToken.methods.approve(voting.options.address, toWei("400000000")).send({ from: account4 });
    await voting.methods.stake(toWei("4000000")).send({ from: account4 });

    // Set the inflation rate to 0 by default, so the balances stay fixed until inflation is tested.

    // Register contract with Registry.
    await registry.methods.addMember(RegistryRolesEnum.CONTRACT_CREATOR, account1).send({ from: accounts[0] });
    await registry.methods.registerContract([], registeredContract).send({ from: account1 });

    // Magic math to ensure we start at the very beginning of a round, and we aren't dependent on the time the tests
    // are run.
    const currentTime = Number((await voting.methods.getCurrentTime().call()).toString());
    const newTime = (Math.floor(currentTime / 172800) + 1) * 172800;
    await voting.methods.setCurrentTime(newTime).send({ from: accounts[0] });

    // Start with a fresh round.
    await moveToNextRound(voting, accounts[0]);
  });

  it("Constructor", async function () {
    // GAT must be < total supply
    const invalidGat = web3.utils.toWei("100000000");
    assert(
      await didContractThrow(
        VotingV2.new(
          "42069", // emissionRate
          toWei("10000"), // spamDeletionProposalBond
          60 * 60 * 24 * 7, // Unstake cooldown
          86400, // PhaseLength
          7200, // minRollToNextRoundLength
          invalidGat, // GAT
          votingToken.options.address, // voting token
          (await Finder.deployed()).options.address, // finder
          (await Timer.deployed()).options.address, // timer
          (await SlashingLibrary.deployed()).options.address // slashing library
        ).send({ from: accounts[0] })
      )
    );
  });
  // TODO: group the tests in this file by "type" with describe blocks.
  it("Vote phasing", async function () {
    // Reset the rounds.
    await moveToNextRound(voting, accounts[0]);

    // RoundId is a function of the voting time defined by floor(timestamp/phaseLength).
    // RoundId for Commit and Reveal phases should be the same.
    const currentTime = parseInt(await voting.methods.getCurrentTime().call());
    const commitRoundId = await voting.methods.getCurrentRoundId().call();
    assert.equal(commitRoundId.toString(), Math.floor(currentTime / 172800));

    // Rounds should start with Commit.
    assert.equal((await voting.methods.getVotePhase().call()).toString(), VotePhasesEnum.COMMIT);

    // Shift of one phase should be Reveal.
    await moveToNextPhase(voting, accounts[0]);
    assert.equal((await voting.methods.getVotePhase().call()).toString(), VotePhasesEnum.REVEAL);

    // Round ID between Commit and Reveal phases should be the same.
    assert.equal(commitRoundId.toString(), (await voting.methods.getCurrentRoundId().call()).toString());

    // A second shift should go back to commit.
    await moveToNextPhase(voting, accounts[0]);
    assert.equal((await voting.methods.getVotePhase().call()).toString(), VotePhasesEnum.COMMIT);
  });

  it("One voter, one request", async function () {
    const identifier = padRight(utf8ToHex("one-voter"), 64);
    const time = "1000";
    // Make the Oracle support this identifier.
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });

    // Request a price and move to the next round where that will be voted on.
    await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });
    await moveToNextRound(voting, accounts[0]);
    // RoundId is a function of the voting time defined by floor(timestamp/phaseLength).
    // RoundId for Commit and Reveal phases should be the same.
    const currentRoundId = await voting.methods.getCurrentRoundId().call();

    const price = getRandomSignedInt();
    const salt = getRandomSignedInt();
    const hash = computeVoteHash({ price, salt, account: account1, time: time, roundId: currentRoundId, identifier });

    // Can't commit hash of 0.
    assert(await didContractThrow(voting.methods.commitVote(identifier, time, "0x0").send({ from: accounts[0] })));

    // Can commit a new hash.
    await voting.methods.commitVote(identifier, time, hash).send({ from: accounts[0] });

    // Voters can alter their commits.
    const newPrice = getRandomSignedInt();
    const newSalt = getRandomSignedInt();
    const newHash = computeVoteHash({
      price: newPrice,
      salt: newSalt,
      account: account1,
      time: time,
      roundId: currentRoundId,
      identifier,
    });

    // Can alter a committed hash.
    await voting.methods.commitVote(identifier, time, newHash).send({ from: accounts[0] });

    // Can't reveal before during the commit phase.
    assert(
      await didContractThrow(voting.methods.revealVote(identifier, time, newPrice, newSalt).send({ from: accounts[0] }))
    );

    // Move to the reveal phase.
    await moveToNextPhase(voting, accounts[0]);

    // This is now required before reveal

    // Can't commit during the reveal phase.
    assert(await didContractThrow(voting.methods.commitVote(identifier, time, newHash).send({ from: accounts[0] })));

    // Can't reveal the overwritten commit.
    assert(
      await didContractThrow(voting.methods.revealVote(identifier, time, price, salt).send({ from: accounts[0] }))
    );

    // Can't reveal with the wrong price but right salt, and reverse.
    assert(
      await didContractThrow(voting.methods.revealVote(identifier, time, newPrice, salt).send({ from: accounts[0] }))
    );
    assert(
      await didContractThrow(voting.methods.revealVote(identifier, time, price, newSalt).send({ from: accounts[0] }))
    );

    // Can't reveal with the incorrect address.
    assert(
      await didContractThrow(voting.methods.revealVote(identifier, time, newPrice, newSalt).send({ from: account2 }))
    );

    // Can't reveal with incorrect timestamp.
    assert(
      await didContractThrow(
        voting.methods.revealVote(identifier, (Number(time) + 1).toString(), newPrice, salt).send({ from: accounts[0] })
      )
    );

    // Can't reveal with incorrect identifier.
    assert(
      await didContractThrow(
        voting.methods
          .revealVote(padRight(utf8ToHex("wrong-identifier"), 64), time, newPrice, newSalt)
          .send({ from: account2 })
      )
    );

    // Successfully reveal the latest commit.
    await voting.methods.revealVote(identifier, time, newPrice, newSalt).send({ from: accounts[0] });

    // Can't reveal the same commit again.
    assert(
      await didContractThrow(voting.methods.revealVote(identifier, time, newPrice, newSalt).send({ from: accounts[0] }))
    );
  });

  it("Overlapping request keys", async function () {
    // Verify that concurrent votes with the same identifier but different times, or the same time but different
    // identifiers don't cause any problems.
    const identifier1 = padRight(utf8ToHex("overlapping-keys1"), 64);
    const time1 = "1000";
    const identifier2 = padRight(utf8ToHex("overlapping-keys2"), 64);
    const time2 = "2000";

    // Make the Oracle support these two identifiers.
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier1).send({ from: accounts[0] });
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier2).send({ from: accounts[0] });

    // Send the requests.
    await voting.methods.requestPrice(identifier1, time2).send({ from: registeredContract });
    await voting.methods.requestPrice(identifier2, time1).send({ from: registeredContract });

    // Move to voting round.
    await moveToNextRound(voting, accounts[0]);
    const roundId = (await voting.methods.getCurrentRoundId().call()).toString();

    const price1 = getRandomSignedInt();
    const salt1 = getRandomSignedInt();
    const hash1 = computeVoteHash({
      price: price1,
      salt: salt1,
      account: account1,
      time: time2,
      roundId,
      identifier: identifier1,
    });

    const price2 = getRandomSignedInt();
    const salt2 = getRandomSignedInt();
    const hash2 = computeVoteHash({
      price: price2,
      salt: salt2,
      account: account1,
      time: time1,
      roundId,
      identifier: identifier2,
    });

    await voting.methods.commitVote(identifier1, time2, hash1).send({ from: accounts[0] });
    await voting.methods.commitVote(identifier2, time1, hash2).send({ from: accounts[0] });

    // Move to the reveal phase.
    await moveToNextPhase(voting, accounts[0]);

    // Can't reveal the wrong combos.
    assert(
      await didContractThrow(voting.methods.revealVote(identifier1, time2, price2, salt2).send({ from: accounts[0] }))
    );
    assert(
      await didContractThrow(voting.methods.revealVote(identifier2, time1, price1, salt1).send({ from: accounts[0] }))
    );
    assert(
      await didContractThrow(voting.methods.revealVote(identifier1, time1, price1, salt1).send({ from: accounts[0] }))
    );
    assert(
      await didContractThrow(voting.methods.revealVote(identifier1, time1, price2, salt2).send({ from: accounts[0] }))
    );

    // Can reveal the right combos.
    await voting.methods.revealVote(identifier1, time2, price1, salt1).send({ from: accounts[0] });
    await voting.methods.revealVote(identifier2, time1, price2, salt2).send({ from: accounts[0] });
  });

  it("Request and retrieval", async function () {
    const identifier1 = padRight(utf8ToHex("request-retrieval1"), 64);
    const time1 = "1000";
    const identifier2 = padRight(utf8ToHex("request-retrieval2"), 64);
    const time2 = "2000";

    // Make the Oracle support these two identifiers.
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier1).send({ from: accounts[0] });
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier2).send({ from: accounts[0] });

    // Requests should not be added to the current voting round.
    await voting.methods.requestPrice(identifier1, time1).send({ from: registeredContract });
    await voting.methods.requestPrice(identifier2, time2).send({ from: registeredContract });

    // Since the round for these requests has not started, the price retrieval should fail.
    assert.isFalse(await voting.methods.hasPrice(identifier1, time1).call({ from: registeredContract }));
    assert.isFalse(await voting.methods.hasPrice(identifier2, time2).call({ from: registeredContract }));
    assert(await didContractThrow(voting.methods.getPrice(identifier1, time1).send({ from: registeredContract })));
    assert(await didContractThrow(voting.methods.getPrice(identifier2, time2).send({ from: registeredContract })));

    // Move to the voting round.
    await moveToNextRound(voting, accounts[0]);
    const roundId = (await voting.methods.getCurrentRoundId().call()).toString();

    // Commit vote 1.
    const price1 = getRandomSignedInt();
    const salt1 = getRandomSignedInt();
    const hash1 = computeVoteHash({
      price: price1,
      salt: salt1,
      account: account1,
      time: time1,
      roundId,
      identifier: identifier1,
    });

    await voting.methods.commitVote(identifier1, time1, hash1).send({ from: accounts[0] });

    // Commit vote 2.
    const price2 = getRandomSignedInt();
    const salt2 = getRandomSignedInt();
    const hash2 = computeVoteHash({
      price: price2,
      salt: salt2,
      account: account1,
      time: time2,
      roundId,
      identifier: identifier2,
    });
    await voting.methods.commitVote(identifier2, time2, hash2).send({ from: accounts[0] });

    // If the voting period is ongoing, prices cannot be returned since they are not finalized.
    assert.isFalse(await voting.methods.hasPrice(identifier1, time1).call({ from: registeredContract }));
    assert.isFalse(await voting.methods.hasPrice(identifier2, time2).call({ from: registeredContract }));
    assert(await didContractThrow(voting.methods.getPrice(identifier1, time1).send({ from: registeredContract })));
    assert(await didContractThrow(voting.methods.getPrice(identifier2, time2).send({ from: registeredContract })));

    // Move to the reveal phase of the voting period.
    await moveToNextPhase(voting, accounts[0]);

    // Reveal both votes.
    await voting.methods.revealVote(identifier1, time1, price1, salt1).send({ from: accounts[0] });
    await voting.methods.revealVote(identifier2, time2, price2, salt2).send({ from: accounts[0] });

    // Prices cannot be provided until both commit and reveal for the current round have finished.
    assert.isFalse(await voting.methods.hasPrice(identifier1, time1).call({ from: registeredContract }));
    assert.isFalse(await voting.methods.hasPrice(identifier2, time2).call({ from: registeredContract }));
    assert(await didContractThrow(voting.methods.getPrice(identifier1, time1).send({ from: registeredContract })));
    assert(await didContractThrow(voting.methods.getPrice(identifier2, time2).send({ from: registeredContract })));

    // Move past the voting round.
    await moveToNextRound(voting, accounts[0]);

    // Note: all voting results are currently hardcoded to 1.
    assert.isTrue(await voting.methods.hasPrice(identifier1, time1).call({ from: registeredContract }));
    assert.isTrue(await voting.methods.hasPrice(identifier2, time2).call({ from: registeredContract }));
    assert.equal(
      (await voting.methods.getPrice(identifier1, time1).call({ from: registeredContract })).toString(),
      price1.toString()
    );
    assert.equal(
      (await voting.methods.getPrice(identifier2, time2).call({ from: registeredContract })).toString(),
      price2.toString()
    );
  });

  it("Future price requests disallowed", async function () {
    await moveToNextRound(voting, accounts[0]);

    const startingTime = toBN(await voting.methods.getCurrentTime().call());
    const identifier = padRight(utf8ToHex("future-request"), 64);

    // Make the Oracle support this identifier.
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });

    // Time 1 is in the future and should fail.
    const timeFail = startingTime.addn(1).toString();

    // Time 2 is in the past and should succeed.
    const timeSucceed = startingTime.subn(1).toString();

    assert(
      await didContractThrow(voting.methods.requestPrice(identifier, timeFail).send({ from: registeredContract }))
    );
    await voting.methods.requestPrice(identifier, timeSucceed).send({ from: registeredContract });

    // Finalize this vote.
    await moveToNextRound(voting, accounts[0]);
    const roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    const price = getRandomSignedInt();
    const salt = getRandomSignedInt();
    const hash = computeVoteHash({
      price: price,
      salt: salt,
      account: account1,
      time: timeSucceed,
      roundId,
      identifier,
    });
    await voting.methods.commitVote(identifier, timeSucceed, hash).send({ from: accounts[0] });

    // Move to reveal phase and reveal vote.
    await moveToNextPhase(voting, accounts[0]);

    await voting.methods.revealVote(identifier, timeSucceed, price, salt).send({ from: accounts[0] });
  });

  it("Retrieval timing", async function () {
    await moveToNextRound(voting, accounts[0]);

    const identifier = padRight(utf8ToHex("retrieval-timing"), 64);
    const time = "1000";

    // Make the Oracle support this identifier.
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });

    // Two stage call is required to get the expected return value from the second call.
    // The expected resolution time should be the end of the *next* round.
    await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });

    // Cannot get the price before the voting round begins.
    assert(await didContractThrow(voting.methods.getPrice(identifier, time).send({ from: registeredContract })));

    await moveToNextRound(voting, accounts[0]);
    const roundId = (await voting.methods.getCurrentRoundId().call()).toString();

    // Cannot get the price while the voting is ongoing.
    assert(await didContractThrow(voting.methods.getPrice(identifier, time).send({ from: registeredContract })));

    // Commit vote.
    const price = getRandomSignedInt();
    const salt = getRandomSignedInt();
    const hash = computeVoteHash({ price, salt, account: account1, time, roundId, identifier });
    await voting.methods.commitVote(identifier, time, hash).send({ from: accounts[0] });

    // Move to reveal phase and reveal vote.
    await moveToNextPhase(voting, accounts[0]);

    await voting.methods.revealVote(identifier, time, price, salt).send({ from: accounts[0] });

    // Cannot get the price during the reveal phase.
    assert(await didContractThrow(voting.methods.getPrice(identifier, time).send({ from: registeredContract })));

    await moveToNextRound(voting, accounts[0]);

    // After the voting round is over, the price should be retrievable.
    assert.equal(
      (await voting.methods.getPrice(identifier, time).call({ from: registeredContract })).toString(),
      price.toString()
    );
  });

  it("Pending Requests", async function () {
    await moveToNextRound(voting, accounts[0]);

    const identifier1 = padRight(utf8ToHex("pending-requests1"), 64);
    const time1 = "1000";
    const identifier2 = padRight(utf8ToHex("pending-requests2"), 64);
    const time2 = "1001";

    // Make the Oracle support these identifiers.
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier1).send({ from: accounts[0] });
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier2).send({ from: accounts[0] });

    // Pending requests should be empty for this new round.
    assert.equal((await voting.methods.getPendingRequests().call()).length, 0);

    // Two stage call is required to get the expected return value from the second call.
    // The expected resolution time should be the end of the *next* round.
    await voting.methods.requestPrice(identifier1, time1).send({ from: registeredContract });

    // Pending requests should be empty before the voting round begins.
    assert.equal((await voting.methods.getPendingRequests().call()).length, 0);

    // Pending requests should be have a single entry now that voting has started.
    await moveToNextRound(voting, accounts[0]);
    assert.equal((await voting.methods.getPendingRequests().call()).length, 1);

    // Add a new request during the voting round.
    await voting.methods.requestPrice(identifier2, time2).send({ from: registeredContract });

    // Pending requests should still be 1 because this request should not be voted on until next round.
    assert.equal((await voting.methods.getPendingRequests().call()).length, 1);

    // Move to next round and roll the first request over.
    await moveToNextRound(voting, accounts[0]);
    const roundId = (await voting.methods.getCurrentRoundId().call()).toString();

    // Pending requests should be 2 because one vote was rolled over and the second was dispatched after the previous
    // voting round started.
    assert.equal((await voting.methods.getPendingRequests().call()).length, 2);

    // Commit votes.
    const price1 = getRandomSignedInt();
    const salt1 = getRandomSignedInt();
    const hash1 = computeVoteHash({
      price: price1,
      salt: salt1,
      account: account1,
      time: time1,
      roundId,
      identifier: identifier1,
    });
    await voting.methods.commitVote(identifier1, time1, hash1).send({ from: accounts[0] });

    const price2 = getRandomSignedInt();
    const salt2 = getRandomSignedInt();
    const hash2 = computeVoteHash({
      price: price2,
      salt: salt2,
      account: account1,
      time: time2,
      roundId,
      identifier: identifier2,
    });
    await voting.methods.commitVote(identifier2, time2, hash2).send({ from: accounts[0] });

    // Pending requests should still have a single entry in the reveal phase.
    await moveToNextPhase(voting, accounts[0]);
    assert.equal((await voting.methods.getPendingRequests().call()).length, 2);

    // Reveal vote.
    await voting.methods.revealVote(identifier1, time1, price1, salt1).send({ from: accounts[0] });
    await voting.methods.revealVote(identifier2, time2, price2, salt2).send({ from: accounts[0] });

    // Pending requests should be empty after the voting round ends and the price is resolved.
    await moveToNextRound(voting, accounts[0]);
    assert.equal((await voting.methods.getPendingRequests().call()).length, 0);
  });

  it("Supported identifiers", async function () {
    const supported = padRight(utf8ToHex("supported"), 64);

    // No identifiers are originally suppported.
    assert.isFalse(await supportedIdentifiers.methods.isIdentifierSupported(supported).call());

    // Verify that supported identifiers can be added.
    await supportedIdentifiers.methods.addSupportedIdentifier(supported).send({ from: accounts[0] });
    assert.isTrue(await supportedIdentifiers.methods.isIdentifierSupported(supported).call());

    // Verify that supported identifiers can be removed.
    await supportedIdentifiers.methods.removeSupportedIdentifier(supported).send({ from: accounts[0] });
    assert.isFalse(await supportedIdentifiers.methods.isIdentifierSupported(supported).call());

    // Can't request prices for unsupported identifiers.
    assert(await didContractThrow(voting.methods.requestPrice(supported, "0").send({ from: registeredContract })));
  });

  it("Simple vote resolution", async function () {
    const identifier = padRight(utf8ToHex("simple-vote"), 64);
    const time = "1000";

    // Make the Oracle support this identifier.
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });

    // Request a price and move to the next round where that will be voted on.
    await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });

    const price = 123;
    const salt = getRandomSignedInt();
    const invalidHash = computeVoteHash({
      price,
      salt,
      account: account1,
      time,
      roundId: (await voting.methods.getCurrentRoundId().call()).toString(),
      identifier,
    });
    // Can't commit without advancing the round forward.
    assert(
      await didContractThrow(voting.methods.commitVote(identifier, time, invalidHash).send({ from: accounts[0] }))
    );

    await moveToNextRound(voting, accounts[0]);
    const roundId = (await voting.methods.getCurrentRoundId().call()).toString();

    // Commit vote.
    const hash = computeVoteHash({ price, salt, account: account1, time, roundId, identifier });
    await voting.methods.commitVote(identifier, time, hash).send({ from: accounts[0] });

    // Reveal the vote.
    await moveToNextPhase(voting, accounts[0]);

    await voting.methods.revealVote(identifier, time, price, salt).send({ from: accounts[0] });

    // Should resolve to the selected price since there was only one voter (100% for the mode) and the voter had enough
    // tokens to exceed the GAT.
    await moveToNextRound(voting, accounts[0]);
    assert.equal(
      (await voting.methods.getPrice(identifier, time).call({ from: registeredContract })).toString(),
      price.toString()
    );
  });

  it("Equally split vote", async function () {
    const identifier = padRight(utf8ToHex("equal-split"), 64);
    const time = "1000";

    // Make the Oracle support this identifier.
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });

    // Request a price and move to the next round where that will be voted on.
    await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });
    await moveToNextRound(voting, accounts[0]);
    let roundId = (await voting.methods.getCurrentRoundId().call()).toString();

    // Commit votes.
    const price1 = 123;
    const salt1 = getRandomSignedInt();
    let hash1 = computeVoteHash({ price: price1, salt: salt1, account: account1, time, roundId, identifier });
    await voting.methods.commitVote(identifier, time, hash1).send({ from: account1 });

    const price2 = 456;
    const salt2 = getRandomSignedInt();
    const hash2 = computeVoteHash({ price: price2, salt: salt2, account: account2, time, roundId, identifier });
    await voting.methods.commitVote(identifier, time, hash2).send({ from: account2 });

    // Reveal the votes.
    await moveToNextPhase(voting, accounts[0]);

    await voting.methods.revealVote(identifier, time, price1, salt1).send({ from: account1 });
    await voting.methods.revealVote(identifier, time, price2, salt2).send({ from: account2 });

    // Should not have the price since the vote was equally split.
    await moveToNextRound(voting, accounts[0]);
    roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    assert.isFalse(await voting.methods.hasPrice(identifier, time).call({ from: registeredContract }));

    // Cleanup: resolve the vote this round.
    hash1 = computeVoteHash({ price: price1, salt: salt1, account: account1, time, roundId, identifier });
    await voting.methods.commitVote(identifier, time, hash1).send({ from: account1 });
    await moveToNextPhase(voting, accounts[0]);

    await voting.methods.revealVote(identifier, time, price1, salt1).send({ from: account1 });
  });

  it("Two thirds majority", async function () {
    const identifier = padRight(utf8ToHex("two-thirds"), 64);
    const time = "1000";

    // Make the Oracle support this identifier.
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });

    // Request a price and move to the next round where that will be voted on.
    await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });
    await moveToNextRound(voting, accounts[0]);
    const roundId = (await voting.methods.getCurrentRoundId().call()).toString();

    // Commit votes.
    const losingPrice = 123;
    const salt1 = getRandomSignedInt();
    const hash1 = computeVoteHash({ price: losingPrice, salt: salt1, account: account1, time, roundId, identifier });
    await voting.methods.commitVote(identifier, time, hash1).send({ from: account1 });

    // Both account 2 and 3 vote for 456.
    const winningPrice = 456;

    const salt2 = getRandomSignedInt();
    const hash2 = computeVoteHash({ price: winningPrice, salt: salt2, account: account2, time, roundId, identifier });
    await voting.methods.commitVote(identifier, time, hash2).send({ from: account2 });

    const salt3 = getRandomSignedInt();
    const hash3 = computeVoteHash({ price: winningPrice, salt: salt3, account: account3, time, roundId, identifier });
    await voting.methods.commitVote(identifier, time, hash3).send({ from: account3 });

    // Reveal the votes.
    await moveToNextPhase(voting, accounts[0]);

    await voting.methods.revealVote(identifier, time, losingPrice, salt1).send({ from: account1 });
    await voting.methods.revealVote(identifier, time, winningPrice, salt2).send({ from: account2 });
    await voting.methods.revealVote(identifier, time, winningPrice, salt3).send({ from: account3 });

    // Price should resolve to the one that 2 and 3 voted for.
    await moveToNextRound(voting, accounts[0]);
    assert.equal(
      (await voting.methods.getPrice(identifier, time).call({ from: registeredContract })).toString(),
      winningPrice.toString()
    );
  });

  it("GAT", async function () {
    const identifier = padRight(utf8ToHex("gat"), 64);
    let time = "1000";

    // Make the Oracle support this identifier.
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });

    // Request a price and move to the next round where that will be voted on.
    await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });
    await moveToNextRound(voting, accounts[0]);
    let roundId = (await voting.methods.getCurrentRoundId().call()).toString();

    // Commit vote.
    const price = 123;
    const salt = getRandomSignedInt();
    let hash1 = computeVoteHash({ price, salt, account: account1, time, roundId, identifier });
    await voting.methods.commitVote(identifier, time, hash1).send({ from: account1 });
    let hash4 = computeVoteHash({ price, salt, account: account4, time, roundId, identifier });
    await voting.methods.commitVote(identifier, time, hash4).send({ from: account4 });

    // Reveal the vote.
    await moveToNextPhase(voting, accounts[0]);

    await voting.methods.revealVote(identifier, time, price, salt).send({ from: account4 });

    // Since the GAT was not hit, the price should not resolve.
    await moveToNextRound(voting, accounts[0]);
    assert.isFalse(await voting.methods.hasPrice(identifier, time).call({ from: registeredContract }));

    // Setting GAT should revert if larger than total supply.
    assert(await didContractThrow(voting.methods.setGat(toWei("110000000").toString()).send({ from: accounts[0] })));

    // With a smaller GAT value of 3%, account4 can pass the vote on their own with 4% of all tokens.
    await setNewGat(web3.utils.toWei("3000000", "ether"));

    // Create new vote hashes with the new round ID and commit votes.
    roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    hash4 = computeVoteHash({ price, salt, account: account4, time, roundId, identifier });
    await voting.methods.commitVote(identifier, time, hash4).send({ from: account4 });

    // Reveal votes.
    await moveToNextPhase(voting, accounts[0]);
    await voting.methods.revealVote(identifier, time, price, salt).send({ from: account4 });
    await moveToNextRound(voting, accounts[0]);
    assert.equal(
      (await voting.methods.getPrice(identifier, time).call({ from: registeredContract })).toString(),
      price.toString()
    );
    // Set GAT back to 5% and test a larger vote. With more votes the GAT should be hit
    // and the price should resolve.
    await setNewGat(web3.utils.toWei("5000000", "ether"));

    // As the previous request has been filled, we need to progress time such that we
    // can vote on the same identifier and request a new price to vote on.
    time += 10;

    await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });
    await moveToNextRound(voting, accounts[0]);

    // Commit votes.
    roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    hash4 = computeVoteHash({ price, salt, account: account4, time, roundId, identifier });
    hash1 = computeVoteHash({ price, salt, account: account1, time, roundId, identifier });
    await voting.methods.commitVote(identifier, time, hash4).send({ from: account4 });
    await voting.methods.commitVote(identifier, time, hash1).send({ from: account1 });

    // Reveal votes.
    await moveToNextPhase(voting, accounts[0]);

    await voting.methods.revealVote(identifier, time, price, salt).send({ from: account4 });
    await voting.methods.revealVote(identifier, time, price, salt).send({ from: account1 });

    await moveToNextRound(voting, accounts[0]);
    assert.equal(
      (await voting.methods.getPrice(identifier, time).call({ from: registeredContract })).toString(),
      price.toString()
    );
  });

  it("Only registered contracts", async function () {
    const identifier = padRight(utf8ToHex("only-registered"), 64);
    const time = "1000";

    // Make the Oracle support this identifier.
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });

    // Unregistered contracts can't request prices.
    assert(await didContractThrow(voting.methods.requestPrice(identifier, time).send({ from: unregisteredContract })));

    // Request the price and resolve the price.
    voting.methods.requestPrice(identifier, time).send({ from: registeredContract });
    await moveToNextRound(voting, accounts[0]);
    const roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    const winningPrice = 123;
    const salt = getRandomSignedInt();
    const hash = computeVoteHash({ price: winningPrice, salt, account: account1, time, roundId, identifier });
    await voting.methods.commitVote(identifier, time, hash).send({ from: account1 });
    await moveToNextPhase(voting, accounts[0]);

    await voting.methods.revealVote(identifier, time, winningPrice, salt).send({ from: account1 });
    await moveToNextRound(voting, accounts[0]);

    // Sanity check that registered contracts can retrieve prices.
    assert.isTrue(await voting.methods.hasPrice(identifier, time).call({ from: registeredContract }));
    assert.equal(await voting.methods.getPrice(identifier, time).call({ from: registeredContract }), winningPrice);

    // Unregistered contracts can't retrieve prices.
    assert(await didContractThrow(voting.methods.hasPrice(identifier, time).send({ from: unregisteredContract })));
    assert(await didContractThrow(voting.methods.getPrice(identifier, time).send({ from: unregisteredContract })));
  });

  it("Set slashing library", async function () {
    // Set the slashing library to a new address.
    const newSlashingLibrary = ZERO_ADDRESS;
    await voting.methods.setSlashingLibrary(newSlashingLibrary).send({ from: accounts[0] });

    // Only owner should be able to set the slashing library.
    assert(await didContractThrow(voting.methods.setSlashingLibrary(newSlashingLibrary).send({ from: accounts[1] })));

    // Check that the slashing library was set.
    assert.equal(await voting.methods.slashingLibrary().call({ from: accounts[0] }), newSlashingLibrary);
  });

  it("View methods", async function () {
    const identifier = padRight(utf8ToHex("view-methods"), 64);
    const time = "1000";

    // Make the Oracle support this identifier.
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });

    // Verify view methods `hasPrice`, `getPrice`, and `getPriceRequestStatuses`` for a price was that was never requested.
    assert.isFalse(await voting.methods.hasPrice(identifier, time).call({ from: registeredContract }));
    assert(await didContractThrow(voting.methods.getPrice(identifier, time).send({ from: registeredContract })));
    let statuses = await voting.methods.getPriceRequestStatuses([{ identifier, time: time }]).call();
    assert.equal(statuses[0].status.toString(), "0");
    assert.equal(statuses[0].lastVotingRound.toString(), "0");

    // Request a price and move to the next round where that will be voted on.
    await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });

    // Verify view methods `hasPrice`, `getPrice`, and `getPriceRequestStatuses` for a price scheduled for the next round.
    assert.isFalse(await voting.methods.hasPrice(identifier, time).call({ from: registeredContract }));
    assert(await didContractThrow(voting.methods.getPrice(identifier, time).send({ from: registeredContract })));
    statuses = await voting.methods.getPriceRequestStatuses([{ identifier, time: time }]).call();
    assert.equal(statuses[0].status.toString(), "3");
    assert.equal(
      statuses[0].lastVotingRound.toString(),
      toBN(await voting.methods.getCurrentRoundId().call())
        .addn(1)
        .toString()
    );

    await moveToNextRound(voting, accounts[0]);
    const roundId = (await voting.methods.getCurrentRoundId().call()).toString();

    // Verify `getPriceRequestStatuses` for a price request scheduled for this round.
    statuses = await voting.methods.getPriceRequestStatuses([{ identifier, time: time }]).call();
    assert.equal(statuses[0].status.toString(), "1");
    assert.equal(statuses[0].lastVotingRound.toString(), (await voting.methods.getCurrentRoundId().call()).toString());

    const price = 123;

    // Accounts 1 and 2 commit votes.
    const salt1 = getRandomSignedInt();
    const hash1 = computeVoteHash({ price, salt: salt1, account: account1, time, roundId, identifier });
    await voting.methods.commitVote(identifier, time, hash1).send({ from: account1 });

    const salt2 = getRandomSignedInt();
    const hash2 = computeVoteHash({ price, salt: salt2, account: account2, time, roundId, identifier });
    await voting.methods.commitVote(identifier, time, hash2).send({ from: account2 });

    await moveToNextPhase(voting, accounts[0]);

    await voting.methods.revealVote(identifier, time, price, salt1).send({ from: account1 });
    await voting.methods.revealVote(identifier, time, price, salt2).send({ from: account2 });

    await moveToNextRound(voting, accounts[0]);

    // Verify view methods `hasPrice`, `getPrice`, and `getPriceRequestStatuses` for a resolved price request.
    assert.isTrue(await voting.methods.hasPrice(identifier, time).call({ from: registeredContract }));
    assert.equal(
      (await voting.methods.getPrice(identifier, time).call({ from: registeredContract })).toString(),
      price.toString()
    );
    statuses = await voting.methods.getPriceRequestStatuses([{ identifier, time: time }]).call();
    assert.equal(statuses[0].status.toString(), "2");
    assert.equal(
      statuses[0].lastVotingRound.toString(),
      toBN(await voting.methods.getCurrentRoundId().call())
        .subn(1)
        .toString()
    );
  });

  it("Events", async function () {
    // Set the inflation rate to 100% (for ease of computation).

    const identifier = padRight(utf8ToHex("events"), 64);
    const time = "1000";

    let result = await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });

    await moveToNextRound(voting, accounts[0]);
    let currentRoundId = toBN(await voting.methods.getCurrentRoundId().call());

    // New price requests trigger events.
    result = await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });
    await assertEventEmitted(result, voting, "PriceRequestAdded", (ev) => {
      return (
        // The vote is added to the next round, so we have to add 1 to the current round id.
        ev.roundId.toString() == currentRoundId.addn(1).toString() &&
        web3.utils.hexToUtf8(ev.identifier) == web3.utils.hexToUtf8(identifier) &&
        ev.time.toString() == time.toString()
      );
    });

    await assertEventEmitted(
      await voting.methods.setGat(web3.utils.toWei("6000000", "ether")).send({ from: accounts[0] }),
      voting,
      "GatChanged",
      (ev) => {
        return ev.newGat == web3.utils.toWei("6000000", "ether");
      }
    );

    await assertEventEmitted(
      await voting.methods.setSpamDeletionProposalBond(toWei("0.1")).send({ from: accounts[0] }),
      voting,
      "SpamDeletionProposalBondChanged"
    );

    await moveToNextRound(voting, accounts[0]);
    currentRoundId = await voting.methods.getCurrentRoundId().call();

    // Repeated price requests don't trigger events.
    result = await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });
    await assertEventNotEmitted(result, voting, "PriceRequestAdded");

    // Commit vote.
    const price = 123;
    const salt = getRandomSignedInt();
    let hash4 = computeVoteHash({ price, salt, account: account4, time, roundId: currentRoundId, identifier });
    result = await voting.methods.commitVote(identifier, time, hash4).send({ from: account4 });
    await assertEventEmitted(result, voting, "VoteCommitted", (ev) => {
      return (
        ev.voter.toString() == account4 &&
        ev.roundId.toString() == currentRoundId.toString() &&
        web3.utils.hexToUtf8(ev.identifier) == web3.utils.hexToUtf8(identifier) &&
        ev.time.toString() == time
      );
    });

    await moveToNextPhase(voting, accounts[0]);

    result = await voting.methods.revealVote(identifier, time, price, salt).send({ from: account4 });
    await assertEventEmitted(result, voting, "VoteRevealed", (ev) => {
      return (
        ev.voter.toString() == account4 &&
        ev.roundId.toString() == currentRoundId.toString() &&
        web3.utils.hexToUtf8(ev.identifier) == web3.utils.hexToUtf8(identifier) &&
        ev.time.toString() == time &&
        ev.price.toString() == price.toString() &&
        ev.numTokens.toString() == toWei("4000000").toString() // the staked balance for account4.
      );
    });

    await moveToNextRound(voting, accounts[0]);
    currentRoundId = await voting.methods.getCurrentRoundId().call();
    // Since none of the whales voted, the price couldn't be resolved.

    // Now the whale and account4 vote and the vote resolves.
    const hash1 = computeVoteHash({ price, salt, account: account1, time, roundId: currentRoundId, identifier });
    const wrongPrice = 124;
    hash4 = computeVoteHash({ price: wrongPrice, salt, account: account4, time, roundId: currentRoundId, identifier });
    await voting.methods.commitVote(identifier, time, hash1).send({ from: account1 });
    result = await voting.methods.commitVote(identifier, time, hash4).send({ from: account4 });
    await moveToNextPhase(voting, accounts[0]);

    await voting.methods.revealVote(identifier, time, price, salt).send({ from: account1 });
    await voting.methods.revealVote(identifier, time, wrongPrice, salt).send({ from: account4 });
    await moveToNextRound(voting, accounts[0]);

    result = await voting.methods.updateTrackers(account1).send({ from: account1 });

    await assertEventEmitted(result, voting, "VoterSlashed", (ev) => {
      return ev.slashedTokens != "0" && ev.postActiveStake != "0" && ev.voter != "";
    });

    result = await voting.methods.setMigrated(migratedVoting).send({ from: accounts[0] });
    await assertEventEmitted(result, voting, "VotingContractMigrated", (ev) => {
      return ev.newAddress == migratedVoting;
    });

    result = await voting.methods.setSlashingLibrary(ZERO_ADDRESS).send({ from: accounts[0] });
    await assertEventEmitted(result, voting, "SlashingLibraryChanged");
  });

  it("Commit and persist the encrypted price", async function () {
    const identifier = padRight(utf8ToHex("commit-and-persist"), 64);
    const time = "1000";
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });

    await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });
    await moveToNextRound(voting, accounts[0]);
    let roundId = (await voting.methods.getCurrentRoundId().call()).toString();

    const price = getRandomSignedInt();
    const salt = getRandomSignedInt();
    const hash = computeVoteHash({ price, salt, account: account1, time, roundId, identifier });
    roundId = await voting.methods.getCurrentRoundId().call();

    const { privateKey, publicKey } = await deriveKeyPairFromSignatureTruffle(
      web3,
      getKeyGenMessage(roundId),
      account1
    );
    const vote = { price: price.toString(), salt: salt.toString() };
    const encryptedMessage = await encryptMessage(publicKey, JSON.stringify(vote));

    let result = await voting.methods
      .commitAndEmitEncryptedVote(identifier, time, hash, encryptedMessage)
      .send({ from: accounts[0] });
    await assertEventEmitted(result, voting, "EncryptedVote", (ev) => {
      return (
        ev.caller.toString() === account1 &&
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

    await moveToNextPhase(voting, accounts[0]);

    const decryptedMessage = await decryptMessage(privateKey, retrievedEncryptedMessage);
    const retrievedVote = JSON.parse(decryptedMessage);

    assert(
      await didContractThrow(
        voting.methods
          .revealVote(identifier, time, getRandomSignedInt(), getRandomSignedInt())
          .send({ from: accounts[0] })
      )
    );
    await voting.methods
      .revealVote(identifier, time, web3.utils.toBN(retrievedVote.price), web3.utils.toBN(retrievedVote.salt))
      .send({ from: accounts[0] });
  });

  it("Commit and persist the encrypted price against the same identifier/time pair multiple times", async function () {
    const identifier = padRight(utf8ToHex("commit-and-persist2"), 64);
    const time = "1000";
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });

    await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });
    await moveToNextRound(voting, accounts[0]);
    const roundId = (await voting.methods.getCurrentRoundId().call()).toString();

    const price = getRandomSignedInt();
    const salt = getRandomSignedInt();
    const hash = computeVoteHash({ price, salt, account: account1, time, roundId, identifier });

    const { publicKey } = await deriveKeyPairFromSignatureTruffle(web3, getKeyGenMessage(roundId), account1);
    const vote = { price: price.toString(), salt: salt.toString() };
    const encryptedMessage = await encryptMessage(publicKey, JSON.stringify(vote));
    await voting.methods
      .commitAndEmitEncryptedVote(identifier, time, hash, encryptedMessage)
      .send({ from: accounts[0] });

    const secondEncryptedMessage = await encryptMessage(publicKey, getRandomSignedInt());
    await voting.methods
      .commitAndEmitEncryptedVote(identifier, time, hash, secondEncryptedMessage)
      .send({ from: accounts[0] });

    const events = await voting.getPastEvents("EncryptedVote", { fromBlock: 0 });
    const secondRetrievedEncryptedMessage = events[events.length - 1].returnValues.encryptedVote;

    assert.equal(secondEncryptedMessage, secondRetrievedEncryptedMessage);
  });

  it("Batches multiple commits into one", async function () {
    const numRequests = 5;
    const requestTime = "1000";
    const priceRequests = [];

    for (let i = 0; i < numRequests; i++) {
      let identifier = padRight(utf8ToHex(`batch-request-${i}`), 64);
      priceRequests.push({
        identifier,
        time: requestTime,
        hash: web3.utils.soliditySha3(getRandomSignedInt()),
        encryptedVote: utf8ToHex(`some encrypted message ${i}`),
      });

      await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });
      await voting.methods.requestPrice(identifier, requestTime).send({ from: registeredContract });
    }

    await moveToNextRound(voting, accounts[0]);

    const data = priceRequests.map((request) => {
      return voting.methods.commitVote(request.identifier, request.time, request.hash).encodeABI();
    });

    const result = await voting.methods.multicall(data).send({ from: accounts[0] });

    await assertEventNotEmitted(result, voting, "EncryptedVote");

    // This time we commit while storing the encrypted messages
    const dataEncrypted = priceRequests.map((request) => {
      return voting.methods
        .commitAndEmitEncryptedVote(request.identifier, request.time, request.hash, request.encryptedVote)
        .encodeABI();
    });

    await voting.methods.multicall(dataEncrypted).send({ from: accounts[0] });

    for (let i = 0; i < numRequests; i++) {
      let priceRequest = priceRequests[i];
      let events = await voting.getPastEvents("EncryptedVote", {
        fromBlock: 0,
        filter: { identifier: priceRequest.identifier, time: priceRequest.time },
      });
      let retrievedEncryptedMessage = events[events.length - 1].returnValues.encryptedVote;
      assert.equal(retrievedEncryptedMessage, priceRequest.encryptedVote);
    }

    // Edit a single commit
    const modifiedPriceRequest = priceRequests[0];
    modifiedPriceRequest.hash = web3.utils.soliditySha3(getRandomSignedInt());
    modifiedPriceRequest.encryptedVote = utf8ToHex("some other encrypted message");
    await voting.methods
      .commitAndEmitEncryptedVote(
        modifiedPriceRequest.identifier,
        modifiedPriceRequest.time,
        modifiedPriceRequest.hash,
        modifiedPriceRequest.encryptedVote
      )
      .send({ from: accounts[0] });

    // Test that the encrypted messages are still correct
    for (let i = 0; i < numRequests; i++) {
      let priceRequest = priceRequests[i];
      let events = await voting.getPastEvents("EncryptedVote", {
        fromBlock: 0,
        filter: { identifier: priceRequest.identifier, time: priceRequest.time },
      });
      let retrievedEncryptedMessage = events[events.length - 1].returnValues.encryptedVote;
      assert.equal(retrievedEncryptedMessage, priceRequest.encryptedVote);
    }
  });

  it("Batch reveal multiple commits", async function () {
    const identifier = padRight(utf8ToHex("batch-reveal"), 64);
    const time1 = "1000";
    const time2 = "1001";
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });

    await voting.methods.requestPrice(identifier, time1).send({ from: registeredContract });
    await voting.methods.requestPrice(identifier, time2).send({ from: registeredContract });
    await moveToNextRound(voting, accounts[0]);
    const roundId = (await voting.methods.getCurrentRoundId().call()).toString();

    const price1 = getRandomSignedInt();
    const price2 = getRandomSignedInt();
    const salt1 = getRandomSignedInt();
    const salt2 = getRandomSignedInt();
    const hash1 = computeVoteHash({ price: price1, salt: salt1, account: account1, time: time1, roundId, identifier });
    const hash2 = computeVoteHash({ price: price2, salt: salt2, account: account1, time: time2, roundId, identifier });
    const { publicKey } = await deriveKeyPairFromSignatureTruffle(web3, getKeyGenMessage(roundId), account1);
    const vote = { price: price1.toString(), salt: salt2.toString() };
    const encryptedMessage = await encryptMessage(publicKey, JSON.stringify(vote));
    await voting.methods
      .commitAndEmitEncryptedVote(identifier, time1, hash1, encryptedMessage)
      .send({ from: accounts[0] });
    await voting.methods.commitVote(identifier, time2, hash2).send({ from: accounts[0] });

    await moveToNextPhase(voting, accounts[0]);

    const data = [
      voting.methods.revealVote(identifier, time1, price1, salt1).encodeABI(),
      voting.methods.revealVote(identifier, time2, price2, salt2).encodeABI(),
    ];

    const result = await voting.methods.multicall(data).send({ from: accounts[0] });

    await assertEventEmitted(result, voting, "VoteRevealed", (ev) => {
      return (
        ev.voter.toString() == account1 &&
        ev.roundId.toString() == roundId.toString() &&
        web3.utils.hexToUtf8(ev.identifier) == web3.utils.hexToUtf8(identifier) &&
        ev.time.toString() == time1 &&
        ev.price.toString() == price1.toString()
      );
    });
    await assertEventEmitted(result, voting, "VoteRevealed", (ev) => {
      return (
        ev.voter.toString() == account1 &&
        ev.roundId.toString() == roundId.toString() &&
        web3.utils.hexToUtf8(ev.identifier) == web3.utils.hexToUtf8(identifier) &&
        ev.time.toString() == time2 &&
        ev.price.toString() == price2.toString()
      );
    });
  });

  it("Migration", async function () {
    const identifier = padRight(utf8ToHex("migration"), 64);
    const time1 = "1000";
    const time2 = "2000";
    // Deploy our own voting because this test case will migrate it.
    const newVoting = await VotingV2.new(
      "640000000000000000", // emission rate
      toWei("10000"), // spamDeletionProposalBond
      60 * 60 * 24 * 30, // unstakeCooldown
      "86400", // phase length
      7200, // minRollToNextRoundLength
      web3.utils.toWei("5000000"), // GAT 5MM
      votingToken.options.address, // voting token
      (await Finder.deployed()).options.address, // finder
      (await Timer.deployed()).options.address, // timer
      (await SlashingLibrary.deployed()).options.address // slashing library
    ).send({ from: accounts[0] });

    // unstake and restake in the new voting contract
    await voting.methods.setUnstakeCoolDown(0).send({ from: account1 });
    await voting.methods.requestUnstake(toWei("32000000")).send({ from: account1 });
    await voting.methods.requestUnstake(toWei("32000000")).send({ from: account2 });
    await voting.methods.requestUnstake(toWei("32000000")).send({ from: account3 });
    await voting.methods.requestUnstake(toWei("4000000")).send({ from: account4 });

    await voting.methods.executeUnstake().send({ from: account1 });
    await voting.methods.executeUnstake().send({ from: account2 });
    await voting.methods.executeUnstake().send({ from: account3 });
    await voting.methods.executeUnstake().send({ from: account4 });

    // Restake in the new voting contract.
    await votingToken.methods.approve(newVoting.options.address, toWei("32000000")).send({ from: account1 });
    await newVoting.methods.stake(toWei("32000000")).send({ from: account1 });
    await votingToken.methods.approve(newVoting.options.address, toWei("32000000")).send({ from: account2 });
    await newVoting.methods.stake(toWei("32000000")).send({ from: account2 });
    await votingToken.methods.approve(newVoting.options.address, toWei("32000000")).send({ from: account3 });
    await newVoting.methods.stake(toWei("32000000")).send({ from: account3 });
    await votingToken.methods.approve(newVoting.options.address, toWei("4000000")).send({ from: account4 });
    await newVoting.methods.stake(toWei("4000000")).send({ from: account4 });

    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });

    await newVoting.methods.requestPrice(identifier, time1).send({ from: registeredContract });
    await newVoting.methods.requestPrice(identifier, time2).send({ from: registeredContract });
    await moveToNextRound(newVoting, accounts[0]);
    const roundId = (await newVoting.methods.getCurrentRoundId().call()).toString();

    const price = 123;
    const salt = getRandomSignedInt();
    const hash = computeVoteHash({ price, salt, account: account1, time: time1, roundId, identifier });
    await newVoting.methods.commitVote(identifier, time1, hash).send({ from: account1 });
    await moveToNextPhase(newVoting, accounts[0]);
    // await newVoting.methods.snapshotCurrentRound(signature).send({ from: accounts[0] });
    await newVoting.methods.revealVote(identifier, time1, price, salt).send({ from: account1 });
    await moveToNextRound(newVoting, accounts[0]);

    // New newVoting can only call methods after the migration, not before.
    assert(await newVoting.methods.hasPrice(identifier, time1).call({ from: registeredContract }));
    assert(await didContractThrow(newVoting.methods.hasPrice(identifier, time1).send({ from: migratedVoting })));

    // Need permissions to migrate.
    assert(await didContractThrow(newVoting.methods.setMigrated(migratedVoting).send({ from: migratedVoting })));
    await newVoting.methods.setMigrated(migratedVoting).send({ from: accounts[0] });

    // Now only new newVoting can call methods.
    assert(await newVoting.methods.hasPrice(identifier, time1).call({ from: migratedVoting }));
    assert(await didContractThrow(newVoting.methods.hasPrice(identifier, time1).send({ from: registeredContract })));
    assert(await didContractThrow(newVoting.methods.commitVote(identifier, time2, hash).send({ from: account1 })));
  });

  it("pendingPriceRequests array length", async function () {
    // Use a test derived contract to expose the internal array (and its length).
    const votingTest = await VotingInterfaceTesting.at(
      (
        await VotingV2Test.new(
          "42069", // emissionRate
          toWei("10000"), // spamDeletionProposalBond
          60 * 60 * 24 * 7, // Unstake cooldown
          86400, // PhaseLength
          7200, // minRollToNextRoundLength
          toWei("5000000"), // GAT 5MM
          votingToken.options.address, // voting token
          (await Finder.deployed()).options.address, // finder
          (await Timer.deployed()).options.address, // timer
          (await SlashingLibrary.deployed()).options.address // slashing library
        ).send({ from: accounts[0] })
      ).options.address
    );

    await voting.methods.setUnstakeCoolDown(0).send({ from: account1 });
    await voting.methods.requestUnstake(toWei("32000000")).send({ from: account1 });
    await voting.methods.executeUnstake().send({ from: account1 });
    await votingToken.methods.approve(votingTest.options.address, toWei("32000000")).send({ from: account1 });
    await VotingV2.at(votingTest.options.address).methods.stake(toWei("32000000")).send({ from: account1 });

    await moveToNextRound(votingTest, accounts[0]);

    const identifier = padRight(utf8ToHex("array-size"), 64);
    const time = "1000";
    const startingLength = (await votingTest.methods.getPendingPriceRequestsArray().call()).length;

    // pendingPriceRequests should start with no elements.
    assert.equal(startingLength, 0);

    // Make the Oracle support the identifier.
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: account1 });

    // Request a price.
    await votingTest.methods.requestPrice(identifier, time).send({ from: registeredContract });

    // There should be one element in the array after the fist price request.
    assert.equal((await votingTest.methods.getPendingPriceRequestsArray().call()).length, 1);

    // Move to voting round.
    await moveToNextRound(votingTest, accounts[0]);
    const votingRound = await votingTest.methods.getCurrentRoundId().call();

    // Commit vote.
    const price = getRandomSignedInt();
    const salt = getRandomSignedInt();
    const hash = computeVoteHash({ price, salt, account: account1, time, roundId: votingRound.toString(), identifier });
    await votingTest.methods.commitVote(identifier, time, hash).send({ from: account1 });

    // Reveal phase.
    await moveToNextPhase(votingTest, accounts[0]);

    // Reveal vote.
    await votingTest.methods.revealVote(identifier, time, price, salt).send({ from: account1 });

    // Pending requests should be empty after the voting round ends and the price is resolved.
    await moveToNextRound(votingTest, accounts[0]);

    // Updating the account tracker should remove the request from the pending array as it is now resolved.
    await VotingV2.at(votingTest.options.address).methods.updateTrackers(account1).send({ from: account1 });

    // After updating the account trackers, the length should be decreased back to 0 since the element added in this test is now deleted.
    assert.equal((await votingTest.methods.getPendingPriceRequestsArray().call()).length, 0);
  });
  it("Votes can correctly handle arbitrary ancillary data", async function () {
    const identifier1 = padRight(utf8ToHex("request-retrieval"), 64);
    const time1 = "1000";
    const ancillaryData1 = utf8ToHex("some-random-extra-data"); // ancillary data should be able to store any extra dat

    // Note for the second request we set the identifier and time to the same as the first to show that by simply having
    // a different ancillary data we can have multiple simultaneous requests that the DVM can differentiate.
    const identifier2 = identifier1;
    const time2 = time1;
    const ancillaryData2 = utf8ToHex(`callerAddress:${account4}`);

    // Make the Oracle support these two identifiers.
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier1).send({ from: accounts[0] });
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier2).send({ from: accounts[0] });

    // Instantiate a voting interface that supports ancillary data.
    voting = await VotingAncillaryInterfaceTesting.at(voting.options.address);

    // Store the number of price requests to verify the right number are enqued.
    const priceRequestLengthBefore = (await voting.methods.getPendingRequests().call()).length;

    // Requests should not be added to the current voting round.
    await voting.methods.requestPrice(identifier1, time1, ancillaryData1).send({ from: registeredContract });
    await voting.methods.requestPrice(identifier2, time2, ancillaryData2).send({ from: registeredContract });

    // Since the round for these requests has not started, the price retrieval should fail.
    assert.isFalse(
      await voting.methods.hasPrice(identifier1, time1, ancillaryData1).call({ from: registeredContract })
    );
    assert.isFalse(
      await voting.methods.hasPrice(identifier2, time2, ancillaryData2).call({ from: registeredContract })
    );
    assert(
      await didContractThrow(
        voting.methods.getPrice(identifier1, time1, ancillaryData1).send({ from: registeredContract })
      )
    );
    assert(
      await didContractThrow(
        voting.methods.getPrice(identifier2, time2, ancillaryData2).send({ from: registeredContract })
      )
    );

    // Move to the voting round.
    await moveToNextRound(voting, accounts[0]);
    const roundId = (await voting.methods.getCurrentRoundId().call()).toString();

    // Ancillary data should be correctly preserved and accessible to voters.
    const priceRequests = await voting.methods.getPendingRequests().call();

    assert.equal(priceRequests.length - priceRequestLengthBefore, 2);
    assert.equal(
      web3.utils.hexToUtf8(priceRequests[priceRequestLengthBefore].identifier),
      web3.utils.hexToUtf8(identifier1)
    );
    assert.equal(priceRequests[priceRequestLengthBefore].time, time1);
    assert.equal(
      web3.utils.hexToUtf8(priceRequests[priceRequestLengthBefore].ancillaryData),
      web3.utils.hexToUtf8(ancillaryData1)
    );

    assert.equal(
      web3.utils.hexToUtf8(priceRequests[priceRequestLengthBefore + 1].identifier),
      web3.utils.hexToUtf8(identifier2)
    );
    assert.equal(priceRequests[priceRequestLengthBefore + 1].time, time2);
    assert.equal(
      web3.utils.hexToUtf8(priceRequests[priceRequestLengthBefore + 1].ancillaryData),
      web3.utils.hexToUtf8(ancillaryData2)
    );

    // Commit vote 1.
    const price1 = getRandomSignedInt();
    const salt1 = getRandomSignedInt();
    const hash1 = computeVoteHashAncillary({
      price: price1,
      salt: salt1,
      account: account1,
      time: time1,
      ancillaryData: ancillaryData1,
      roundId,
      identifier: identifier1,
    });

    await voting.methods.commitVote(identifier1, time1, ancillaryData1, hash1).send({ from: accounts[0] });

    // Commit vote 2.
    const price2 = getRandomSignedInt();
    const salt2 = getRandomSignedInt();
    const hash2 = computeVoteHashAncillary({
      price: price2,
      salt: salt2,
      account: account1,
      time: time2,
      ancillaryData: ancillaryData2,
      roundId,
      identifier: identifier2,
    });
    await voting.methods.commitVote(identifier2, time2, ancillaryData2, hash2).send({ from: accounts[0] });

    // If the voting period is ongoing, prices cannot be returned since they are not finalized.
    assert.isFalse(
      await voting.methods.hasPrice(identifier1, time1, ancillaryData1).call({ from: registeredContract })
    );
    assert.isFalse(
      await voting.methods.hasPrice(identifier2, time2, ancillaryData2).call({ from: registeredContract })
    );
    assert(
      await didContractThrow(
        voting.methods.getPrice(identifier1, time1, ancillaryData1).send({ from: registeredContract })
      )
    );
    assert(
      await didContractThrow(
        voting.methods.getPrice(identifier2, time2, ancillaryData2).send({ from: registeredContract })
      )
    );

    // Move to the reveal phase of the voting period.
    await moveToNextPhase(voting, accounts[0]);

    // Reveal both votes.
    await voting.methods.revealVote(identifier1, time1, price1, ancillaryData1, salt1).send({ from: accounts[0] });
    await voting.methods.revealVote(identifier2, time2, price2, ancillaryData2, salt2).send({ from: accounts[0] });

    // Prices cannot be provided until both commit and reveal for the current round have finished.
    assert.isFalse(
      await voting.methods.hasPrice(identifier1, time1, ancillaryData1).call({ from: registeredContract })
    );
    assert.isFalse(
      await voting.methods.hasPrice(identifier2, time2, ancillaryData2).call({ from: registeredContract })
    );
    assert(
      await didContractThrow(
        voting.methods.getPrice(identifier1, time1, ancillaryData1).send({ from: registeredContract })
      )
    );
    assert(
      await didContractThrow(
        voting.methods.getPrice(identifier2, time2, ancillaryData2).send({ from: registeredContract })
      )
    );

    // Move past the voting round.
    await moveToNextRound(voting, accounts[0]);

    // Note: all voting results are currently hardcoded to 1.
    assert.isTrue(await voting.methods.hasPrice(identifier1, time1, ancillaryData1).call({ from: registeredContract }));
    assert.isTrue(await voting.methods.hasPrice(identifier2, time2, ancillaryData2).call({ from: registeredContract }));
    assert.equal(
      (await voting.methods.getPrice(identifier1, time1, ancillaryData1).call({ from: registeredContract })).toString(),
      price1.toString()
    );
    assert.equal(
      (await voting.methods.getPrice(identifier2, time2, ancillaryData2).call({ from: registeredContract })).toString(),
      price2.toString()
    );
  });
  it("Stress testing the size of ancillary data", async function () {
    let identifier = padRight(utf8ToHex("stress-test"), 64);
    let time = "1000";
    const DATA_LIMIT_BYTES = 8192;
    let ancillaryData = web3.utils.randomHex(DATA_LIMIT_BYTES);

    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });

    // Instantiate a voting interface that supports ancillary data.
    voting = await VotingAncillaryInterfaceTesting.at(voting.options.address);

    // Store the number of price requests to verify the right number are enqued.
    const priceRequestLengthBefore = (await voting.methods.getPendingRequests().call()).length;

    // Requests should not be added to the current voting round.
    await voting.methods.requestPrice(identifier, time, ancillaryData).send({ from: registeredContract });

    // Ancillary data length must not be more than the limit.
    assert(
      await didContractThrow(
        voting.methods
          .requestPrice(identifier, time, web3.utils.randomHex(DATA_LIMIT_BYTES + 1))
          .send({ from: accounts[0] })
      )
    );

    // Since the round for these requests has not started, the price retrieval should fail.
    assert.isFalse(await voting.methods.hasPrice(identifier, time, ancillaryData).call({ from: registeredContract }));
    assert(
      await didContractThrow(
        voting.methods.getPrice(identifier, time, ancillaryData).send({ from: registeredContract })
      )
    );

    // Move to the voting round.
    await moveToNextRound(voting, accounts[0]);
    const roundId = (await voting.methods.getCurrentRoundId().call()).toString();

    // Ancillary data should be correctly preserved and accessible to voters.
    const priceRequests = await voting.methods.getPendingRequests().call();
    assert.equal(priceRequests.length - priceRequestLengthBefore, 1);
    assert.equal(
      web3.utils.hexToUtf8(priceRequests[priceRequestLengthBefore].identifier),
      web3.utils.hexToUtf8(identifier)
    );
    assert.equal(priceRequests[priceRequestLengthBefore].time, time);
    assert.equal(priceRequests[priceRequestLengthBefore].ancillaryData, ancillaryData);

    // Commit vote.
    const price = getRandomSignedInt();
    const salt = getRandomSignedInt();
    const hash = computeVoteHashAncillary({ price, salt, account: account1, time, ancillaryData, roundId, identifier });

    await voting.methods.commitVote(identifier, time, ancillaryData, hash).send({ from: accounts[0] });

    // If the voting period is ongoing, prices cannot be returned since they are not finalized.
    assert.isFalse(await voting.methods.hasPrice(identifier, time, ancillaryData).call({ from: registeredContract }));
    assert(
      await didContractThrow(
        voting.methods.getPrice(identifier, time, ancillaryData).send({ from: registeredContract })
      )
    );

    // Move to the reveal phase of the voting period.
    await moveToNextPhase(voting, accounts[0]);

    // Reveal votes.
    await voting.methods.revealVote(identifier, time, price, ancillaryData, salt).send({ from: accounts[0] });

    // Prices cannot be provided until both commit and reveal for the current round have finished.
    assert.isFalse(await voting.methods.hasPrice(identifier, time, ancillaryData).call({ from: registeredContract }));
    assert(
      await didContractThrow(
        voting.methods.getPrice(identifier, time, ancillaryData).send({ from: registeredContract })
      )
    );

    // Move past the voting round.
    await moveToNextRound(voting, accounts[0]);

    // Note: all voting results are currently hardcoded to 1.
    assert.isTrue(await voting.methods.hasPrice(identifier, time, ancillaryData).call({ from: registeredContract }));
    assert.equal(
      (await voting.methods.getPrice(identifier, time, ancillaryData).call({ from: registeredContract })).toString(),
      price.toString()
    );
  });

  // TODO: we are going to deprecate the backwards looking logic. this should be tested and updated.
  it("Mixing ancillary and no ancillary price requests is compatible", async function () {
    // This test shows that the current DVM implementation is still compatible, when mixed with different kinds of requests.
    // Also, this test shows that the overloading syntax operates as expected.

    // Price request 1 that includes ancillary data.
    const identifier1 = padRight(utf8ToHex("request-retrieval1b"), 64);
    const time1 = "1000";
    const ancillaryData1 = utf8ToHex("some-random-extra-data"); // ancillary data should be able to store any extra dat
    // Price request 2 that will have no additional data added.
    const identifier2 = padRight(utf8ToHex("request-retrieval2b"), 64);
    const time2 = "2000";

    // Make the Oracle support these two identifiers.
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier1).send({ from: accounts[0] });
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier2).send({ from: accounts[0] });

    // Instantiate a voting interface that supports ancillary data.
    voting = await VotingV2.at(voting.options.address);

    // Store the number of price requests to verify the right number are enqued.
    const priceRequestLengthBefore = (await voting.methods.getPendingRequests().call()).length;

    // Requests should not be added to the current voting round.
    await voting.methods["requestPrice(bytes32,uint256,bytes)"](identifier1, time1, ancillaryData1).send({
      from: registeredContract,
    });
    await voting.methods["requestPrice(bytes32,uint256)"](identifier2, time2).send({ from: registeredContract });

    // Since the round for these requests has not started, the price retrieval should fail.
    assert.isFalse(
      await voting.methods["hasPrice(bytes32,uint256,bytes)"](identifier1, time1, ancillaryData1).call({
        from: registeredContract,
      })
    );
    assert.isFalse(
      await voting.methods["hasPrice(bytes32,uint256)"](identifier2, time2).call({ from: registeredContract })
    );
    assert(
      await didContractThrow(
        voting.methods["getPrice(bytes32,uint256,bytes)"](identifier1, time1, ancillaryData1).send({
          from: registeredContract,
        })
      )
    );
    assert(
      await didContractThrow(
        voting.methods["getPrice(bytes32,uint256)"](identifier2, time2).send({ from: registeredContract })
      )
    );

    // Move to the voting round.
    await moveToNextRound(voting, accounts[0]);
    const roundId = (await voting.methods.getCurrentRoundId().call()).toString();

    // Ancillary data should be correctly preserved and accessible to voters.
    const priceRequests = await voting.methods.getPendingRequests().call();

    assert.equal(priceRequests.length, priceRequestLengthBefore + 2);
    assert.equal(
      web3.utils.hexToUtf8(priceRequests[priceRequestLengthBefore].identifier),
      web3.utils.hexToUtf8(identifier1)
    );
    assert.equal(priceRequests[priceRequestLengthBefore].time, time1);
    assert.equal(
      web3.utils.hexToUtf8(priceRequests[priceRequestLengthBefore].ancillaryData),
      web3.utils.hexToUtf8(ancillaryData1)
    );

    assert.equal(
      web3.utils.hexToUtf8(priceRequests[priceRequestLengthBefore + 1].identifier),
      web3.utils.hexToUtf8(identifier2)
    );
    assert.equal(priceRequests[priceRequestLengthBefore + 1].time, time2);
    // assert.equal(web3.utils.hexToUtf8(priceRequests[1].ancillaryData), web3.utils.hexToUtf("")));

    // Commit vote 1.
    const price1 = getRandomSignedInt();
    const salt1 = getRandomSignedInt();
    const hash1 = computeVoteHashAncillary({
      price: price1,
      salt: salt1,
      account: account1,
      time: time1,
      ancillaryData: ancillaryData1,
      roundId,
      identifier: identifier1,
    });

    await voting.methods["commitVote(bytes32,uint256,bytes,bytes32)"](identifier1, time1, ancillaryData1, hash1).send({
      from: accounts[0],
    });

    // Commit vote 2.
    const price2 = getRandomSignedInt();
    const salt2 = getRandomSignedInt();
    const hash2 = computeVoteHash({
      price: price2,
      salt: salt2,
      account: account1,
      time: time2,
      roundId,
      identifier: identifier2,
    });
    await voting.methods["commitVote(bytes32,uint256,bytes32)"](identifier2, time2, hash2).send({ from: accounts[0] });

    // If the voting period is ongoing, prices cannot be returned since they are not finalized.
    assert.isFalse(
      await voting.methods["hasPrice(bytes32,uint256,bytes)"](identifier1, time1, ancillaryData1).call({
        from: registeredContract,
      })
    );
    assert.isFalse(
      await voting.methods["hasPrice(bytes32,uint256)"](identifier2, time2).call({ from: registeredContract })
    );
    assert(
      await didContractThrow(
        voting.methods["getPrice(bytes32,uint256,bytes)"](identifier1, time1, ancillaryData1).call({
          from: registeredContract,
        })
      )
    );
    assert(
      await didContractThrow(
        voting.methods["getPrice(bytes32,uint256)"](identifier2, time2).call({ from: registeredContract })
      )
    );

    // Move to the reveal phase of the voting period.
    await moveToNextPhase(voting, accounts[0]);

    // Reveal both votes.
    await voting.methods.revealVote(identifier1, time1, price1, ancillaryData1, salt1).send({ from: accounts[0] });
    await voting.methods.revealVote(identifier2, time2, price2, salt2).send({ from: accounts[0] });

    // Prices cannot be provided until both commit and reveal for the current round have finished.
    assert.isFalse(
      await voting.methods["hasPrice(bytes32,uint256,bytes)"](identifier1, time1, ancillaryData1).call({
        from: registeredContract,
      })
    );
    assert.isFalse(
      await voting.methods["hasPrice(bytes32,uint256)"](identifier2, time2).call({ from: registeredContract })
    );
    assert(
      await didContractThrow(
        voting.methods["getPrice(bytes32,uint256,bytes)"](identifier1, time1, ancillaryData1).call({
          from: registeredContract,
        })
      )
    );
    assert(
      await didContractThrow(
        voting.methods["getPrice(bytes32,uint256)"](identifier2, time2).call({ from: registeredContract })
      )
    );

    // Move past the voting round.
    await moveToNextRound(voting, accounts[0]);

    // Note: all voting results are currently hardcoded to 1.
    assert.isTrue(
      await voting.methods["hasPrice(bytes32,uint256,bytes)"](identifier1, time1, ancillaryData1).call({
        from: registeredContract,
      })
    );
    assert.isTrue(
      await voting.methods["hasPrice(bytes32,uint256)"](identifier2, time2).call({ from: registeredContract })
    );
    assert.equal(
      (
        await voting.methods["getPrice(bytes32,uint256,bytes)"](identifier1, time1, ancillaryData1).call({
          from: registeredContract,
        })
      ).toString(),
      price1.toString()
    );
    assert.equal(
      (
        await voting.methods["getPrice(bytes32,uint256)"](identifier2, time2).call({ from: registeredContract })
      ).toString(),
      price2.toString()
    );
  });
  it("Slashing correctly reallocates funds between voters", async function () {
    const identifier = padRight(utf8ToHex("slash-test"), 64);
    const time = "420";

    // Make the Oracle support this identifier.
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });

    // Request a price and move to the next round where that will be voted on.
    await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });
    await moveToNextRound(voting, accounts[0]);
    const roundId = (await voting.methods.getCurrentRoundId().call()).toString();

    // Commit votes.
    const losingPrice = 123;
    const salt1 = getRandomSignedInt();
    const hash1 = computeVoteHash({ price: losingPrice, salt: salt1, account: account1, time, roundId, identifier });
    await voting.methods.commitVote(identifier, time, hash1).send({ from: account1 });

    // Both account 2 and 3 vote for 456. Account4 did not vote.
    const winningPrice = 456;

    const salt2 = getRandomSignedInt();
    const hash2 = computeVoteHash({ price: winningPrice, salt: salt2, account: account2, time, roundId, identifier });
    await voting.methods.commitVote(identifier, time, hash2).send({ from: account2 });

    const salt3 = getRandomSignedInt();
    const hash3 = computeVoteHash({ price: winningPrice, salt: salt3, account: account3, time, roundId, identifier });
    await voting.methods.commitVote(identifier, time, hash3).send({ from: account3 });

    // Reveal the votes.
    await moveToNextPhase(voting, accounts[0]);

    await voting.methods.revealVote(identifier, time, losingPrice, salt1).send({ from: account1 });
    await voting.methods.revealVote(identifier, time, winningPrice, salt2).send({ from: account2 });
    await voting.methods.revealVote(identifier, time, winningPrice, salt3).send({ from: account3 });

    // Price should resolve to the one that 2 and 3 voted for.
    await moveToNextRound(voting, accounts[0]);

    // Now call updateTrackers to update the slashing metrics. We should see a cumulative slashing amount increment and
    // the slash per wrong vote and slash per no vote set correctly.
    await voting.methods.updateTrackers(account1).send({ from: account1 });

    // The test configuration has a wrong vote and no vote slash per token set to 0.0016. This works out to ~ equal to
    // the emission rate of the contract assuming 10 votes per month over a year. At this rate we should see two groups
    // of slashing: 1) the wrong vote and 2) the no vote. for the wrong vote there was 32mm tokens voted wrong from
    // account1. This should result in a slashing of 32mm*0.0016 = 51200. For the no vote Account4 has 4mm and did not
    // vote. they should get slashed as 4mm*0.0016 = 6400. Total slashing of 51200 + 6400 = 57600.
    const slashingTracker = await voting.methods.requestSlashingTrackers(0).call();
    assert.equal(slashingTracker.wrongVoteSlashPerToken, toWei("0.0016"));
    assert.equal(slashingTracker.noVoteSlashPerToken, toWei("0.0016"));
    assert.equal(slashingTracker.totalSlashed, toWei("57600"));
    assert.equal(slashingTracker.totalCorrectVotes, toWei("64000000"));

    // These slashings should be removed from the slashed token holders and added pro-rata to the correct voters.
    // Account 1 should loose 51200 tokens and account 2 should lose 6400 tokens.
    assert.equal(
      (await voting.methods.voterStakes(account1).call()).activeStake,
      toWei("32000000").sub(toWei("51200")) // Their original stake amount of 32mm minus the slashing of 51200.
    );

    await voting.methods.updateTrackers(account4).send({ from: account1 });
    assert.equal(
      (await voting.methods.voterStakes(account4).call()).activeStake,
      toWei("4000000").sub(toWei("6400")) // Their original stake amount of 4mm minus the slashing of 6400.
    );

    // Account2 and account3 should have their staked amounts increase by the positive slashing. As they both have the
    // same staked amounts we should see their balances increase equally as half of the 57600/2 = 28800 for each.
    await voting.methods.updateTrackers(account2).send({ from: account1 });
    assert.equal(
      (await voting.methods.voterStakes(account2).call()).activeStake,
      toWei("32000000").add(toWei("28800")) // Their original stake amount of 32mm plus the positive slashing of 28800.
    );
    await voting.methods.updateTrackers(account3).send({ from: account1 });
    assert.equal(
      (await voting.methods.voterStakes(account3).call()).activeStake,
      toWei("32000000").add(toWei("28800")) // Their original stake amount of 32mm plus the positive slashing of 28800.
    );
  });
  it("Multiple votes in the same voting round slash cumulatively", async function () {
    // Put two price requests into the same voting round.
    const identifier = padRight(utf8ToHex("slash-test"), 64); // Use the same identifier for both.
    const time1 = "420";
    const time2 = "421";
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });
    await voting.methods.requestPrice(identifier, time1).send({ from: registeredContract });
    await voting.methods.requestPrice(identifier, time2).send({ from: registeredContract });
    await moveToNextRound(voting, accounts[0]);
    const roundId = (await voting.methods.getCurrentRoundId().call()).toString();

    // Account1 and account4 votes correctly, account2 votes wrong in both votes and account3 does not vote in either.
    // Commit votes.
    const losingPrice = 123;
    const salt = getRandomSignedInt(); // use the same salt for all votes. bad practice but wont impact anything.
    const baseRequest = { salt, roundId, identifier };
    const hash1 = computeVoteHash({ ...baseRequest, price: losingPrice, account: account2, time: time1 });
    await voting.methods.commitVote(identifier, time1, hash1).send({ from: account2 });
    const hash2 = computeVoteHash({ ...baseRequest, price: losingPrice, account: account2, time: time2 });
    await voting.methods.commitVote(identifier, time2, hash2).send({ from: account2 });
    const winningPrice = 456;
    const hash3 = computeVoteHash({ ...baseRequest, price: winningPrice, account: account1, time: time1 });
    await voting.methods.commitVote(identifier, time1, hash3).send({ from: account1 });
    const hash4 = computeVoteHash({ ...baseRequest, price: winningPrice, account: account1, time: time2 });
    await voting.methods.commitVote(identifier, time2, hash4).send({ from: account1 });

    const hash5 = computeVoteHash({ ...baseRequest, price: winningPrice, account: account4, time: time1 });
    await voting.methods.commitVote(identifier, time1, hash5).send({ from: account4 });
    const hash6 = computeVoteHash({ ...baseRequest, price: winningPrice, account: account4, time: time2 });
    await voting.methods.commitVote(identifier, time2, hash6).send({ from: account4 });

    await moveToNextPhase(voting, accounts[0]); // Reveal the votes.

    await voting.methods.revealVote(identifier, time1, losingPrice, salt).send({ from: account2 });
    await voting.methods.revealVote(identifier, time2, losingPrice, salt).send({ from: account2 });
    await voting.methods.revealVote(identifier, time1, winningPrice, salt).send({ from: account1 });

    await voting.methods.revealVote(identifier, time2, winningPrice, salt).send({ from: account1 });

    await voting.methods.revealVote(identifier, time1, winningPrice, salt).send({ from: account4 });
    await voting.methods.revealVote(identifier, time2, winningPrice, salt).send({ from: account4 });

    await moveToNextRound(voting, accounts[0]);
    // Now call updateTrackers to update the slashing metrics. We should see a cumulative slashing amount increment and
    // the slash per wrong vote and slash per no vote set correctly.
    await voting.methods.updateTrackers(account1).send({ from: account1 });
    // Based off the votes in the batch we should see account2 slashed twice for voting wrong and account3 slashed twice
    // for not voting, both at a rate of 0.0016 tokens per vote. We should be able to see two separate request slashing
    // trackers. The totalSlashed should therefor be 32mm * 2 * 0.0016 = 102400 per slashing tracker. The total correct
    // votes should be account1 (32mm) and account4(4mm) as 46mm.
    const slashingTracker1 = await voting.methods.requestSlashingTrackers(0).call();
    assert.equal(slashingTracker1.wrongVoteSlashPerToken, toWei("0.0016"));
    assert.equal(slashingTracker1.noVoteSlashPerToken, toWei("0.0016"));
    assert.equal(slashingTracker1.totalSlashed, toWei("102400"));
    assert.equal(slashingTracker1.totalCorrectVotes, toWei("36000000"));
    const slashingTracker2 = await voting.methods.requestSlashingTrackers(1).call();
    assert.equal(slashingTracker2.wrongVoteSlashPerToken, toWei("0.0016"));
    assert.equal(slashingTracker2.noVoteSlashPerToken, toWei("0.0016"));
    assert.equal(slashingTracker2.totalSlashed, toWei("102400"));
    assert.equal(slashingTracker2.totalCorrectVotes, toWei("36000000"));
    // Now consider the impact on the individual voters cumulative staked amounts. First, let's consider the voters who
    // were wrong and lost balance. Account2 and Account3 were both wrong with 32mm tokens, slashed twice. They should
    // each loose 32mm * 2 * 0.0016 = 102400 tokens.
    await voting.methods.updateTrackers(account2).send({ from: account1 });
    assert.equal(
      (await voting.methods.voterStakes(account2).call()).activeStake,
      toWei("32000000").sub(toWei("102400")) // Their original stake amount of 32mm minus the slashing of 102400.
    );

    await voting.methods.updateTrackers(account3).send({ from: account1 });
    assert.equal(
      (await voting.methods.voterStakes(account3).call()).activeStake,
      toWei("32000000").sub(toWei("102400")) // Their original stake amount of 32mm minus the slashing of 102400.
    );

    // Now consider the accounts that should have accrued positive slashing. Account1 has 32mm and should have gotten
    // 32mm/(32mm+4mm) * 102400 * 2 = 182044.4444444444 (their fraction of the total slashed)
    // await voting.methods.updateTrackers(account1).send({ from: account1 });
    assert.equal(
      (await voting.methods.voterStakes(account1).call()).activeStake,
      toWei("32000000").add(toBN("182044444444444444444444")) // Their original stake amount of 32mm plus the slash of 182044.4
    );

    // Account4 has 4mm and should have gotten 4mm/(32mm+4mm) * 102400 * 2 = 22755.555 (their fraction of the total slashed)
    await voting.methods.updateTrackers(account4).send({ from: account4 });
    assert.equal(
      (await voting.methods.voterStakes(account4).call()).activeStake,
      toWei("4000000").add(toBN("22755555555555555555554")) // Their original stake amount of 4mm plus the slash of 22755.555
    );
  });
  it("votes slashed over multiple voting rounds with no claims in between", async function () {
    // Consider multiple voting rounds with no one claiming rewards/restaging ect(to update the slashing accumulators).
    // Contract should correctly accommodate this over the interval.
    const identifier = padRight(utf8ToHex("slash-test"), 64); // Use the same identifier for both.
    const time1 = "420";

    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });
    await voting.methods.requestPrice(identifier, time1).send({ from: registeredContract });
    await moveToNextRound(voting, accounts[0]);
    const roundId = (await voting.methods.getCurrentRoundId().call()).toString();

    // Account1 and account4 votes correctly, account2 votes wrong and account3 does not vote.
    // Commit votes.
    const losingPrice = 123;
    const salt = getRandomSignedInt(); // use the same salt for all votes. bad practice but wont impact anything.
    const baseRequest = { salt, roundId, identifier };
    const hash1 = computeVoteHash({ ...baseRequest, price: losingPrice, account: account2, time: time1 });

    await voting.methods.commitVote(identifier, time1, hash1).send({ from: account2 });

    const winningPrice = 456;
    const hash2 = computeVoteHash({ ...baseRequest, price: winningPrice, account: account1, time: time1 });
    await voting.methods.commitVote(identifier, time1, hash2).send({ from: account1 });

    const hash3 = computeVoteHash({ ...baseRequest, price: winningPrice, account: account4, time: time1 });
    await voting.methods.commitVote(identifier, time1, hash3).send({ from: account4 });

    await moveToNextPhase(voting, accounts[0]); // Reveal the votes.

    await voting.methods.revealVote(identifier, time1, losingPrice, salt).send({ from: account2 });
    await voting.methods.revealVote(identifier, time1, winningPrice, salt).send({ from: account1 });
    await voting.methods.revealVote(identifier, time1, winningPrice, salt).send({ from: account4 });

    const time2 = "690";
    await voting.methods.requestPrice(identifier, time2).send({ from: registeredContract });
    await moveToNextRound(voting, accounts[0]);
    const roundId2 = (await voting.methods.getCurrentRoundId().call()).toString();
    // In this vote say that Account1 and account3 votes correctly, account4 votes wrong and account2 does not vote.
    const baseRequest2 = { salt, roundId: roundId2, identifier };
    const hash4 = computeVoteHash({ ...baseRequest2, price: losingPrice, account: account4, time: time2 });

    await voting.methods.commitVote(identifier, time2, hash4).send({ from: account4 });

    const hash5 = computeVoteHash({ ...baseRequest2, price: winningPrice, account: account1, time: time2 });
    await voting.methods.commitVote(identifier, time2, hash5).send({ from: account1 });

    const hash6 = computeVoteHash({ ...baseRequest2, price: winningPrice, account: account3, time: time2 });
    await voting.methods.commitVote(identifier, time2, hash6).send({ from: account3 });

    await moveToNextPhase(voting, accounts[0]); // Reveal the votes.

    await voting.methods.revealVote(identifier, time2, losingPrice, salt).send({ from: account4 });
    await voting.methods.revealVote(identifier, time2, winningPrice, salt).send({ from: account1 });
    await voting.methods.revealVote(identifier, time2, winningPrice, salt).send({ from: account3 });

    await moveToNextRound(voting, accounts[0]);

    // Now call updateTrackers to update the slashing metrics. We should see a cumulative slashing amount increment and
    // the slash per wrong vote and slash per no vote set correctly.
    await voting.methods.updateTrackers(account1).send({ from: account1 });

    // Based off the vote batch we should see two request slashing trackers for each of the two votes. The first one should
    // have a total slashing of 32mm * 2*0.0016 = 102400 (same as previous test.)
    const slashingTracker1 = await voting.methods.requestSlashingTrackers(0).call();
    assert.equal(slashingTracker1.wrongVoteSlashPerToken, toWei("0.0016"));
    assert.equal(slashingTracker1.noVoteSlashPerToken, toWei("0.0016"));
    assert.equal(slashingTracker1.totalSlashed, toWei("102400"));
    assert.equal(slashingTracker1.totalCorrectVotes, toWei("36000000")); // 32mm + 4mm

    // After the first round of voting there was some slashing that happened which impacts the slashing trackers in the
    // second round! This differs from the previous test as there has been some time evolution between the rounds in this
    // test, which was not the case in the previous test where there were multiple votes in the same round. Expect:
    // account1 gains 32mm/(32mm+4mm)*102400. account2 looses 32mm/(32mm+32mm)*102400. account3 looses 32mm/(32mm+32mm)*102400
    // and account4 gains 4mm/(32mm+4mm)*102400. For the next round of votes, considering these balances, the total
    // correct votes will be account1 + account3 so (32mm+91022.222) + (32mm-51200)=64039822.222. Slashed votes will be
    // (account2+account4) * 0.0016 = [(32mm-51200)+(4mm+11377.77)]*0.0016=57536.284432
    //
    // For the second slashing tracker we had 32mm * 2 correct votes and wrong votes was 34mm + 4mm. Slashing should then
    // be 36mm * 0.0016 = 57600
    const slashingTracker2 = await voting.methods.requestSlashingTrackers(1).call();
    assert.equal(slashingTracker2.wrongVoteSlashPerToken, toWei("0.0016"));
    assert.equal(slashingTracker2.noVoteSlashPerToken, toWei("0.0016"));
    assert.equal(slashingTracker2.totalSlashed, toBN("57536284444444444444444"));
    assert.equal(slashingTracker2.totalCorrectVotes, toBN("64039822222222222222222222"));

    // Now consider the impact on the individual voters cumulative staked amounts. This is a bit more complex than
    // previous tests as there was multiple voting rounds and voters were slashed between the rounds. Account1 voted
    // correctly both times. In the first voting round they should have accumulated 32mm/(36mm)*102400 = 91022.2222222
    // and in the second they accumulated (32mm+91022.2222222)/(64039822.222) * 57536.284432 = 28832.0316 (note here
    // we factored in the balance from round 1+ the rewards from round 1 and then took the their share of the total
    // correct votes) resulting a a total positive slashing of 91022.2222222+28832.0316=119854.2538959
    // await voting.methods.updateTrackers(account1).send({ from: account1 });
    assert.equal(
      (await voting.methods.voterStakes(account1).call()).activeStake,
      toWei("32000000").add(toBN("119854253895946226051937")) // Their original stake amount of 32mm minus the slashing of 119854.25389.
    );

    // Account2 voted wrong the first time and did not vote the second time. They should get slashed at 32mm*0.0016=51200
    // for the first slash and at (32mm-51200)*0.0016=51118.08 for the second slash. This totals 102318.08.
    await voting.methods.updateTrackers(account2).send({ from: account2 });
    assert.equal(
      (await voting.methods.voterStakes(account2).call()).activeStake,
      toWei("32000000").sub(toWei("102318.08")) // Their original stake amount of 32mm minus the slashing of 102318.08.
    );
    // Account3 did not vote the first time and voted correctly the second time. They should get slashed at 32mm*0.0016
    // = 51200 for the first vote and then on the second vote they should get (32mm-51200)/(64039822.22)*57536.284=28704.2525
    // Overall they should have a resulting slash of -22495.7474
    await voting.methods.updateTrackers(account3).send({ from: account3 });
    assert.equal(
      (await voting.methods.voterStakes(account3).call()).activeStake,
      toWei("32000000").sub(toBN("22495747229279559385272")) // Their original stake amount of 32mm minus the slash of 22495.7474
    );

    // Account4 has 4mm and voted correctly the first time and wrong the second time. On the first vote they should have
    // gotten 4mm/(32mm+4mm)*102400=11377.77 and on the second vote they should have lost (4mm+11377.77)*0.0016*57536.284
    // =6418.204432. Overall they should have gained 4959.56

    await voting.methods.updateTrackers(account4).send({ from: account4 });
    assert.equal(
      (await voting.methods.voterStakes(account4).call()).activeStake,
      toWei("4000000").add(toBN("4959573333333333333333")) // Their original stake amount of 4mm plus the slash of 4959.56.
    );
  });

  it("Governance requests don't slash wrong votes", async function () {
    const identifier = padRight(utf8ToHex("governance-price-request"), 64); // Use the same identifier for both.
    const time1 = "420";
    const DATA_LIMIT_BYTES = 8192;
    const ancillaryData = web3.utils.randomHex(DATA_LIMIT_BYTES);

    // Register accounts[0] as a registered contract.
    await registry.methods.registerContract([], accounts[0]).send({ from: accounts[0] });

    await voting.methods.requestGovernanceAction(identifier, time1, ancillaryData).send({ from: accounts[0] });
    await moveToNextRound(voting, accounts[0]);
    const roundId = (await voting.methods.getCurrentRoundId().call()).toString();

    // Account1 and account4 votes correctly, account2 votes wrong and account3 does not vote..
    // Commit votes.
    const losingPrice = 1;
    const salt = getRandomSignedInt(); // use the same salt for all votes. bad practice but wont impact anything.
    const baseRequest = { salt, roundId, identifier };
    const hash1 = computeVoteHashAncillary({
      ...baseRequest,
      price: losingPrice,
      account: account2,
      time: time1,
      ancillaryData,
    });

    await voting.methods.commitVote(identifier, time1, ancillaryData, hash1).send({ from: account2 });

    const winningPrice = 0;
    const hash2 = computeVoteHashAncillary({
      ...baseRequest,
      price: winningPrice,
      account: account1,
      time: time1,
      ancillaryData,
    });
    await voting.methods.commitVote(identifier, time1, ancillaryData, hash2).send({ from: account1 });

    const hash3 = computeVoteHashAncillary({
      ...baseRequest,
      price: winningPrice,
      account: account4,
      time: time1,
      ancillaryData,
    });
    await voting.methods.commitVote(identifier, time1, ancillaryData, hash3).send({ from: account4 });

    await moveToNextPhase(voting, accounts[0]); // Reveal the votes.

    await voting.methods.revealVote(identifier, time1, losingPrice, ancillaryData, salt).send({ from: account2 });
    await voting.methods.revealVote(identifier, time1, winningPrice, ancillaryData, salt).send({ from: account1 });
    await voting.methods.revealVote(identifier, time1, winningPrice, ancillaryData, salt).send({ from: account4 });

    await moveToNextRound(voting, accounts[0]);

    // Now call updateTrackers to update the slashing metrics. We should see a cumulative slashing amount increment and
    // the slash per wrong vote and slash per no vote set correctly.
    await voting.methods.updateTrackers(account1).send({ from: account1 });

    const slashingTracker1 = await voting.methods.requestSlashingTrackers(0).call();
    assert.equal(slashingTracker1.wrongVoteSlashPerToken, toWei("0")); // No wrong vote slashing.
    assert.equal(slashingTracker1.noVoteSlashPerToken, toWei("0.0016"));
    assert.equal(slashingTracker1.totalSlashed, toWei("51200")); // 32mm*0.0016=51200
    assert.equal(slashingTracker1.totalCorrectVotes, toWei("36000000")); // 32mm + 4mm

    // Check that account3 is slashed for not voting.
    await voting.methods.updateTrackers(account3).send({ from: account3 });
    assert.equal(
      (await voting.methods.voterStakes(account3).call()).activeStake,
      toWei("32000000").sub(toWei("51200")) // Their original stake amount of 32mm minus the slash of 51200
    );

    // Check that account2 is not slashed for voting wrong.
    await voting.methods.updateTrackers(account2).send({ from: account2 });
    assert.equal(
      (await voting.methods.voterStakes(account2).call()).activeStake,
      toWei("32000000") // Their original stake amount of 32mm.
    );

    // Check that account 1 and account 4 received the correct amount of tokens.
    // Account 1 should receive 32mm/(32mm+4mm)*51200=45511.111...
    await voting.methods.updateTrackers(account1).send({ from: account1 });
    assert.equal(
      (await voting.methods.voterStakes(account1).call()).activeStake,
      toWei("32000000").add(toBN("45511111111111111111111"))
    );

    // Account 4 should receive 4mm/(32mm+4mm)*51200=5688.88...
    await voting.methods.updateTrackers(account4).send({ from: account4 });
    assert.equal(
      (await voting.methods.voterStakes(account4).call()).activeStake,
      toWei("4000000").add(toBN("5688888888888888888888")) // Their original stake amount of 32mm.
    );
  });

  it("Governance and non-governance requests work together well", async function () {
    const identifier = padRight(utf8ToHex("gov-no-gov-combined-request"), 64); // Use the same identifier for both.
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });
    const DATA_LIMIT_BYTES = 8192;
    const ancillaryData = web3.utils.randomHex(DATA_LIMIT_BYTES);

    const time1 = "420";

    // Register accounts[0] as a registered contract.
    await registry.methods.registerContract([], accounts[0]).send({ from: accounts[0] });

    await voting.methods.requestGovernanceAction(identifier, time1, ancillaryData).send({ from: accounts[0] });

    const time2 = "690";
    await voting.methods.requestPrice(identifier, time2).send({ from: registeredContract });

    await moveToNextRound(voting, accounts[0]);
    const roundId = (await voting.methods.getCurrentRoundId().call()).toString();

    const winningPrice = 0;
    const losingPrice = 1;

    // Account1 and account4 votes correctly, account2 votes wrong and account3 does not vote..
    // Commit votes.
    // Governance request.

    const salt = getRandomSignedInt(); // use the same salt for all votes. bad practice but wont impact anything.
    const baseRequest = { salt, roundId, identifier };
    const hash1 = computeVoteHashAncillary({
      ...baseRequest,
      price: losingPrice,
      ancillaryData,
      account: account2,
      time: time1,
    });

    await voting.methods.commitVote(identifier, time1, ancillaryData, hash1).send({ from: account2 });

    const hash2 = computeVoteHashAncillary({
      ...baseRequest,
      price: winningPrice,
      ancillaryData,
      account: account1,
      time: time1,
    });
    await voting.methods.commitVote(identifier, time1, ancillaryData, hash2).send({ from: account1 });

    const hash3 = computeVoteHashAncillary({
      ...baseRequest,
      price: winningPrice,
      ancillaryData,
      account: account4,
      time: time1,
    });
    await voting.methods.commitVote(identifier, time1, ancillaryData, hash3).send({ from: account4 });

    // Non-governance request.
    const baseRequest2 = { salt, roundId: roundId, identifier };

    const hashAccOne = computeVoteHash({ ...baseRequest2, price: winningPrice, account: account1, time: time2 });
    await voting.methods.commitVote(identifier, time2, hashAccOne).send({ from: account1 });

    const hashAccTwo = computeVoteHash({ ...baseRequest2, price: losingPrice, account: account2, time: time2 });
    await voting.methods.commitVote(identifier, time2, hashAccTwo).send({ from: account2 });

    const hashAccFour = computeVoteHash({ ...baseRequest2, price: winningPrice, account: account4, time: time2 });
    await voting.methods.commitVote(identifier, time2, hashAccFour).send({ from: account4 });

    await moveToNextPhase(voting, accounts[0]); // Reveal the votes.

    // Governance request.
    await voting.methods.revealVote(identifier, time1, winningPrice, ancillaryData, salt).send({ from: account1 });
    await voting.methods.revealVote(identifier, time1, losingPrice, ancillaryData, salt).send({ from: account2 });
    await voting.methods.revealVote(identifier, time1, winningPrice, ancillaryData, salt).send({ from: account4 });

    // Non-governance request.
    await voting.methods.revealVote(identifier, time2, winningPrice, salt).send({ from: account1 });
    await voting.methods.revealVote(identifier, time2, losingPrice, salt).send({ from: account2 });
    await voting.methods.revealVote(identifier, time2, winningPrice, salt).send({ from: account4 });

    await moveToNextRound(voting, accounts[0]);

    // Now call updateTrackers to update the slashing metrics. We should see a cumulative slashing amount increment and
    // the slash per wrong vote and slash per no vote set correctly.
    await voting.methods.updateTrackers(account1).send({ from: account1 });

    const slashingTracker1 = await voting.methods.requestSlashingTrackers(0).call();
    assert.equal(slashingTracker1.wrongVoteSlashPerToken, toWei("0")); // No wrong vote slashing.
    assert.equal(slashingTracker1.noVoteSlashPerToken, toWei("0.0016"));
    assert.equal(slashingTracker1.totalSlashed, toWei("51200")); // 32mm*0.0016=51200
    assert.equal(slashingTracker1.totalCorrectVotes, toWei("36000000")); // 32mm + 4mm

    const slashingTracker2 = await voting.methods.requestSlashingTrackers(1).call();
    assert.equal(slashingTracker2.wrongVoteSlashPerToken, toWei("0.0016")); // One wrong vote slashing.
    assert.equal(slashingTracker2.noVoteSlashPerToken, toWei("0.0016"));
    assert.equal(slashingTracker2.totalSlashed, toWei("102400")); // 32mm*0.0016 + 32mm*0.0016=51200
    assert.equal(slashingTracker1.totalCorrectVotes, toWei("36000000")); // 32mm + 4mm

    // Check that account3 is slashed for not voting two times
    await voting.methods.updateTrackers(account3).send({ from: account3 });
    assert.equal(
      (await voting.methods.voterStakes(account3).call()).activeStake,
      toWei("32000000").sub(toWei("102400")) // Their original stake amount of 32mm minus the slash of 51200
    );

    // Check that account2 is only slashed for voting wrong in the second non-governance request.
    await voting.methods.updateTrackers(account2).send({ from: account2 });
    assert.equal(
      (await voting.methods.voterStakes(account2).call()).activeStake,
      toWei("32000000").sub(toWei("51200"))
    );

    // Check that account 1 and account 4 received the correct amount of tokens.
    // Account 1 should receive 32mm/(32mm+4mm)*153600=136533.33...
    await voting.methods.updateTrackers(account1).send({ from: account1 });
    assert.equal(
      (await voting.methods.voterStakes(account1).call()).activeStake,
      toWei("32000000").add(toBN("136533333333333333333333"))
    );

    // Account 4 should receive 4mm/(32mm+4mm)*153600=17066.66...
    await voting.methods.updateTrackers(account4).send({ from: account4 });
    assert.equal(
      (await voting.methods.voterStakes(account4).call()).activeStake,
      toWei("4000000").add(toBN("17066666666666666666665"))
    );
  });

  it("Correctly selects voting round based on request time", async function () {
    // If requests are placed in the last minRollToNextRoundLength of a voting round then they should be placed in the
    // subsequent voting round (auto rolled). minRollToNextRoundLength is set to 7200. i.e requests done 2 hours before
    // the end of the reveal phase should be auto-rolled into the following round.

    await moveToNextRound(voting, accounts[0]); // Move to the start of a voting round to be right at the beginning.
    const startingVotingRoundId = Number(await voting.methods.getCurrentRoundId().call());

    // Requesting prices now should place them in the following voting round (normal behaviour).
    const identifier = padRight(utf8ToHex("slash-test"), 64); // Use the same identifier for both.
    const time1 = "420";
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });
    await voting.methods.requestPrice(identifier, time1).send({ from: registeredContract });

    assert.equal(
      (await voting.methods.getPriceRequestStatuses([{ identifier, time: time1 }]).call())[0].lastVotingRound,
      startingVotingRoundId + 1
    );

    // Pending requests should return empty array as it only returns votes being voted on this round.
    assert.equal((await voting.methods.getPendingRequests().call()).length, 0);

    // If we move to the next phase we should now be able to vote on the requests and they should show up as active.
    await moveToNextRound(voting, accounts[0]);
    // Set the contract time to be exactly at the start of the current round.
    const roundEndTime = Number(await voting.methods.getRoundEndTime(startingVotingRoundId + 1).call());
    // Set time exactly 2 days before end of the current round to ensure we are aligned with the clock timers.
    await voting.methods.setCurrentTime(roundEndTime - 60 * 60 * 24 * 2).send({ from: accounts[0] });
    assert.equal(Number(await voting.methods.getCurrentRoundId().call()), startingVotingRoundId + 1);
    const roundStartTime = Number(await voting.methods.getCurrentTime().call());

    // There should now be one outstanding price request as we are in the active round. We can vote on it.
    assert.equal((await voting.methods.getPendingRequests().call()).length, 1);
    const salt = getRandomSignedInt(); // use the same salt for all votes. bad practice but wont impact anything.

    let roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    const hash1 = computeVoteHash({ salt, roundId, identifier, price: 42069, account: account2, time: time1 });
    await voting.methods.commitVote(identifier, time1, hash1).send({ from: account2 });
    await moveToNextPhase(voting, accounts[0]);
    assert.equal(Number(await voting.methods.getCurrentRoundId().call()), startingVotingRoundId + 1);
    await voting.methods.revealVote(identifier, time1, 42069, salt).send({ from: account2 });

    // Now, move to within the last minRollToNextRoundLength of the next round. If another price request happens in this
    // period it should be place in the round after the next round as it's too close to the next round. To verify we are
    // in time where we think we are we should be exactly 24 hours after the roundStartTime as we've done exactly one
    // action of moveToNextPhase call. We can therefore advance the time to currentTime + 60 * 60 * 23 to be one hour
    // before the end of the voting round.
    const currentTime = Number(await voting.methods.getCurrentTime().call());
    assert.equal(currentTime, roundStartTime + 60 * 60 * 24);
    await voting.methods.setCurrentTime(currentTime + 60 * 60 * 23).send({ from: accounts[0] });
    // We should still be in the same voting round.
    assert.equal(Number(await voting.methods.getCurrentRoundId().call()), startingVotingRoundId + 1);

    // now, when price requests happen they should be placed in the round after the current round.
    const secondRequestRoundId = Number(await voting.methods.getCurrentRoundId().call());
    await voting.methods.requestPrice(identifier, time1 + 1).send({ from: registeredContract });
    assert.equal(
      (await voting.methods.getPriceRequestStatuses([{ identifier, time: time1 + 1 }]).call())[0].lastVotingRound,
      secondRequestRoundId + 2
    );

    // If we move to the next voting round you should not be able vote as the vote is not yet active (its only active
    // in the subsequent round due to the roll).
    await moveToNextRound(voting, accounts[0]);

    // Commit call should revert as this can only be voted on in the next round due to the auto roll.
    roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    const hash2 = computeVoteHash({ salt, roundId, identifier, price: 42069, account: account2, time: time1 + 1 });
    assert(await didContractThrow(voting.methods.commitVote(identifier, time1 + 1, hash2).send({ from: account2 })));

    // Move to the next voting phase and the next voting round. now, we should be able to vote on the second identifier.
    await moveToNextPhase(voting, accounts[0]);
    await moveToNextRound(voting, accounts[0]);
    roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    const hash3 = computeVoteHash({ salt, roundId, identifier, price: 42069, account: account2, time: time1 + 1 });
    await voting.methods.commitVote(identifier, time1 + 1, hash3).send({ from: account2 });
    await moveToNextPhase(voting, accounts[0]);
    await voting.methods.revealVote(identifier, time1 + 1, 42069, salt).send({ from: account2 });
    await moveToNextRound(voting, accounts[0]);
    assert.equal(
      (await voting.methods.getPrice(identifier, time1 + 1).call({ from: registeredContract })).toString(),
      "42069"
    );
  });

  it("Can delegate voting to another address to vote on your stakes behalf", async function () {
    // Delegate from account1 to rand.
    await voting.methods.setDelegate(rand).send({ from: account1 });
    await voting.methods.setDelegator(account1).send({ from: rand });

    // State variables should be set correctly.
    assert.equal((await voting.methods.voterStakes(account1).call()).delegate, rand);
    assert.equal(await voting.methods.delegateToStaker(rand).call(), account1);

    // Request a price and see that we can vote on it on behalf of the account1 from the delegate.
    const identifier = padRight(utf8ToHex("delegated-voting"), 64); // Use the same identifier for both.
    const time = "420";
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });
    await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });

    await moveToNextRound(voting, accounts[0]);
    const roundId = (await voting.methods.getCurrentRoundId().call()).toString();

    const price = 1;

    const salt = getRandomSignedInt(); // use the same salt for all votes. bad practice but wont impact anything.

    // construct the vote hash. Note the account is the delegate.
    const hash = computeVoteHash({ salt, roundId, identifier, price, account: rand, time });

    // Commit the votes.
    await voting.methods.commitVote(identifier, time, hash).send({ from: rand });
    await moveToNextPhase(voting, accounts[0]); // Reveal the votes.
    await voting.methods.revealVote(identifier, time, price, salt).send({ from: rand });
    await moveToNextRound(voting, accounts[0]); // Move to the next round.

    // The price should have settled as per usual and be recoverable. The original staker should have gained the positive
    // slashing from being the oly correct voter. The total slashing should be 68mm * 0.0016 = 108800.
    assert.equal(await voting.methods.getPrice(identifier, time).call({ from: registeredContract }), price);
    await voting.methods.updateTrackers(account1).send({ from: account1 });
    assert.equal(
      (await voting.methods.voterStakes(account1).call()).activeStake,
      toWei("32000000").add(toWei("108800"))
    );
  });

  it("Can revoke a delegate by unsetting the mapping", async function () {
    await voting.methods.setDelegate(rand).send({ from: account1 });
    await voting.methods.setDelegator(account1).send({ from: rand });
    assert.equal((await voting.methods.voterStakes(account1).call()).delegate, rand);
    assert.equal(await voting.methods.delegateToStaker(rand).call(), account1);

    // Remove the delegation from the staker.
    await voting.methods.setDelegate(ZERO_ADDRESS).send({ from: account1 });
    assert.equal((await voting.methods.voterStakes(account1).call()).delegate, ZERO_ADDRESS);

    // Remove the delegation from the delegate.
    await voting.methods.setDelegator(ZERO_ADDRESS).send({ from: rand });
    assert.equal(await voting.methods.delegateToStaker(rand).call(), ZERO_ADDRESS);
  });
  it("Can correctly handel unstaking within voting rounds", async function () {
    // Start by setting the unstakeCooldown to 12 hours to enable us to execute the unstakes during the commit/reveal
    // phases.
    await voting.methods.setUnstakeCoolDown(60 * 60 * 12).send({ from: accounts[0] });

    // Claim all rewards current entitled to all accounts to start from 0 at the time of the price request.
    await voting.methods.withdrawRewards().send({ from: account1 });
    const account1BalancePostClaim = await votingToken.methods.balanceOf(account1).call();

    const identifier = padRight(utf8ToHex("slash-test"), 64); // Use the same identifier for both.
    const time1 = "420";
    const price = "69696969";
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });
    await voting.methods.requestPrice(identifier, time1).send({ from: registeredContract });

    // Account1 will request to unstake before the start of the voting round and execute in the commit phase.
    await voting.methods.requestUnstake(toWei("32000000")).send({ from: account1 });

    await moveToNextRound(voting, accounts[0]); // Move into the commit phase.

    // Account2 unstakes during the commit phase.
    await voting.methods.withdrawRewards().send({ from: account2 });
    const account2BalancePostClaim = await votingToken.methods.balanceOf(account2).call();
    await voting.methods.requestUnstake(toWei("32000000")).send({ from: account2 });

    // Account3 and Account4 commits.
    const salt = getRandomSignedInt(); // use the same salt for all votes. bad practice but wont impact anything.
    let roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    const baseRequest = { salt, roundId, identifier };
    const hash1 = computeVoteHash({ ...baseRequest, price, account: account3, time: time1 });
    await voting.methods.commitVote(identifier, time1, hash1).send({ from: account3 });

    const hash2 = computeVoteHash({ ...baseRequest, price, account: account4, time: time1 });
    await voting.methods.commitVote(identifier, time1, hash2).send({ from: account4 });

    // Move into the reveal phase.
    await moveToNextPhase(voting, accounts[0]);

    // Account3 can reveals. Check the snapshotting makes sense.
    await voting.methods.revealVote(identifier, time1, price, salt).send({ from: account3 });
    // cumulativeActiveStakeAtRound should be 36mm. two accounts of 32mm unstaked before the start of the round.
    assert.equal((await voting.methods.rounds(roundId).call()).cumulativeActiveStakeAtRound, toWei("36000000"));

    // Now, say account4 tries to request an unstake. They cant do this as it is during the current active reveal phase.
    // As this user cant stake they end up doing nothing and just sit. They shall be slashed for non-participation.
    assert(await didContractThrow(voting.methods.requestUnstake(4206969).send({ from: account4 })));

    // Account1 should be able to execute their unstake at this point as it has passed enough time from when they
    // requested. This should not impact the current vote in any way. Equally, they should have 0 outstanding rewards,
    // even through time has evolved due to them being in the pending exit phase.
    assert.equal((await voting.methods.voterStakes(account1).call()).pendingUnstake, toWei("32000000"));
    assert.equal(await voting.methods.outstandingRewards(account1).call(), "0");
    await voting.methods.executeUnstake().send({ from: account1 });
    assert.equal(
      await votingToken.methods.balanceOf(account1).call(),
      toBN(account1BalancePostClaim).add(toWei("32000000"))
    );
    assert.equal((await voting.methods.voterStakes(account1).call()).activeStake, 0);
    assert.equal((await voting.methods.voterStakes(account1).call()).pendingUnstake, 0);
    assert.equal((await voting.methods.voterStakes(account1).call()).pendingStake, 0);

    // Move to the next round to conclude the vote.
    await moveToNextRound(voting, accounts[0]);

    // The price should be resolved to the price that account3 voted on.
    assert.equal(await voting.methods.getPrice(identifier, time1).call({ from: registeredContract }), price);

    // Now consider the slashing. Only account4 should have been slashed as it was the only account actively staked that
    // did not participate. Their slashing should be allocated to account3. account1 and account2 were in the pending
    // exit phase and so should not have had any slashing done to them. Account4's slashing should be 0.0016 * 4mm = 6400

    await voting.methods.updateTrackers(account4).send({ from: account4 });
    assert.equal((await voting.methods.voterStakes(account4).call()).activeStake, toWei("4000000").sub(toWei("6400")));

    await voting.methods.updateTrackers(account3).send({ from: account3 });
    assert.equal((await voting.methods.voterStakes(account3).call()).activeStake, toWei("32000000").add(toWei("6400")));

    // Validate that the slashing trackers worked as expected.
    const slashingTracker = await voting.methods.requestSlashingTrackers(0).call();
    assert.equal(slashingTracker.wrongVoteSlashPerToken, toWei("0.0016"));
    assert.equal(slashingTracker.noVoteSlashPerToken, toWei("0.0016"));
    assert.equal(slashingTracker.totalSlashed, toWei("6400")); // 4mm*0.0016=6400
    assert.equal(slashingTracker.totalCorrectVotes, toWei("32000000")); // 32mm

    // Account2 now executes their unstake.
    assert.equal((await voting.methods.voterStakes(account2).call()).pendingUnstake, toWei("32000000"));
    assert.equal(await voting.methods.outstandingRewards(account2).call(), "0");
    await voting.methods.executeUnstake().send({ from: account2 });
    assert.equal(
      await votingToken.methods.balanceOf(account2).call(),
      toBN(account2BalancePostClaim).add(toWei("32000000"))
    );
  });
  it("Requesting to unstake within a voting round excludes you from being slashed", async function () {
    // If a voter requests to unstake, even in the current commit phase a voting round, they should not be slashed for
    // being "staked" (in unlock cooldown) but not active at that point in time.
    const identifier = padRight(utf8ToHex("slash-test"), 64); // Use the same identifier for both.
    const time = "420";
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });
    await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });

    // Account1 will request to unstake before the start of the voting round.
    await voting.methods.requestUnstake(toWei("32000000")).send({ from: account1 });
    await moveToNextRound(voting, accounts[0]); // Move into the commit phase.

    // Account 2 will request to unstake during the voting round.
    await voting.methods.requestUnstake(toWei("32000000")).send({ from: account2 });

    // Account 3 votes and account 4 does not vote.
    const salt = getRandomSignedInt(); // use the same salt for all votes. bad practice but wont impact anything.
    let roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    let baseRequest = { salt, roundId, identifier };
    const price = "69696969";
    const hash1 = computeVoteHash({ ...baseRequest, price, account: account3, time });
    await voting.methods.commitVote(identifier, time, hash1).send({ from: account3 });

    await moveToNextPhase(voting, accounts[0]); // Move into the reveal phase

    // Account 3 reveals their vote.
    await voting.methods.revealVote(identifier, time, price, salt).send({ from: account3 });

    // We should see that the total number of active stakers for this round is 36mm (account3 and account4). Account1
    // and account2 are in pending exit.
    assert.equal(
      (await voting.methods.rounds(await voting.methods.getCurrentRoundId().call()).call())
        .cumulativeActiveStakeAtRound,
      toWei("36000000")
    );

    await moveToNextRound(voting, accounts[0]); // Move to the next round to conclude the vote.

    // Check account slashing trackers. We should see only account4 slashed and their slash allocated to account3. This
    // should equal to 0.0016 * 4mm = 6400.

    await voting.methods.updateTrackers(account3).send({ from: account3 });
    assert.equal(
      (await voting.methods.voterStakes(account3).call()).activeStake,
      toWei("32000000").add(toWei("6400")) // Their original stake amount of 32mm plus the slashing of 6400
    );

    await voting.methods.updateTrackers(account4).send({ from: account4 });
    assert.equal(
      (await voting.methods.voterStakes(account4).call()).activeStake,
      toWei("4000000").sub(toWei("6400")) // Their original stake amount of 4mm minus the slashing of 6400
    );

    const slashingTracker1 = await voting.methods.requestSlashingTrackers(0).call();
    assert.equal(slashingTracker1.totalSlashed, toWei("6400")); // 32mm*0.0016=51200
    assert.equal(slashingTracker1.totalCorrectVotes, toWei("32000000")); // 32mm + 4mm
  });
  it("Iterative round evolution", async function () {
    // Run over a 5 of voting rounds, committing and revealing and checking slashing trackers. at each round we should
    // see the trackers update as expected. This tests intra-round evolution.
    const identifier = padRight(utf8ToHex("slash-test"), 64);
    const time = "420";
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });
    const salt = getRandomSignedInt();
    const price = "69696969";
    let baseRequest = { salt, roundId: "0", identifier };
    let expectedSlashedBalance = toWei("68000000");
    let expectedPositiveSlash = toBN("0");

    for (let round = 0; round < 5; round++) {
      await voting.methods.requestPrice(identifier, time + round).send({ from: registeredContract });
      await moveToNextRound(voting, accounts[0]); // Move into the commit phase.

      baseRequest.roundId = (await voting.methods.getCurrentRoundId().call()).toString();
      const hash1 = computeVoteHash({ ...baseRequest, price, account: account1, time: time + round });
      await voting.methods.commitVote(identifier, time + round, hash1).send({ from: account1 });

      await moveToNextPhase(voting, accounts[0]);
      await voting.methods.revealVote(identifier, time + round, price, salt).send({ from: account1 });

      await moveToNextRound(voting, accounts[0]);
      await voting.methods.updateTrackers(account1).send({ from: account1 });

      const roundSlash = expectedSlashedBalance.mul(toWei("0.0016")).div(toWei("1"));

      expectedSlashedBalance = expectedSlashedBalance.sub(roundSlash);
      expectedPositiveSlash = expectedPositiveSlash.add(roundSlash);

      assert.equal(
        (await voting.methods.voterStakes(account1).call()).activeStake,
        toWei("32000000").add(expectedPositiveSlash) // Their original stake amount of 32mm plus the iterative positive slash.
      );
      assert.equal((await voting.methods.requestSlashingTrackers(round).call()).totalSlashed, roundSlash);
    }
  });
  it("Can correctly handle rolled votes within slashing trackers and round evolution", async function () {
    // The voting contract supports the ability for requests within each voting round to not settle and be rolled.
    // When this happens they should simply land in a subsequent voting round. Slashing trackers should be able to
    // accommodate this while not skipping any expected slashing and applying the rolled trackers in later rounds.
    // Construct 3 requests. Dont resolve the middle one (roll it).
    const identifier = padRight(utf8ToHex("slash-test"), 64);
    const time = "420";
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });
    await voting.methods.requestPrice(identifier, time + 1).send({ from: registeredContract });
    await voting.methods.requestPrice(identifier, time + 2).send({ from: registeredContract });
    await voting.methods.requestPrice(identifier, time + 3).send({ from: registeredContract });

    await moveToNextRound(voting, accounts[0]); // Move into the commit phase.

    // vote on first and last request. Both from one account. Middle request is rolled.
    const salt = getRandomSignedInt();
    let roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    let baseRequest = { salt, roundId, identifier };
    const price = "69696969";
    const hash1 = computeVoteHash({ ...baseRequest, price, account: account1, time: time + 1 });
    await voting.methods.commitVote(identifier, time + 1, hash1).send({ from: account1 });
    const hash2 = computeVoteHash({ ...baseRequest, price, account: account1, time: time + 3 });
    await voting.methods.commitVote(identifier, time + 3, hash2).send({ from: account1 });

    await moveToNextPhase(voting, accounts[0]); // Move into the reveal phase

    // Account 1 reveals their votes.
    await voting.methods.revealVote(identifier, time + 1, price, salt).send({ from: account1 });
    await voting.methods.revealVote(identifier, time + 3, price, salt).send({ from: account1 });

    // Assume another price request happens now, in the reveal phase.
    await voting.methods.requestPrice(identifier, time + 4).send({ from: registeredContract });

    // Now, move to the next round and verify: slashing was applied correctly, considering the skipped request and
    // the rolled vote is now in the active state.
    await moveToNextRound(voting, accounts[0]); // Move to the next round to conclude the vote.

    // Check account slashing trackers. We should see account2,3 and 4 all slashed as none of them voted on the 2 votes
    // that concluded. This should equal to 68mm * 0.0016 = 217600. This should all be assigned to voter1.
    await voting.methods.updateTrackers(account1).send({ from: account1 });
    assert.equal(
      (await voting.methods.voterStakes(account1).call()).activeStake,
      toWei("32000000").add(toWei("217600")) // Their original stake amount of 32mm  plus the positive slash of 217600.
    );

    // Now, we can vote on the requests: rolled request and "new" request.
    baseRequest.roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    const hash3 = computeVoteHash({ ...baseRequest, price, account: account1, time: time + 2 });
    await voting.methods.commitVote(identifier, time + 2, hash3).send({ from: account1 });
    const hash4 = computeVoteHash({ ...baseRequest, price, account: account1, time: time + 4 });
    await voting.methods.commitVote(identifier, time + 4, hash4).send({ from: account1 });

    await moveToNextPhase(voting, accounts[0]); // Move into the reveal phase
    await voting.methods.revealVote(identifier, time + 2, price, salt).send({ from: account1 });
    await voting.methods.revealVote(identifier, time + 4, price, salt).send({ from: account1 });

    // Move into the next round and check that slashing is applied correctly. We should now have slashed account2,3 and 4
    // again based off their lack of participation in this next round. This should equal (68mm - 217600) * 0.0016 * 2 =
    // 216903.68. Again, this is allocated to the correct voter, account1.
    await moveToNextRound(voting, accounts[0]); // Move into the reveal phase
    await voting.methods.updateTrackers(account1).send({ from: account1 });
    assert.equal(
      (await voting.methods.voterStakes(account1).call()).activeStake,
      toWei("32000000").add(toWei("217600")).add(toWei("216903.68")) //   Their original stake amount of 32mm  plus the positive slash of 217600.
    );
  });

  it("Can correctly handle rolling a vote for many rounds", async function () {
    // Test rolling a vote for many rounds and ensuring the slashing trackers continue to update as expected. Make
    // two requests, vote on the second one sufficiently to settled it and the first one not enough to settle it.
    const identifier = padRight(utf8ToHex("slash-test"), 64);
    const time = "420";
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });
    await voting.methods.requestPrice(identifier, time).send({ from: registeredContract }); // vote should settle.
    await voting.methods.requestPrice(identifier, time + 1).send({ from: registeredContract }); // vote is rolled
    await voting.methods.requestPrice(identifier, time + 2).send({ from: registeredContract }); // vote should settle.
    await moveToNextRound(voting, accounts[0]); // Move into the commit phase.

    const salt = getRandomSignedInt();
    let roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    let baseRequest = { salt, roundId, identifier };
    const price = "69696969";
    // vote on the first request from account4 who cant on their own hit the gat.
    const hash0 = computeVoteHash({ ...baseRequest, price, account: account1, time: time });
    await voting.methods.commitVote(identifier, time, hash0).send({ from: account1 });
    const hash1 = computeVoteHash({ ...baseRequest, price, account: account4, time: time + 1 });
    await voting.methods.commitVote(identifier, time + 1, hash1).send({ from: account4 });
    const hash2 = computeVoteHash({ ...baseRequest, price, account: account1, time: time + 2 });
    await voting.methods.commitVote(identifier, time + 2, hash2).send({ from: account1 });

    await moveToNextPhase(voting, accounts[0]); // Move into the reveal phase
    await voting.methods.revealVote(identifier, time, price, salt).send({ from: account1 });
    await voting.methods.revealVote(identifier, time + 1, price, salt).send({ from: account4 });
    await voting.methods.revealVote(identifier, time + 2, price, salt).send({ from: account1 });

    // Request another price.
    await voting.methods.requestPrice(identifier, time + 3).send({ from: registeredContract });

    await moveToNextRound(voting, accounts[0]); // Move into the reveal phase
    // await voting.methods.updateTrackers(account1).send({ from: account1 });

    // Account4 again votes and fails to pass the first request. account1 votes on the third.
    baseRequest.roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    const hash3 = computeVoteHash({ ...baseRequest, price, account: account4, time: time + 1 });
    await voting.methods.commitVote(identifier, time + 1, hash3).send({ from: account4 });
    const hash4 = computeVoteHash({ ...baseRequest, price, account: account1, time: time + 3 });
    await voting.methods.commitVote(identifier, time + 3, hash4).send({ from: account1 });

    await moveToNextPhase(voting, accounts[0]); // Move into the reveal phase
    await voting.methods.revealVote(identifier, time + 1, price, salt).send({ from: account4 });
    await voting.methods.revealVote(identifier, time + 3, price, salt).send({ from: account1 });

    // Move into the next round. This time actually pass the request that was rolled for the 2 rounds.
    await moveToNextRound(voting, accounts[0]); // Move into the reveal phase
    baseRequest.roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    const hash5 = computeVoteHash({ ...baseRequest, price, account: account4, time: time + 1 });
    await voting.methods.commitVote(identifier, time + 1, hash5).send({ from: account4 });
    const hash6 = computeVoteHash({ ...baseRequest, price, account: account1, time: time + 1 });
    await voting.methods.commitVote(identifier, time + 1, hash6).send({ from: account1 });

    await moveToNextPhase(voting, accounts[0]); // Move into the reveal phase
    await voting.methods.revealVote(identifier, time + 1, price, salt).send({ from: account4 });
    await voting.methods.revealVote(identifier, time + 1, price, salt).send({ from: account1 });

    await moveToNextRound(voting, accounts[0]); // Move into the reveal phase

    // We should have a total number of priceRequestIds (instances where prices are requested) of 3 for the base requests
    // that passed + 2 for the two times the vote was rolled.
    // assert.equal(await voting.methods.getNumberOfPriceRequests().call(), 6);

    // Consider the slashing. There were a total of 4 requests that actually settled. Account2 and account3 were
    // slashed every time as they did not participate in any votes. Account4 only participated in the last vote.
    // The first and second votes were both settled in the first round and should see cumulative slashed amount of
    // 68mm * 0.0016 = 108800 in each round. The third vote should have (68mm - 108800 * 2) * 0.0016 = 108451.84
    // Due to the rolling, requests 1, 4 and 5 should all have the same slashing trackers and should all point to the
    // same request. The request that rolled was made second (hence 1), and then re-requested when slashing trackers were
    // updated and this was soon to have been unresolved and rolled. This happened in index 4 and 5.

    await voting.methods.updateTrackers(account1).send({ from: account1 });
    // The first vote was rolled and never resolved in request index0. All trackers should show this.

    assert.equal(
      (await voting.methods.requestSlashingTrackers(1).call()).toString(),
      (await voting.methods.requestSlashingTrackers(4).call()).toString(),
      (await voting.methods.requestSlashingTrackers(5).call()).toString()
    );

    // First, evaluate the 3 valid price requests in position
    const slashingTracker1 = await voting.methods.requestSlashingTrackers(0).call();
    assert.equal(slashingTracker1.wrongVoteSlashPerToken, toWei("0.0016"));
    assert.equal(slashingTracker1.noVoteSlashPerToken, toWei("0.0016"));
    assert.equal(slashingTracker1.totalSlashed, toWei("108800"));
    assert.equal(slashingTracker1.totalCorrectVotes, toWei("32000000"));

    const slashingTracker2 = await voting.methods.requestSlashingTrackers(2).call();
    assert.equal(slashingTracker2.wrongVoteSlashPerToken, toWei("0.0016"));
    assert.equal(slashingTracker2.noVoteSlashPerToken, toWei("0.0016"));
    assert.equal(slashingTracker2.totalSlashed, toWei("108800"));
    assert.equal(slashingTracker2.totalCorrectVotes, toWei("32000000"));

    const slashingTracker3 = await voting.methods.requestSlashingTrackers(3).call();
    assert.equal(slashingTracker3.wrongVoteSlashPerToken, toWei("0.0016"));
    assert.equal(slashingTracker3.noVoteSlashPerToken, toWei("0.0016"));
    assert.equal(slashingTracker3.totalSlashed, toWei("108451.84"));
    assert.equal(slashingTracker3.totalCorrectVotes, toWei("32217600")); // 32mm + the previous 2 rounds of positive slashing.

    // For request index 1,4, 5 we had a total correct vote of account1 and account4. Account1 has 32326051.84 (sum
    // of previous asserts totalCorrectVotes and totalSlashed) and account 4 had 4mm * (1 - 0.0016 * 2) * (1 - 0.0016)
    // = 36306872.32. Total correct vote of 36204462.08. The total slashed should be account2 and account3 slashed
    // again after the previous three votes as 64mm * (1 - 0.0016 * 2) * (1 - 0.0016) * 0.0016
    const slashingTracker4 = await voting.methods.requestSlashingTrackers(5).call();
    assert.equal(slashingTracker4.wrongVoteSlashPerToken, toWei("0.0016"));
    assert.equal(slashingTracker4.noVoteSlashPerToken, toWei("0.0016"));
    assert.equal(slashingTracker4.totalSlashed, toWei("101909.004288"));
    assert.equal(slashingTracker4.totalCorrectVotes, toWei("36306872.32")); // Account1 + account4.
  });
  it("Can partially sync account trackers", async function () {
    // It should be able to partially update an accounts trackers from any account over some range of requests. This
    // enables you to always traverse all slashing rounds, even if it would not be possible within one block. It also lets
    // someone else pay for the slashing gas on your behalf, which might be required in the event there are many many
    // valid requests in a particular round.
    const identifier = padRight(utf8ToHex("slash-test"), 64);
    const time = "420";
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });
    const salt = getRandomSignedInt();
    const price = "69696969";
    let baseRequest = { salt, roundId: "0", identifier };

    // Do one price request and resolution before hand to get an account to have out dated slashing trackers over the
    // subsequent requests. Then, do 5 follow on votes but dont vote from this account. This account is now far behind
    // with their slashing tracker updates. we should be able to update over a given range. Vote from account2 in the loop.
    await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });
    await moveToNextRound(voting, accounts[0]); // Move into the commit phase.

    baseRequest.roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    const hash1 = computeVoteHash({ ...baseRequest, price, account: account1, time: time });
    await voting.methods.commitVote(identifier, time, hash1).send({ from: account1 });

    await moveToNextPhase(voting, accounts[0]);
    await voting.methods.revealVote(identifier, time, price, salt).send({ from: account1 });

    await moveToNextRound(voting, accounts[0]);

    for (let round = 1; round < 6; round++) {
      await voting.methods.requestPrice(identifier, time + round).send({ from: registeredContract });
      await moveToNextRound(voting, accounts[0]); // Move into the commit phase.
      baseRequest.roundId = (await voting.methods.getCurrentRoundId().call()).toString();
      const hash1 = computeVoteHash({ ...baseRequest, price, account: account2, time: time + round });
      await voting.methods.commitVote(identifier, time + round, hash1).send({ from: account2 });
      await moveToNextPhase(voting, accounts[0]);
      await voting.methods.revealVote(identifier, time + round, price, salt).send({ from: account2 });
      await moveToNextRound(voting, accounts[0]);
    }

    // The account1 who participated in the first round should should have their slashing tracker stuck at index 0 (they
    // committed and revealed but never did anything again so have not updated) and account2 should be at 5 (missing)
    // the last request number as they've not updated their trackers.
    assert.equal((await voting.methods.voterStakes(account1).call()).lastRequestIndexConsidered, 0);
    assert.equal((await voting.methods.voterStakes(account2).call()).lastRequestIndexConsidered, 5);

    // Now, check we can partially sync their trackers by updating to request3.
    await voting.methods.updateTrackersRange(account1, 3).send({ from: account1 });
    assert.equal((await voting.methods.voterStakes(account1).call()).lastRequestIndexConsidered, 3);

    // We can consider the account1 activeStake by looking at the partial update to their slashing trackers. They were
    // the only account to vote correctly the first time and we've updated to request index 3. They should have received
    // 68mm * 0.0016 on the first request then progressively lost 0.0016 for the following 2 requests such that
    // (32mm + 68mm * 0.0016) * (1 - 0.0016) * (1 - 0.0016) = 32006134.038528
    assert.equal((await voting.methods.voterStakes(account1).call()).activeStake, toWei("32006134.038528"));

    // Now, try sync an invalid index. We should not be able to sync below or at the last updated tracker for this
    // account (i.e <=3 should error).
    assert(await didContractThrow(voting.methods.updateTrackersRange(account1, 2).send({ from: accounts[0] })));
    assert(await didContractThrow(voting.methods.updateTrackersRange(account1, 3).send({ from: accounts[0] })));

    // Equally, should revert on an invalid toIndex that is above the maximum number of requests.
    assert(await didContractThrow(voting.methods.updateTrackersRange(account1, 8).send({ from: accounts[0] })));

    // However, we can update just one index.
    await voting.methods.updateTrackersRange(account1, 4).send({ from: account1 });
    assert.equal((await voting.methods.voterStakes(account1).call()).lastRequestIndexConsidered, 4);

    // Slashing should now be 32006134.0385 slashed again at 0.0016 = 32006134.0385 * (1 - 0.0016) = 31954924.2240663552
    assert.equal((await voting.methods.voterStakes(account1).call()).activeStake, toWei("31954924.2240663552"));

    // Finally, can update the entire remaining range.
    await voting.methods.updateTrackersRange(account1, 6).send({ from: account1 });

    // Slashing should now be 31954924.2240663552 (1 - 0.0016) * (1 - 0.0016)= 31852750.2712.
    assert.equal((await voting.methods.voterStakes(account1).call()).activeStake, toBN("31852750271155356473229312"));

    // Finally, test updating the other voter who is short exactly one tracker.
    const activeStakeBefore = (await voting.methods.voterStakes(account2).call()).activeStake;
    await voting.methods.updateTrackersRange(account2, 6).send({ from: account2 });
    assert.equal(
      (await voting.methods.voterStakes(account2).call()).activeStake,
      toBN(activeStakeBefore)
        .add(toWei("100000000").sub(toBN(activeStakeBefore)).mul(toWei("0.0016")).div(toWei("1")))
        .toString()
    );
  });
  it("Staking after some number of price requests correctly shortcuts how many requests the voter needs to traverse", async function () {
    // If a voter stakes after some number of requests their lastRequestIndexConsidered should skip the active unsettled
    // requests. If you stake during an active reveal period then you skip all requests as it was not possible
    // for you to commit and reveal in this period. Unstake from all accounts to start this test.
    await voting.methods.setUnstakeCoolDown(0).send({ from: accounts[0] });
    await voting.methods.requestUnstake(toWei("32000000")).send({ from: account1 });
    await voting.methods.requestUnstake(toWei("32000000")).send({ from: account2 });
    await voting.methods.requestUnstake(toWei("32000000")).send({ from: account3 });
    await voting.methods.requestUnstake(toWei("4000000")).send({ from: account4 });
    await voting.methods.executeUnstake().send({ from: account1 });
    await voting.methods.executeUnstake().send({ from: account2 });
    await voting.methods.executeUnstake().send({ from: account3 });
    await voting.methods.executeUnstake().send({ from: account4 });

    // If account 4 stakes now they should start at slashing request index0.

    await voting.methods.stake(toWei("32000000")).send({ from: account1 });
    assert.equal((await voting.methods.voterStakes(account1).call()).lastRequestIndexConsidered, 0);

    // Execute a full voting cycle
    const identifier = padRight(utf8ToHex("slash-test"), 64);
    const time = "420";
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });
    const salt = getRandomSignedInt();
    const price = "69696969";
    await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });
    await moveToNextRound(voting, accounts[0]); // Move into the commit phase.

    let baseRequest = { salt, roundId: (await voting.methods.getCurrentRoundId().call()).toString(), identifier };
    const hash1 = computeVoteHash({ ...baseRequest, price, account: account1, time });
    await voting.methods.commitVote(identifier, time, hash1).send({ from: account1 });
    await moveToNextPhase(voting, accounts[0]);
    await voting.methods.revealVote(identifier, time, price, salt).send({ from: account1 });
    await moveToNextRound(voting, accounts[0]);

    // Now, the number of requests should be 1.
    assert.equal(await voting.methods.getNumberOfPriceRequests().call(), "1");

    // Now, stake from another account. we are in the reveal phase of an active request and so the starting index should
    // be 1 as this voter should not be susceptible to slashing for this request.
    await voting.methods.stake(toWei("32000000")).send({ from: account2 });
    assert.equal((await voting.methods.voterStakes(account2).call()).lastRequestIndexConsidered, 1);

    // Now, construct another price request and move into the commit phase.
    await voting.methods.requestPrice(identifier, time + 1).send({ from: registeredContract });
    await moveToNextRound(voting, accounts[0]);
    baseRequest.roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    const hash2 = computeVoteHash({ ...baseRequest, price, account: account1, time: time + 1 });
    await voting.methods.commitVote(identifier, time + 1, hash2).send({ from: account1 });

    // We are in an active commit phase right now (with one vote having been voted on!). the total number of price requests
    // is now 2. However, if someone was to stake now they can still vote on this request and so their lastRequestIndexConsidered
    // should still be set to 1.
    assert.equal(await voting.methods.getNumberOfPriceRequests().call(), "2");
    await voting.methods.stake(toWei("32000000")).send({ from: account3 });
    assert.equal((await voting.methods.voterStakes(account3).call()).lastRequestIndexConsidered, 1);

    // Account3 can now vote on the second request.
    const hash4 = computeVoteHash({ ...baseRequest, price, account: account3, time: time + 1 });
    await voting.methods.commitVote(identifier, time + 1, hash4).send({ from: account3 });

    // Now, move into the reveal phase. If a voter stakes at this point they should automatically skip the previous
    // requests slashing them as it was not posable for them to be staked at that point in time.
    await moveToNextPhase(voting, accounts[0]);
    await voting.methods.stake(toWei("4000000")).send({ from: account4 });
    assert.equal((await voting.methods.voterStakes(account4).call()).lastRequestIndexConsidered, 2);

    // reveal votes
    await voting.methods.revealVote(identifier, time + 1, price, salt).send({ from: account1 });
    await voting.methods.revealVote(identifier, time + 1, price, salt).send({ from: account3 });

    // move to the next round.
    await moveToNextRound(voting, accounts[0]);
  });

  // TODO: add a much more itterative rolling test to validate a many rolled round is correctly tracked.
});

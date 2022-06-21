const hre = require("hardhat");
const { web3 } = hre;
const { runVotingV2Fixture } = require("@uma/common");
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
  signMessage,
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
const VotingTest = getContract("VotingTest");
const Timer = getContract("Timer");
const snapshotMessage = "Sign For Snapshot";
const { utf8ToHex, padRight } = web3.utils;

const toWei = (value) => toBN(web3.utils.toWei(value, "ether"));

describe("VotingV2", function () {
  let voting, votingToken, registry, supportedIdentifiers, registeredContract, unregisteredContract, migratedVoting;
  let accounts, account1, account2, account3, account4, signature;

  const setNewGatPercentage = async (gatPercentage) => {
    await voting.methods.setGatPercentage({ rawValue: gatPercentage.toString() }).send({ from: accounts[0] });
  };

  beforeEach(async function () {
    accounts = await web3.eth.getAccounts();
    [account1, account2, account3, account4, registeredContract, unregisteredContract, migratedVoting] = accounts;
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
    await votingToken.methods.approve(voting.options.address, toWei("32000000")).send({ from: account1 });
    await voting.methods.stake(toWei("32000000")).send({ from: account1 });
    await votingToken.methods.transfer(account2, toWei("32000000")).send({ from: accounts[0] });
    await votingToken.methods.approve(voting.options.address, toWei("32000000")).send({ from: account2 });
    await voting.methods.stake(toWei("32000000")).send({ from: account2 });
    await votingToken.methods.transfer(account3, toWei("32000000")).send({ from: accounts[0] });
    await votingToken.methods.approve(voting.options.address, toWei("32000000")).send({ from: account3 });
    await voting.methods.stake(toWei("32000000")).send({ from: account3 });
    await votingToken.methods.transfer(account4, toWei("4000000")).send({ from: accounts[0] });
    await votingToken.methods.approve(voting.options.address, toWei("4000000")).send({ from: account4 });
    await voting.methods.stake(toWei("4000000")).send({ from: account4 });

    // Set the inflation rate to 0 by default, so the balances stay fixed until inflation is tested.

    // Register contract with Registry.
    await registry.methods.addMember(RegistryRolesEnum.CONTRACT_CREATOR, account1).send({ from: accounts[0] });
    await registry.methods.registerContract([], registeredContract).send({ from: account1 });
    signature = await signMessage(web3, snapshotMessage, account1);

    // Reset the rounds.
    await moveToNextRound(voting, accounts[0]);
  });

  it("Constructor", async function () {
    // GAT must be <= 1.0 (100%)
    const invalidGat = { rawValue: web3.utils.toWei("1.000001") };
    assert(
      await didContractThrow(
        VotingV2.new(
          "42069", // emissionRate
          "420420", // Unstake cooldown
          69696969, // PhaseLength
          invalidGat, // GatPct
          votingToken.options.address, // voting token
          (await Finder.deployed()).options.address, // finder
          (await Timer.deployed()).options.address // timer
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

  it("Should snapshot only with valid EOA", async function () {
    // Reset the rounds.
    await moveToNextRound(voting, accounts[0]);
    await moveToNextPhase(voting, accounts[0]);

    // random bytes should fail
    assert(
      await didContractThrow(voting.methods.snapshotCurrentRound(web3.utils.randomHex(65)).send({ from: accounts[0] }))
    );

    // wrong signer
    const badsig1 = await signMessage(web3, snapshotMessage, account2);
    assert(await didContractThrow(voting.methods.snapshotCurrentRound(badsig1).send({ from: accounts[0] })));

    // right signer, wrong message
    const badsig2 = await signMessage(web3, snapshotMessage.toLowerCase(), account1);
    assert(await didContractThrow(voting.methods.snapshotCurrentRound(badsig2).send({ from: accounts[0] })));

    // this should not throw
    await voting.methods.snapshotCurrentRound(signature).send({ from: accounts[0] });
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

    // Can't reveal if snapshot has not been taken yet, even if all data is correct
    assert(
      await didContractThrow(voting.methods.revealVote(identifier, time, newPrice, newSalt).send({ from: accounts[0] }))
    );

    // This is now required before reveal
    await voting.methods.snapshotCurrentRound(signature).send({ from: accounts[0] });

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

    await voting.methods.snapshotCurrentRound(signature).send({ from: accounts[0] });

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
    await voting.methods.snapshotCurrentRound(signature).send({ from: accounts[0] });

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

    await voting.methods.snapshotCurrentRound(signature).send({ from: accounts[0] });

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

    await voting.methods.snapshotCurrentRound(signature).send({ from: accounts[0] });

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

    await voting.methods.snapshotCurrentRound(signature).send({ from: accounts[0] });
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

    await voting.methods.snapshotCurrentRound(signature).send({ from: accounts[0] });

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

    await voting.methods.snapshotCurrentRound(signature).send({ from: accounts[0] });

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

    await voting.methods.snapshotCurrentRound(signature).send({ from: accounts[0] });

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

    await voting.methods.snapshotCurrentRound(signature).send({ from: accounts[0] });

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

    await voting.methods.snapshotCurrentRound(signature).send({ from: accounts[0] });
    await voting.methods.revealVote(identifier, time, price, salt).send({ from: account4 });

    // Since the GAT was not hit, the price should not resolve.
    await moveToNextRound(voting, accounts[0]);
    assert.isFalse(await voting.methods.hasPrice(identifier, time).call({ from: registeredContract }));

    // Setting GAT should revert if larger than 100%
    assert(
      await didContractThrow(
        voting.methods.setGatPercentage({ rawValue: toWei("1.1").toString() }).send({ from: accounts[0] })
      )
    );

    // With a smaller GAT value of 3%, account4 can pass the vote on their own with 4% of all tokens.
    await setNewGatPercentage(web3.utils.toWei("0.03", "ether"));

    // Create new vote hashes with the new round ID and commit votes.
    roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    hash4 = computeVoteHash({ price, salt, account: account4, time, roundId, identifier });
    await voting.methods.commitVote(identifier, time, hash4).send({ from: account4 });

    // Reveal votes.
    await moveToNextPhase(voting, accounts[0]);
    await voting.methods.snapshotCurrentRound(signature).send({ from: accounts[0] });
    await voting.methods.revealVote(identifier, time, price, salt).send({ from: account4 });
    await moveToNextRound(voting, accounts[0]);
    assert.equal(
      (await voting.methods.getPrice(identifier, time).call({ from: registeredContract })).toString(),
      price.toString()
    );

    // Set GAT back to 5% and test a larger vote. With more votes the GAT should be hit
    // and the price should resolve.
    await setNewGatPercentage(web3.utils.toWei("0.05", "ether"));

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

    await voting.methods.snapshotCurrentRound(signature).send({ from: accounts[0] });

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

    await voting.methods.snapshotCurrentRound(signature).send({ from: accounts[0] });

    await voting.methods.revealVote(identifier, time, winningPrice, salt).send({ from: account1 });
    await moveToNextRound(voting, accounts[0]);

    // Sanity check that registered contracts can retrieve prices.
    assert.isTrue(await voting.methods.hasPrice(identifier, time).call({ from: registeredContract }));
    assert.equal(await voting.methods.getPrice(identifier, time).call({ from: registeredContract }), winningPrice);

    // Unregistered contracts can't retrieve prices.
    assert(await didContractThrow(voting.methods.hasPrice(identifier, time).send({ from: unregisteredContract })));
    assert(await didContractThrow(voting.methods.getPrice(identifier, time).send({ from: unregisteredContract })));
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

    await voting.methods.snapshotCurrentRound(signature).send({ from: accounts[0] });

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

    await voting.methods.snapshotCurrentRound(signature).send({ from: accounts[0] });

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
    await voting.methods.snapshotCurrentRound(signature).send({ from: accounts[0] });

    await voting.methods.revealVote(identifier, time, price, salt).send({ from: account1 });
    await voting.methods.revealVote(identifier, time, wrongPrice, salt).send({ from: account4 });
    await moveToNextRound(voting, accounts[0]);
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

    await moveToNextPhase(voting, accounts[0]);

    const decryptedMessage = await decryptMessage(privateKey, retrievedEncryptedMessage);
    const retrievedVote = JSON.parse(decryptedMessage);

    await voting.methods.snapshotCurrentRound(signature).send({ from: accounts[0] });

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

    // Commit without emitting any encrypted messages
    const result = await voting.methods
      .batchCommit(
        priceRequests.map((request) => ({
          identifier: request.identifier,
          time: request.time,
          hash: request.hash,
          encryptedVote: [],
        }))
      )
      .send({ from: accounts[0] });
    await assertEventNotEmitted(result, voting, "EncryptedVote");

    // This time we commit while storing the encrypted messages
    await voting.methods.batchCommit(priceRequests).send({ from: accounts[0] });

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

    await voting.methods.snapshotCurrentRound(signature).send({ from: accounts[0] });

    // NOTE: Signed integers inside structs must be supplied as a string rather than a BN.
    const result = await voting.methods["batchReveal((bytes32,uint256,int256,int256)[])"]([
      { identifier, time: time1, price: price1.toString(), salt: salt1.toString() },
      { identifier, time: time2, price: price2.toString(), salt: salt2.toString() },
    ]).send({ from: accounts[0] });
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
      60 * 60 * 24 * 30, // unstakeCooldown
      "86400", // phase length
      { rawValue: web3.utils.toWei("0.05") }, // 5% GAT
      votingToken.options.address, // voting token
      (await Finder.deployed()).options.address, // finder
      (await Timer.deployed()).options.address // timer
    ).send({ from: accounts[0] });

    // todo: the below logic will be changed when we add migration suport to staked balances.
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
    console.log("roundId", roundId);
    const price = 123;
    const salt = getRandomSignedInt();
    const hash = computeVoteHash({ price, salt, account: account1, time: time1, roundId, identifier });
    console.log("A");
    await newVoting.methods.commitVote(identifier, time1, hash).send({ from: account1 });
    console.log("B");
    await moveToNextPhase(newVoting, accounts[0]);

    await newVoting.methods.snapshotCurrentRound(signature).send({ from: accounts[0] });

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

  // TODO: this test is not very useful now that we've removed reward retrival. it should be updated.
  it.skip("pendingPriceRequests array length", async function () {
    // Use a test derived contract to expose the internal array (and its length).
    const votingTest = await VotingInterfaceTesting.at(
      (
        await VotingTest.new(
          "696969", // emission rate
          "420420", // UnstakeCooldown
          "86400", // 1 day phase length
          { rawValue: web3.utils.toWei("0.05") }, // 5% GAT
          votingToken.options.address, // voting token
          (await Finder.deployed()).options.address, // finder
          (await Timer.deployed()).options.address // timer
        ).send({ from: accounts[0] })
      ).options.address
    );

    await moveToNextRound(votingTest, accounts[0]);

    const identifier = padRight(utf8ToHex("array-size"), 64);
    const time = "1000";
    const startingLength = (await votingTest.methods.getPendingPriceRequestsArray().call()).length;

    // pendingPriceRequests should start with no elements.
    assert.equal(startingLength, 0);

    // Make the Oracle support the identifier.
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });

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
    await votingTest.methods.commitVote(identifier, time, hash).send({ from: accounts[0] });

    // Reveal phase.
    await moveToNextPhase(votingTest, accounts[0]);

    await votingTest.methods.snapshotCurrentRound(signature).send({ from: accounts[0] });
    // Reveal vote.
    await votingTest.methods.revealVote(identifier, time, price, salt).send({ from: accounts[0] });

    // Pending requests should be empty after the voting round ends and the price is resolved.
    await moveToNextRound(votingTest, accounts[0]);
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

    await voting.methods.snapshotCurrentRound(signature).send({ from: accounts[0] });

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

    await voting.methods.snapshotCurrentRound(signature).send({ from: accounts[0] });

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

    await voting.methods.snapshotCurrentRound(signature).send({ from: accounts[0] });

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

    await voting.methods.snapshotCurrentRound(signature).send({ from: accounts[0] });

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
      (await voting.methods.voterStakes(account1).call()).cumulativeStaked,
      toWei("32000000").sub(toWei("51200")) // Their original stake amount of 32mm minus the slashing of 51200.
    );

    await voting.methods.updateTrackers(account4).send({ from: account1 });
    assert.equal(
      (await voting.methods.voterStakes(account4).call()).cumulativeStaked,
      toWei("4000000").sub(toWei("6400")) // Their original stake amount of 4mm minus the slashing of 6400.
    );

    // Account2 and account3 should have their staked amounts increase by the positive slashing. As they both have the
    // same staked amounts we should see their balances increase equally as half of the 57600/2 = 28800 for each.
    await voting.methods.updateTrackers(account2).send({ from: account1 });
    assert.equal(
      (await voting.methods.voterStakes(account2).call()).cumulativeStaked,
      toWei("32000000").add(toWei("28800")) // Their original stake amount of 32mm plus the positive slashing of 28800.
    );
    await voting.methods.updateTrackers(account3).send({ from: account1 });
    assert.equal(
      (await voting.methods.voterStakes(account3).call()).cumulativeStaked,
      toWei("32000000").add(toWei("28800")) // Their original stake amount of 32mm plus the positive slashing of 28800.
    );
  });
});

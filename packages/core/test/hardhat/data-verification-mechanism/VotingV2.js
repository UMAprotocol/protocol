const hre = require("hardhat");
const { web3 } = hre;
const { runVotingV2Fixture, ZERO_ADDRESS } = require("@uma/common");
const { getContract, assertEventEmitted, assertEventNotEmitted } = hre;
const {
  RegistryRolesEnum,
  VotePhasesEnum,
  didContractRevertWith,
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
const { moveToNextRound, moveToNextPhase } = require("../utils/Voting.js");
const { assert } = require("chai");
const { toBN } = web3.utils;

const Finder = getContract("Finder");
const Registry = getContract("Registry");
const VotingV2 = getContract("VotingV2ControllableTiming");
const VotingV2Test = getContract("VotingV2Test");
const VotingInterfaceTesting = getContract("VotingInterfaceTesting");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const VotingToken = getContract("VotingToken");
const Timer = getContract("Timer");
const SlashingLibrary = getContract("FixedSlashSlashingLibrary");
const ZeroedSlashingSlashingLibraryTest = getContract("ZeroedSlashingSlashingLibraryTest");
const PunitiveSlashingLibraryTest = getContract("PunitiveSlashingLibraryTest");
const PriceIdentifierSlashingLibaryTest = getContract("PriceIdentifierSlashingLibaryTest");

const { utf8ToHex, padRight } = web3.utils;

const toWei = (value) => toBN(web3.utils.toWei(value, "ether"));

describe("VotingV2", function () {
  let voting, votingToken, registry, supportedIdentifiers, registeredContract, unregisteredContract, migratedVoting;
  let accounts, account1, account2, account3, account4, rand;

  beforeEach(async function () {
    accounts = await web3.eth.getAccounts();
    [account1, account2, account3, account4, rand, registeredContract, unregisteredContract, migratedVoting] = accounts;
    await runVotingV2Fixture(hre);
    voting = await VotingV2.deployed();

    supportedIdentifiers = await IdentifierWhitelist.deployed();
    votingToken = await VotingToken.deployed();
    registry = await Registry.deployed();

    // Allow account1 to mint tokens.
    const minterRole = 1;
    await votingToken.methods.addMember(minterRole, account1).send({ from: accounts[0] });

    // Seed accounts unless the test is explicitly skipping default distribution.
    if (!this.currentTest.title.endsWith("skip default seeding")) {
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
    }

    // Set the inflation rate to 0 by default, so the balances stay fixed until inflation is tested.

    // Register contract with Registry.
    await registry.methods.addMember(RegistryRolesEnum.CONTRACT_CREATOR, account1).send({ from: accounts[0] });
    await registry.methods.registerContract([], registeredContract).send({ from: accounts[0] });

    // Magic math to ensure we start at the very beginning of a round, and we aren't dependent on the time the tests
    // are run.
    const currentTime = Number((await voting.methods.getCurrentTime().call()).toString());
    const newTime = (Math.floor(currentTime / 172800) + 1) * 172800;
    await voting.methods.setCurrentTime(newTime).send({ from: accounts[0] });

    // Start with a fresh round.
    await moveToNextRound(voting, accounts[0]);
  });

  afterEach(async function () {
    for (const ac of [account1, account2, account3, account4, rand])
      if (voting.methods.updateTrackers) await voting.methods.updateTrackers(ac).send({ from: account1 });

    if (!voting.events["VoterSlashApplied"]) return;

    // Check that the sum of all VoterSlashApplied events is ~0.
    const voterSlashAppliedEvents = await voting.getPastEvents("VoterSlashApplied", {
      fromBlock: 0,
      toBlock: "latest",
    });
    const sumSlashApplied = voterSlashAppliedEvents
      .map((e) => e.returnValues.slashedTokens)
      .reduce((a, b) => toBN(a).add(toBN(b)), toBN(0));

    assert(
      sumSlashApplied.lte(toBN(10)),
      `VoterSlashApplied events should sum to <10 wei, but sum is ${sumSlashApplied.toString()}`
    );

    // Check that the sum of all VoterSlashed events is ~0.
    const voterSlashedEvents = await voting.getPastEvents("VoterSlashed", { fromBlock: 0, toBlock: "latest" });
    const sumVoterSlashed = voterSlashedEvents
      .map((e) => e.returnValues.slashedTokens)
      .reduce((a, b) => toBN(a).add(toBN(b)), toBN(0));

    assert(
      sumVoterSlashed.lte(toBN(10)),
      `VoterSlashed events should sum to <10 wei, but sum is ${sumVoterSlashed.toString()}`
    );

    await voting.methods.setUnstakeCoolDown(0).send({ from: account1 });

    if ((await voting.methods.getVotePhase().call()) == 1) await moveToNextRound(voting, accounts[0]);

    // Withdraw all tokens from all accounts.
    for (const ac of [account1, account2, account3, account4, rand]) {
      if ((await voting.methods.voterStakes(ac).call()).pendingUnstake != 0)
        await voting.methods.executeUnstake().send({ from: ac });
      const stake = await voting.methods.getVoterStakePostUpdate(ac).call();
      if (stake !== "0") {
        await voting.methods.requestUnstake(stake).send({ from: ac });
        await voting.methods.executeUnstake().send({ from: ac });
      }
    }

    const votingBalance = await votingToken.methods.balanceOf(voting.options.address).call();
    assert(toBN(votingBalance).lt(toBN(10)), `votingBalance after withdraws should be <10 wei but is ${votingBalance}`);
  });

  it("Constructor", async function () {
    // GAT must be < total supply
    const invalidGat = toWei("100000000");
    const validGat = toWei("5500000");
    const invalidSpat = toWei("10");
    const validSpat = toWei("0.25");
    assert(
      await didContractThrow(
        VotingV2.new(
          "42069", // emissionRate
          60 * 60 * 24 * 7, // Unstake cooldown
          86400, // PhaseLength
          2, // maxRolls
          1000, // maxRequestsPerRound
          invalidGat, // GAT
          validSpat, // SPAT
          votingToken.options.address, // voting token
          (await Finder.deployed()).options.address, // finder
          (await SlashingLibrary.deployed()).options.address, // slashing library
          ZERO_ADDRESS,
          (await Timer.deployed()).options.address // timer
        ).send({ from: accounts[0] })
      )
    );
    assert(
      await didContractThrow(
        VotingV2.new(
          "42069", // emissionRate
          60 * 60 * 24 * 7, // Unstake cooldown
          86400, // PhaseLength
          2, // maxRolls
          1000, // maxRequestsPerRound
          validGat, // GAT
          invalidSpat, // SPAT
          votingToken.options.address, // voting token
          (await Finder.deployed()).options.address, // finder
          (await SlashingLibrary.deployed()).options.address, // slashing library
          ZERO_ADDRESS,
          (await Timer.deployed()).options.address // timer
        ).send({ from: accounts[0] })
      )
    );
  });

  it("Bytecode size", async function () {
    const byteCodeSize = (getContract("VotingV2").deployedBytecode.length - 2) / 2;
    const remainingSize = 2 ** 14 + 2 ** 13 - byteCodeSize;

    assert(remainingSize >= 0, "Contract is too large to deploy");
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

    await moveToNextRound(voting, accounts[0]);
    await voting.methods.updateTrackers(accounts[0]).send({ from: accounts[0] });
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

    // Submit two price requests.
    await voting.methods.requestPrice(identifier1, time1).send({ from: registeredContract });
    await voting.methods.requestPrice(identifier2, time2).send({ from: registeredContract });

    // Pending requests should be 0 because this request should not be voted on until next round.
    assert.equal((await voting.methods.getPendingRequests().call()).length, 0);

    // Move to next round and roll the first request over.
    await moveToNextRound(voting, accounts[0]);
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberPendingPriceRequests, 2);

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
    // We need to set a SPAT of 50% for this test due to the sizes of each of the stakers.
    await voting.methods.setGatAndSpat(toWei("5500000", "ether"), toWei("0.5", "ether")).send({ from: accounts[0] });
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
    let hash2 = computeVoteHash({ price: price2, salt: salt2, account: account2, time, roundId, identifier });
    await voting.methods.commitVote(identifier, time, hash2).send({ from: account2 });

    // Reveal the votes.
    await moveToNextPhase(voting, accounts[0]);

    await voting.methods.revealVote(identifier, time, price1, salt1).send({ from: account1 });
    await voting.methods.revealVote(identifier, time, price2, salt2).send({ from: account2 });

    // Should not have the price since the vote was equally split.
    await moveToNextRound(voting, accounts[0]);
    roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    // console.log(
    //   "await voting.methods.getPrice(identifier, time).call({ from: registeredContract })",
    //   await voting.methods.getPrice(identifier, time).call({ from: registeredContract })
    // );
    assert.isFalse(await voting.methods.hasPrice(identifier, time).call({ from: registeredContract }));

    // Cleanup: resolve the vote this round.
    hash1 = computeVoteHash({ price: price1, salt: salt1, account: account1, time, roundId, identifier });
    await voting.methods.commitVote(identifier, time, hash1).send({ from: account1 });
    hash2 = computeVoteHash({ price: price1, salt: salt1, account: account2, time, roundId, identifier });
    await voting.methods.commitVote(identifier, time, hash2).send({ from: account2 });
    await moveToNextPhase(voting, accounts[0]);

    await voting.methods.revealVote(identifier, time, price1, salt1).send({ from: account1 });
    await voting.methods.revealVote(identifier, time, price1, salt1).send({ from: account2 });

    await moveToNextRound(voting, accounts[0]);
    assert.isTrue(await voting.methods.hasPrice(identifier, time).call({ from: registeredContract }));
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

    // Set GAT to 5.5M and SPAT to ~0 so that the GAT is the limiting factor.
    await voting.methods.setGatAndSpat(toWei("5500000", "ether"), "1").send({ from: accounts[0] });

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

    // Setting GAT and SPAT should revert if GAT is larger than total supply.
    assert(
      await didContractThrow(
        voting.methods.setGatAndSpat(toWei("110000000").toString(), "1").send({ from: accounts[0] })
      )
    );

    // With a smaller GAT value of 3%, account4 can pass the vote on their own with 4% of all tokens.
    // Again set SPAT to ~0 so that the GAT is the limiting factor.
    await voting.methods.setGatAndSpat(toWei("3000000", "ether"), "1").send({ from: accounts[0] });

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
    await voting.methods.setGatAndSpat(toWei("5000000", "ether"), "1").send({ from: accounts[0] });

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

  it("SPAT", async function () {
    const identifier = padRight(utf8ToHex("gat"), 64);
    let time = "1000";

    // Set GAT to ~0 and SPAT to 33% so that the SPAT is the limiting factor and a voter with 32M tokens cannot pass a vote.
    await voting.methods.setGatAndSpat("1", toWei("0.33", "ether")).send({ from: accounts[0] });

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

    // Reveal the vote.
    await moveToNextPhase(voting, accounts[0]);

    await voting.methods.revealVote(identifier, time, price, salt).send({ from: account1 });

    // Since the SPAT was not hit, the price should not resolve.
    await moveToNextRound(voting, accounts[0]);
    assert.isFalse(await voting.methods.hasPrice(identifier, time).call({ from: registeredContract }));

    // Setting SPAT should revert if larger than 1.
    assert(
      await didContractThrow(voting.methods.setGatAndSpat("1", toWei("1.1").toString()).send({ from: accounts[0] }))
    );

    // With a smaller SPAT value of 30%, account1 can pass the vote on their own with 32% of all staked tokens.
    await voting.methods.setGatAndSpat("1", toWei("0.30", "ether")).send({ from: accounts[0] });

    // Create new vote hashes with the new round ID and commit votes.
    roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    hash1 = computeVoteHash({ price, salt, account: account1, time, roundId, identifier });
    await voting.methods.commitVote(identifier, time, hash1).send({ from: account1 });

    // Reveal votes.
    await moveToNextPhase(voting, accounts[0]);
    await voting.methods.revealVote(identifier, time, price, salt).send({ from: account1 });
    await moveToNextRound(voting, accounts[0]);
    assert.equal(
      (await voting.methods.getPrice(identifier, time).call({ from: registeredContract })).toString(),
      price.toString()
    );

    // Set SPAT back to 33% and test a larger vote. With more votes the SPAT should be hit
    // and the price should resolve.
    await voting.methods.setGatAndSpat("1", toWei("0.33", "ether")).send({ from: accounts[0] });

    // As the previous request has been filled, we need to progress time such that we can vote on the same identifier
    // and request a new price to vote on.
    time += 10;

    await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });
    await moveToNextRound(voting, accounts[0]);

    // Commit votes.
    roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    hash1 = computeVoteHash({ price, salt, account: account1, time, roundId, identifier });
    await voting.methods.commitVote(identifier, time, hash1).send({ from: account1 });
    let hash2 = computeVoteHash({ price, salt, account: account4, time, roundId, identifier });
    await voting.methods.commitVote(identifier, time, hash2).send({ from: account4 });

    // Reveal votes.
    await moveToNextPhase(voting, accounts[0]);

    await voting.methods.revealVote(identifier, time, price, salt).send({ from: account1 });
    await voting.methods.revealVote(identifier, time, price, salt).send({ from: account4 });

    await moveToNextRound(voting, accounts[0]);

    assert.equal(
      (await voting.methods.getPrice(identifier, time).call({ from: registeredContract })).toString(),
      price.toString()
    );

    // Finally, show how the SPAT can be used to force votes to roll without a given amount of participation. Set SPAT
    // to 50%.
    await voting.methods.setGatAndSpat(toWei("5500000", "ether"), toWei("0.5", "ether")).send({ from: accounts[0] });
    time += 11;
    await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });
    await moveToNextRound(voting, accounts[0]);

    // Commit votes from account1 (32mm) and account4 (4mm). This is enough to meet the gat but not the spat. This should
    // cause the vote to roll.
    roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    hash1 = computeVoteHash({ price, salt, account: account1, time, roundId, identifier });
    await voting.methods.commitVote(identifier, time, hash1).send({ from: account1 });
    hash2 = computeVoteHash({ price, salt, account: account4, time, roundId, identifier });
    await voting.methods.commitVote(identifier, time, hash2).send({ from: account4 });

    await moveToNextPhase(voting, accounts[0]); // Reveal votes.
    await voting.methods.revealVote(identifier, time, price, salt).send({ from: account1 });
    await voting.methods.revealVote(identifier, time, price, salt).send({ from: account4 });

    await moveToNextRound(voting, accounts[0]);

    await voting.methods.processResolvablePriceRequests().send({ from: accounts[0] });

    // The price request should have rolled.
    const request3Id = await voting.methods.pendingPriceRequestsIds(0).call();
    assert.equal((await voting.methods.priceRequests(request3Id).call()).rollCount, 1);

    // Now, commit and reveal, meet the GAT and the SPAT and this time it should resolve. have account1 and account2
    // vote on the same price and account4 vote on a different price. This way there is both enough participation and
    // the gat is met.
    roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    hash1 = computeVoteHash({ price, salt, account: account1, time, roundId, identifier });
    await voting.methods.commitVote(identifier, time, hash1).send({ from: account1 });
    hash2 = computeVoteHash({ price, salt, account: account2, time, roundId, identifier });
    await voting.methods.commitVote(identifier, time, hash2).send({ from: account2 });
    let hash3 = computeVoteHash({ price: price + 1, salt, account: account4, time, roundId, identifier });
    await voting.methods.commitVote(identifier, time, hash3).send({ from: account4 });

    await moveToNextPhase(voting, accounts[0]); // Reveal votes.
    await voting.methods.revealVote(identifier, time, price, salt).send({ from: account1 });
    await voting.methods.revealVote(identifier, time, price, salt).send({ from: account2 });

    await voting.methods.revealVote(identifier, time, price + 1, salt).send({ from: account4 });
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
    assert.equal(await voting.methods.voteTiming().call(), "86400");
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
    await assertEventEmitted(result, voting, "RequestAdded", (ev) => {
      return (
        // The vote is added to the next round, so we have to add 1 to the current round id.
        ev.roundId.toString() == currentRoundId.addn(1).toString() &&
        web3.utils.hexToUtf8(ev.identifier) == web3.utils.hexToUtf8(identifier) &&
        ev.time.toString() == time.toString()
      );
    });

    await assertEventEmitted(
      await voting.methods.setGatAndSpat(toWei("6000000", "ether"), toWei("0.25", "ether")).send({ from: accounts[0] }),
      voting,
      "GatAndSpatChanged",
      (ev) => {
        return ev.newGat == toWei("6000000", "ether") && ev.newSpat == toWei("0.25", "ether");
      }
    );

    await moveToNextRound(voting, accounts[0]);
    currentRoundId = await voting.methods.getCurrentRoundId().call();

    // Repeated price requests don't trigger events.
    result = await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });
    await assertEventNotEmitted(result, voting, "RequestAdded");

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

    await assertEventEmitted(result, voting, "VoterSlashApplied", (ev) => {
      return ev.slashedTokens != "0" && ev.postStake != "0" && ev.voter != "";
    });

    await assertEventEmitted(result, voting, "VoterSlashed", (ev) => {
      return ev.slashedTokens != "0" && ev.requestIndex == "0" && ev.voter == account1;
    });

    result = await voting.methods.setMigrated(migratedVoting).send({ from: accounts[0] });
    await assertEventEmitted(result, voting, "VotingContractMigrated", (ev) => {
      return ev.newAddress == migratedVoting;
    });

    const oldSlashingLibrary = await voting.methods.slashingLibrary().call();
    result = await voting.methods.setSlashingLibrary(oldSlashingLibrary).send({ from: accounts[0] });
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
    // Request a price in the old(current) voting contract and verify we can fetch it from the next one once migrated.
    const identifier = padRight(utf8ToHex("migration"), 64);
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });
    const time0 = "420";

    await voting.methods.requestPrice(identifier, time0).send({ from: registeredContract });
    await moveToNextRound(voting, accounts[0]);

    const price = 123;
    const salt = getRandomSignedInt(); // use the same salt for all votes. bad practice but wont impact anything.
    let roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    const baseRequest = { salt, roundId, identifier };
    const hash1 = computeVoteHash({ ...baseRequest, price, account: account1, time: time0 });
    await voting.methods.commitVote(identifier, time0, hash1).send({ from: account1 });
    await moveToNextPhase(voting, accounts[0]);
    await voting.methods.revealVote(identifier, time0, price, salt).send({ from: account1 });
    await moveToNextRound(voting, accounts[0]);

    // Check we can fetch the price (as expected).
    assert.equal(await voting.methods.getPrice(identifier, time0).call({ from: registeredContract }), price);

    const time1 = "1000";
    const time2 = "2000";
    const time3 = "3000";
    // Deploy our own voting because this test case will migrate it.
    const newVoting = await VotingV2.new(
      "640000000000000000", // emission rate
      60 * 60 * 24 * 30, // unstakeCooldown
      "86400", // phase length
      2, // maxRolls
      1000, // maxRequestsPerRound
      toWei("5000000"), // GAT 5MM
      toWei("0.25"), // PAT 25%
      votingToken.options.address, // voting token
      (await Finder.deployed()).options.address, // finder
      (await SlashingLibrary.deployed()).options.address, // slashing library
      voting.options.address, // pass in the old voting contract to the new voting contract.
      (await Timer.deployed()).options.address // timer
    ).send({ from: accounts[0] });

    // As part of the migration we need to set two things: 1) the new voting contract as "registered" in the registry
    // and 2) set the previous contract as migrated.
    await voting.methods.setMigrated(newVoting.options.address).send({ from: account1 });
    await registry.methods.registerContract([], newVoting.options.address).send({ from: accounts[0] });

    // Check we can fetch the price but this time on the new voting contract. The request should be forwarded to the
    // old voting contract as the new one does not have this request stored!
    assert.equal(await newVoting.methods.getPrice(identifier, time0).call({ from: registeredContract }), price);

    // unstake and restake in the new voting contract
    await voting.methods.setUnstakeCoolDown(0).send({ from: account1 });
    await voting.methods.updateTrackers(account1).send({ from: account1 });
    await voting.methods
      .requestUnstake((await voting.methods.voterStakes(account1).call()).stake)
      .send({ from: account1 });
    await voting.methods.updateTrackers(account2).send({ from: account1 });
    await voting.methods
      .requestUnstake((await voting.methods.voterStakes(account2).call()).stake)
      .send({ from: account2 });
    await voting.methods.updateTrackers(account3).send({ from: account1 });
    await voting.methods
      .requestUnstake((await voting.methods.voterStakes(account3).call()).stake)
      .send({ from: account3 });
    await voting.methods.updateTrackers(account4).send({ from: account1 });
    await voting.methods
      .requestUnstake((await voting.methods.voterStakes(account4).call()).stake)
      .send({ from: account4 });

    await voting.methods.executeUnstake().send({ from: account1 });
    await voting.methods.executeUnstake().send({ from: account2 });
    await voting.methods.executeUnstake().send({ from: account3 });
    await voting.methods.executeUnstake().send({ from: account4 });

    // Restake in the new voting contract.
    await votingToken.methods.approve(newVoting.options.address, toWei("1000000000")).send({ from: account1 });
    await newVoting.methods.stake(await votingToken.methods.balanceOf(account1).call()).send({ from: account1 });
    await votingToken.methods.approve(newVoting.options.address, toWei("1000000000")).send({ from: account2 });
    await newVoting.methods.stake(await votingToken.methods.balanceOf(account2).call()).send({ from: account2 });
    await votingToken.methods.approve(newVoting.options.address, toWei("1000000000")).send({ from: account3 });
    await newVoting.methods.stake(await votingToken.methods.balanceOf(account3).call()).send({ from: account3 });
    await votingToken.methods.approve(newVoting.options.address, toWei("1000000000")).send({ from: account4 });
    await newVoting.methods.stake(await votingToken.methods.balanceOf(account4).call()).send({ from: account4 });

    await newVoting.methods.requestPrice(identifier, time1).send({ from: registeredContract });
    await newVoting.methods.requestPrice(identifier, time2).send({ from: registeredContract });
    await moveToNextRound(newVoting, accounts[0]);
    roundId = (await newVoting.methods.getCurrentRoundId().call()).toString();

    const hash = computeVoteHash({ price, salt, account: account1, time: time1, roundId, identifier });
    await newVoting.methods.commitVote(identifier, time1, hash).send({ from: account1 });
    await moveToNextPhase(newVoting, accounts[0]);
    await newVoting.methods.revealVote(identifier, time1, price, salt).send({ from: account1 });
    await moveToNextRound(newVoting, accounts[0]);

    // New newVoting can only call methods after the migration, not before.
    assert(await newVoting.methods.hasPrice(identifier, time1).call({ from: registeredContract }));
    assert(await didContractThrow(newVoting.methods.hasPrice(identifier, time1).send({ from: migratedVoting })));

    // Need permissions to migrate.
    assert(await didContractThrow(newVoting.methods.setMigrated(migratedVoting).send({ from: migratedVoting })));
    await newVoting.methods.setMigrated(migratedVoting).send({ from: accounts[0] });

    // Now newVoting and registered contracts can call methods.
    assert(await newVoting.methods.hasPrice(identifier, time1).send({ from: migratedVoting }));
    assert(await newVoting.methods.hasPrice(identifier, time1).send({ from: registeredContract }));

    // Requesting prices is completely disabled after migration, regardless if called by newVoting.
    assert(await didContractThrow(newVoting.methods.requestPrice(identifier, time3).send({ from: migratedVoting })));
    assert(
      await didContractThrow(newVoting.methods.requestPrice(identifier, time3).send({ from: registeredContract }))
    );
  });

  it("Intra-version reward claiming", async function () {
    // When migrating from V1->LV2, we need to ensure that rewards are correctly claimed on the previous contract via
    // the new voting contract. To do this we will: a) deploy an old voting contract, b) generate some rewards via a
    // vote c) upgrade to the new contract and d) check the voter can claim rewards on the old contract.
    const Voting = getContract("Voting");

    const oldVoting = await Voting.new(
      "86400",
      { rawValue: "0" },
      { rawValue: toWei("0.0005").toString() },
      "86400",
      votingToken.options.address,
      (await Finder.deployed()).options.address,
      (await Timer.deployed()).options.address
    ).send({ from: accounts[0] });
    await votingToken.methods.addMember("1", oldVoting.options.address).send({ from: accounts[0] });

    // Request to unstake such that this account has some token balance to actually get rewards in the old contract.
    await voting.methods.setUnstakeCoolDown(0).send({ from: account1 });
    await voting.methods
      .requestUnstake((await voting.methods.voterStakes(account1).call()).stake)
      .send({ from: account1 });
    await voting.methods.executeUnstake().send({ from: account1 });

    // Request a price and move to the next round where that will be voted on.

    const identifier = padRight(utf8ToHex("historic-vote-claim"), 64);
    const time = "1000";
    // Make the Oracle support this identifier.
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });

    const ancillaryData = utf8ToHex("some-random-extra-data");
    await oldVoting.methods.requestPrice(identifier, time, ancillaryData).send({ from: registeredContract });

    await moveToNextRound(oldVoting, accounts[0]);

    const salt = getRandomSignedInt(); // use the same salt for all votes. bad practice but wont impact anything.
    const price = 420;
    const baseRequest = { salt, roundId: (await oldVoting.methods.getCurrentRoundId().call()).toString(), identifier };
    const hash = computeVoteHashAncillary({ ...baseRequest, price, account: account1, time, ancillaryData });

    await oldVoting.methods.commitVote(identifier, time, ancillaryData, hash).send({ from: account1 });

    await moveToNextPhase(oldVoting, account1);
    const signature = await signMessage(web3, "Sign For Snapshot", account1);
    await oldVoting.methods.snapshotCurrentRound(signature).send({ from: accounts[0] });
    await oldVoting.methods.revealVote(identifier, time, price, ancillaryData, salt).send({ from: account1 });
    await moveToNextRound(oldVoting, accounts[0]);

    assert.equal(
      (await oldVoting.methods.getPrice(identifier, time, ancillaryData).call({ from: registeredContract })).toString(),
      price.toString()
    );

    // There should be rewards that the old account can retrieve, if they were to do it now. Note we need to use the
    // overloaded interface as we are using ancillary data and web3.js can be dumb about correctly choosing the type.
    // Expected increase is 0.0005*100mm=50k.
    assert.equal(
      (
        await oldVoting.methods["retrieveRewards(address,uint256,(bytes32,uint256,bytes)[])"](
          account1,
          baseRequest.roundId,
          [{ identifier, time, ancillaryData }]
        ).call()
      ).toString(),
      toWei("50000").toString()
    );

    // Now, deploy a "new" VotingV2 contract that can have the old one set in the constructor.
    voting = await VotingV2Test.new(
      "42069", // emissionRate
      60 * 60 * 24 * 7, // Unstake cooldown
      86400, // PhaseLength
      2, // maxRolls
      1000, // maxRequestsPerRound
      toWei("5000000"), // GAT 5MM
      toWei("0.25"), // PAT 25%
      votingToken.options.address, // voting token
      (await Finder.deployed()).options.address, // finder
      (await SlashingLibrary.deployed()).options.address, // slashing library
      oldVoting.options.address, // Set the previous voting contract to the old contract deployed in this test.
      (await Timer.deployed()).options.address // timer
    ).send({ from: accounts[0] });

    // Now, set the old voting contract as migrated and check that the voter can claim rewards on the old contract.
    await oldVoting.methods.setMigrated(voting.options.address).send({ from: accounts[0] });

    // Check that the voter can claim rewards on the old contract.
    const oldBalance = await votingToken.methods.balanceOf(account1).call();

    // Calling directly on the old voting contract should revert as the contract is migrated!
    assert(
      await didContractThrow(
        oldVoting.methods
          .retrieveRewards(account1, baseRequest.roundId, [{ identifier, ancillaryData, time }])
          .send({ from: accounts[0] })
      )
    );
    await voting.methods
      .retrieveRewardsOnMigratedVotingContract(account1, baseRequest.roundId, [{ identifier, time, ancillaryData }])
      .send({ from: accounts[0] });

    // Check that the voter's balance has increased.

    assert.equal(
      toBN(oldBalance).add(toBN(toWei("50000"))),
      (await votingToken.methods.balanceOf(account1).call()).toString()
    );
  });

  it("pendingPriceRequests array length", async function () {
    // Use a test derived contract to expose the internal array (and its length).
    const votingTest = await VotingInterfaceTesting.at(
      (
        await VotingV2Test.new(
          "42069", // emissionRate
          60 * 60 * 24 * 7, // Unstake cooldown
          86400, // PhaseLength
          2, // maxRolls
          1000, // maxRequestsPerRound
          toWei("5000000"), // GAT 5MM
          toWei("0.25"), // PAT 25%
          votingToken.options.address, // voting token
          (await Finder.deployed()).options.address, // finder
          (await SlashingLibrary.deployed()).options.address, // slashing library
          ZERO_ADDRESS,
          (await Timer.deployed()).options.address // timer
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

    // Check that getPendingRequests already returns the correct number of elements.
    assert.equal((await VotingV2.at(votingTest.options.address).methods.getPendingRequests().call()).length, 0);
    assert.equal((await votingTest.methods.getPendingPriceRequestsArray().call()).length, 1);

    // Updating the account tracker should remove the request from the pending array as it is now resolved.
    await VotingV2.at(votingTest.options.address).methods.updateTrackers(account1).send({ from: account1 });

    // After updating the account trackers, the length should be decreased back to 0 since the element added in this test is now deleted.
    assert.equal((await votingTest.methods.getPendingPriceRequestsArray().call()).length, 0);
  });
  it("Post update functions return post price request information up to date", async function () {
    const identifier = padRight(utf8ToHex("request-retrieval"), 64);
    const time1 = "1001";
    const time2 = "1002";

    // Make the Oracle support these two identifiers.
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });

    // Requests should not be added to the current voting round.
    await voting.methods.requestPrice(identifier, time1).send({ from: registeredContract });
    await voting.methods.requestPrice(identifier, time2).send({ from: registeredContract });

    // Move to the next round.
    await moveToNextRound(voting, accounts[0]);
    const roundId = (await voting.methods.getCurrentRoundId().call()).toString();

    // Commit votes.
    const price = 123;
    const salt = getRandomSignedInt(); // use the same salt for all votes. bad practice but wont impact anything.
    const baseRequest = { salt, roundId, identifier };
    const hash1 = computeVoteHash({ ...baseRequest, price, account: accounts[0], time: time1 });

    await voting.methods.commitVote(identifier, time1, hash1).send({ from: accounts[0] });

    // Move to the reveal phase.
    await moveToNextPhase(voting, accounts[0]);

    // Reveal the vote.
    await voting.methods.revealVote(identifier, time1, price, salt).send({ from: accounts[0] });

    // Move to the next round.
    await moveToNextRound(voting, accounts[0]);

    // Check that the price is resolved.
    assert.equal(
      (await voting.methods.getPrice(identifier, time1).call({ from: registeredContract })).toString(),
      price.toString()
    );

    // Check that getNumberOfPriceRequestsPostUpdate return the correct number of price requests.
    assert.equal((await voting.methods.getNumberOfPriceRequestsPostUpdate().call()).numberPendingPriceRequests, 1);
    assert.equal((await voting.methods.getNumberOfPriceRequestsPostUpdate().call()).numberResolvedPriceRequests, 1);

    // Check that getPendingRequests returns the pending price requests without updating.
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberPendingPriceRequests, 2);
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberResolvedPriceRequests, 0);

    // Check that getPendingRequests returns the pending price requests updated.
    assert.equal((await voting.methods.getPendingRequests().call())[0].rollCount, 1);

    // Roll two more rounds to delete the price request.
    await moveToNextRound(voting, accounts[0]);
    await moveToNextRound(voting, accounts[0]);

    // Check that getPendingRequests already returns the correct number of elements.
    assert.equal((await voting.methods.getPendingRequests().call()).length, 0);
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
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberPendingPriceRequests, 0);
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberResolvedPriceRequests, 1);

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
      (await voting.methods.voterStakes(account1).call()).stake,
      toWei("32000000").sub(toWei("51200")) // Their original stake amount of 32mm minus the slashing of 51200.
    );

    await voting.methods.updateTrackers(account4).send({ from: account1 });
    assert.equal(
      (await voting.methods.voterStakes(account4).call()).stake,
      toWei("4000000").sub(toWei("6400")) // Their original stake amount of 4mm minus the slashing of 6400.
    );

    // Account2 and account3 should have their staked amounts increase by the positive slashing. As they both have the
    // same staked amounts we should see their balances increase equally as half of the 57600/2 = 28800 for each.
    await voting.methods.updateTrackers(account2).send({ from: account1 });
    assert.equal(
      (await voting.methods.voterStakes(account2).call()).stake,
      toWei("32000000").add(toWei("28800")) // Their original stake amount of 32mm plus the positive slashing of 28800.
    );
    await voting.methods.updateTrackers(account3).send({ from: account1 });
    assert.equal(
      (await voting.methods.voterStakes(account3).call()).stake,
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
      (await voting.methods.voterStakes(account2).call()).stake,
      toWei("32000000").sub(toWei("102400")) // Their original stake amount of 32mm minus the slashing of 102400.
    );

    await voting.methods.updateTrackers(account3).send({ from: account1 });
    assert.equal(
      (await voting.methods.voterStakes(account3).call()).stake,
      toWei("32000000").sub(toWei("102400")) // Their original stake amount of 32mm minus the slashing of 102400.
    );

    // Now consider the accounts that should have accrued positive slashing. Account1 has 32mm and should have gotten
    // 32mm/(32mm+4mm) * 102400 * 2 = 182044.4444444444 (their fraction of the total slashed)
    // await voting.methods.updateTrackers(account1).send({ from: account1 });
    assert.equal(
      (await voting.methods.voterStakes(account1).call()).stake,
      toWei("32000000").add(toBN("182044444444444444444444")) // Their original stake amount of 32mm plus the slash of 182044.4
    );

    // Account4 has 4mm and should have gotten 4mm/(32mm+4mm) * 102400 * 2 = 22755.555 (their fraction of the total slashed)
    await voting.methods.updateTrackers(account4).send({ from: account4 });
    assert.equal(
      (await voting.methods.voterStakes(account4).call()).stake,
      toWei("4000000").add(toBN("22755555555555555555554")) // Their original stake amount of 4mm plus the slash of 22755.555
    );
  });
  it("Votes slashed over multiple voting rounds with no claims in between", async function () {
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
      (await voting.methods.voterStakes(account1).call()).stake,
      toWei("32000000").add(toBN("119854253895946226051937")) // Their original stake amount of 32mm minus the slashing of 119854.25389.
    );

    // Account2 voted wrong the first time and did not vote the second time. They should get slashed at 32mm*0.0016=51200
    // for the first slash and at (32mm-51200)*0.0016=51118.08 for the second slash. This totals 102318.08.
    await voting.methods.updateTrackers(account2).send({ from: account2 });
    assert.equal(
      (await voting.methods.voterStakes(account2).call()).stake,
      toWei("32000000").sub(toWei("102318.08")) // Their original stake amount of 32mm minus the slashing of 102318.08.
    );
    // Account3 did not vote the first time and voted correctly the second time. They should get slashed at 32mm*0.0016
    // = 51200 for the first vote and then on the second vote they should get (32mm-51200)/(64039822.22)*57536.284=28704.2525
    // Overall they should have a resulting slash of -22495.7474
    await voting.methods.updateTrackers(account3).send({ from: account3 });
    assert.equal(
      (await voting.methods.voterStakes(account3).call()).stake,
      toWei("32000000").sub(toBN("22495747229279559385272")) // Their original stake amount of 32mm minus the slash of 22495.7474
    );

    // Account4 has 4mm and voted correctly the first time and wrong the second time. On the first vote they should have
    // gotten 4mm/(32mm+4mm)*102400=11377.77 and on the second vote they should have lost (4mm+11377.77)*0.0016*57536.284
    // =6418.204432. Overall they should have gained 4959.56

    await voting.methods.updateTrackers(account4).send({ from: account4 });
    assert.equal(
      (await voting.methods.voterStakes(account4).call()).stake,
      toWei("4000000").add(toBN("4959573333333333333332")) // Their original stake amount of 4mm plus the slash of 4959.56.
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
      (await voting.methods.voterStakes(account3).call()).stake,
      toWei("32000000").sub(toWei("51200")) // Their original stake amount of 32mm minus the slash of 51200
    );

    // Check that account2 is not slashed for voting wrong.
    await voting.methods.updateTrackers(account2).send({ from: account2 });
    assert.equal(
      (await voting.methods.voterStakes(account2).call()).stake,
      toWei("32000000") // Their original stake amount of 32mm.
    );

    // Check that account 1 and account 4 received the correct amount of tokens.
    // Account 1 should receive 32mm/(32mm+4mm)*51200=45511.111...
    await voting.methods.updateTrackers(account1).send({ from: account1 });
    assert.equal(
      (await voting.methods.voterStakes(account1).call()).stake,
      toWei("32000000").add(toBN("45511111111111111111111"))
    );

    // Account 4 should receive 4mm/(32mm+4mm)*51200=5688.88...
    await voting.methods.updateTrackers(account4).send({ from: account4 });
    assert.equal(
      (await voting.methods.voterStakes(account4).call()).stake,
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
      (await voting.methods.voterStakes(account3).call()).stake,
      toWei("32000000").sub(toWei("102400")) // Their original stake amount of 32mm minus the slash of 51200
    );

    // Check that account2 is only slashed for voting wrong in the second non-governance request.
    await voting.methods.updateTrackers(account2).send({ from: account2 });
    assert.equal((await voting.methods.voterStakes(account2).call()).stake, toWei("32000000").sub(toWei("51200")));

    // Check that account 1 and account 4 received the correct amount of tokens.
    // Account 1 should receive 32mm/(32mm+4mm)*153600=136533.33...
    await voting.methods.updateTrackers(account1).send({ from: account1 });
    assert.equal(
      (await voting.methods.voterStakes(account1).call()).stake,
      toWei("32000000").add(toBN("136533333333333333333333"))
    );

    // Account 4 should receive 4mm/(32mm+4mm)*153600=17066.66...
    await voting.methods.updateTrackers(account4).send({ from: account4 });
    assert.equal(
      (await voting.methods.voterStakes(account4).call()).stake,
      toWei("4000000").add(toBN("17066666666666666666665"))
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

    // construct the vote hash. Note the account remains the account that staked, not the delegate.
    const hash = computeVoteHash({ salt, roundId, identifier, price, account: account1, time });

    // Commit the votes.
    await voting.methods.commitVote(identifier, time, hash).send({ from: rand });
    await moveToNextPhase(voting, accounts[0]); // Reveal the votes.
    await voting.methods.revealVote(identifier, time, price, salt).send({ from: rand });
    await moveToNextRound(voting, accounts[0]); // Move to the next round.

    // The price should have settled as per usual and be recoverable. The original staker should have gained the positive
    // slashing from being the oly correct voter. The total slashing should be 68mm * 0.0016 = 108800.
    assert.equal(await voting.methods.getPrice(identifier, time).call({ from: registeredContract }), price);
    await voting.methods.updateTrackers(account1).send({ from: account1 });
    assert.equal((await voting.methods.voterStakes(account1).call()).stake, toWei("32000000").add(toWei("108800")));
  });
  it("Can change delegate during active voting round and still correctly reveal", async function () {
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
    // construct the vote hash. Note the account remains the account that staked, not the delegate.
    const hash = computeVoteHash({ salt, roundId, identifier, price, account: account1, time });

    // Commit the votes.
    await voting.methods.commitVote(identifier, time, hash).send({ from: rand });
    await moveToNextPhase(voting, accounts[0]); // Reveal the votes.

    // Now, before we reveal change the delegate to a now address and reveal from that account. This should not impact
    // the reveal flow at all.
    await voting.methods.setDelegate(unregisteredContract).send({ from: account1 });
    await voting.methods.setDelegator(account1).send({ from: unregisteredContract });

    // State variables should be set correctly.
    assert.equal((await voting.methods.voterStakes(account1).call()).delegate, unregisteredContract);
    assert.equal(await voting.methods.delegateToStaker(unregisteredContract).call(), account1);

    // Now, should be able to reveal without any issue.
    await voting.methods.revealVote(identifier, time, price, salt).send({ from: unregisteredContract });
    await moveToNextRound(voting, accounts[0]); // Move to the next round.

    // The price should have settled as per usual and be recoverable. The original staker should have gained the positive
    // slashing from being the oly correct voter. The total slashing should be 68mm * 0.0016 = 108800.
    assert.equal(await voting.methods.getPrice(identifier, time).call({ from: registeredContract }), price);
    await voting.methods.updateTrackers(account1).send({ from: account1 });
    assert.equal((await voting.methods.voterStakes(account1).call()).stake, toWei("32000000").add(toWei("108800")));
  });

  it("Can commit from delegate and reveal from delegator", async function () {
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

    // construct the vote hash. Note the account remains the account that staked, not the delegate.
    const hash = computeVoteHash({ salt, roundId, identifier, price, account: account1, time });

    // Commit the votes.
    await voting.methods.commitVote(identifier, time, hash).send({ from: rand });
    await moveToNextPhase(voting, accounts[0]); // Reveal the votes.
    // Now, reveal from the delegator, not the delegate who did the commit. Should work as expected.
    await voting.methods.revealVote(identifier, time, price, salt).send({ from: account1 });
    await moveToNextRound(voting, accounts[0]); // Move to the next round.

    // The price should have settled as per usual and be recoverable. The original staker should have gained the positive
    // slashing from being the oly correct voter. The total slashing should be 68mm * 0.0016 = 108800.
    assert.equal(await voting.methods.getPrice(identifier, time).call({ from: registeredContract }), price);
    await voting.methods.updateTrackers(account1).send({ from: account1 });
    assert.equal((await voting.methods.voterStakes(account1).call()).stake, toWei("32000000").add(toWei("108800")));
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
    // cumulativeStakeAtRound should be 36mm. two accounts of 32mm unstaked before the start of the round.
    assert.equal((await voting.methods.rounds(roundId).call()).cumulativeStakeAtRound, toWei("36000000"));

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
    assert.equal((await voting.methods.voterStakes(account1).call()).stake, 0);
    assert.equal((await voting.methods.voterStakes(account1).call()).pendingUnstake, 0);

    // Move to the next round to conclude the vote.
    await moveToNextRound(voting, accounts[0]);

    // The price should be resolved to the price that account3 voted on.
    assert.equal(await voting.methods.getPrice(identifier, time1).call({ from: registeredContract }), price);

    // Now consider the slashing. Only account4 should have been slashed as it was the only account actively staked that
    // did not participate. Their slashing should be allocated to account3. account1 and account2 were in the pending
    // exit phase and so should not have had any slashing done to them. Account4's slashing should be 0.0016 * 4mm = 6400

    await voting.methods.updateTrackers(account4).send({ from: account4 });
    assert.equal((await voting.methods.voterStakes(account4).call()).stake, toWei("4000000").sub(toWei("6400")));

    await voting.methods.updateTrackers(account3).send({ from: account3 });
    assert.equal((await voting.methods.voterStakes(account3).call()).stake, toWei("32000000").add(toWei("6400")));

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
      (await voting.methods.rounds(await voting.methods.getCurrentRoundId().call()).call()).cumulativeStakeAtRound,
      toWei("36000000")
    );

    await moveToNextRound(voting, accounts[0]); // Move to the next round to conclude the vote.

    // Check account slashing trackers. We should see only account4 slashed and their slash allocated to account3. This
    // should equal to 0.0016 * 4mm = 6400.

    await voting.methods.updateTrackers(account3).send({ from: account3 });
    assert.equal(
      (await voting.methods.voterStakes(account3).call()).stake,
      toWei("32000000").add(toWei("6400")) // Their original stake amount of 32mm plus the slashing of 6400
    );

    await voting.methods.updateTrackers(account4).send({ from: account4 });
    assert.equal(
      (await voting.methods.voterStakes(account4).call()).stake,
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
        (await voting.methods.voterStakes(account1).call()).stake,
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
      (await voting.methods.voterStakes(account1).call()).stake,
      toWei("32000000").add(toWei("217600")) // Their original stake amount of 32mm  plus the positive slash of 217600.
    );

    const pendingRequests = await voting.methods.getPendingRequests().call();
    assert.equal(pendingRequests.length, 2); // There should be 2 pending requests. The rolled one and the new one.

    // The new request should have a roll count of 0.
    assert.equal(pendingRequests[0].time, time + 4);
    assert.equal(pendingRequests[0].rollCount, 0);

    // The rolled request should have a roll count of 1.
    assert.equal(pendingRequests[1].time, time + 2);
    assert.equal(pendingRequests[1].rollCount, 1);

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
      (await voting.methods.voterStakes(account1).call()).stake,
      toWei("32000000").add(toWei("217600")).add(toWei("216903.68")) //   Their original stake amount of 32mm plus the positive slash of 217600.
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

    // We should have a total number of priceRequestIds (instances where prices are requested) of 3.
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberResolvedPriceRequests, 3);

    // Consider the slashing. There were a total of 4 requests that actually settled. Account2 and account3 were
    // slashed every time as they did not participate in any votes. Account4 only participated in the last vote.
    // The first and second votes were both settled in the first round and should see cumulative slashed amount of
    // 68mm * 0.0016 = 108800 in each round. The third vote should have (68mm - 108800 * 2) * 0.0016 = 108451.84
    // Due to the rolling, requests 0, 1 and 2 should all have the same slashing trackers and should all point to the
    // same request.
    await voting.methods.updateTrackers(account1).send({ from: account1 });

    // The first vote was rolled and never resolved in request index0. All trackers should show this.

    assert.equal(
      (await voting.methods.requestSlashingTrackers(0).call()).toString(),
      (await voting.methods.requestSlashingTrackers(1).call()).toString(),
      (await voting.methods.requestSlashingTrackers(2).call()).toString()
    );

    // First, evaluate the 3 valid price requests in position
    const slashingTracker1 = await voting.methods.requestSlashingTrackers(0).call();
    assert.equal(slashingTracker1.wrongVoteSlashPerToken, toWei("0.0016"));
    assert.equal(slashingTracker1.noVoteSlashPerToken, toWei("0.0016"));
    assert.equal(slashingTracker1.totalSlashed, toWei("108800"));
    assert.equal(slashingTracker1.totalCorrectVotes, toWei("32000000"));

    const slashingTracker2 = await voting.methods.requestSlashingTrackers(1).call();
    assert.equal(slashingTracker2.wrongVoteSlashPerToken, toWei("0.0016"));
    assert.equal(slashingTracker2.noVoteSlashPerToken, toWei("0.0016"));
    assert.equal(slashingTracker2.totalSlashed, toWei("108800"));
    assert.equal(slashingTracker2.totalCorrectVotes, toWei("32000000"));

    const slashingTracker3 = await voting.methods.requestSlashingTrackers(2).call();
    assert.equal(slashingTracker3.wrongVoteSlashPerToken, toWei("0.0016"));
    assert.equal(slashingTracker3.noVoteSlashPerToken, toWei("0.0016"));
    assert.equal(slashingTracker3.totalSlashed, toWei("108451.84"));
    assert.equal(slashingTracker3.totalCorrectVotes, toWei("32217600")); // 32mm + the previous 2 rounds of positive slashing.

    // For request index 1,4, 5 we had a total correct vote of account1 and account4. Account1 has 32326051.84 (sum
    // of previous asserts totalCorrectVotes and totalSlashed) and account 4 had 4mm * (1 - 0.0016 * 2) * (1 - 0.0016).
    // Grand total of 36306872.32.
    await voting.methods.updateTrackers(account1).send({ from: account1 });

    // Total correct vote of 36204462.08. The total slashed should be account2 and account3
    // slashed again after the previous three votes as 64mm * (1 - 0.0016 * 2) * (1 - 0.0016) * 0.0016.
    const slashingTracker4 = await voting.methods.requestSlashingTrackers(3).call();
    assert.equal(slashingTracker4.wrongVoteSlashPerToken, toWei("0.0016"));
    assert.equal(slashingTracker4.noVoteSlashPerToken, toWei("0.0016"));
    assert.equal(slashingTracker4.totalSlashed, toWei("101909.004288"));
    assert.equal(slashingTracker4.totalCorrectVotes, toWei("36306872.32")); // Account1 + account4.
  });
  it("Can partially sync account trackers", async function () {
    // It should be able to partially update an accounts trackers from any account over some range of requests. This
    // enables you to always traverse all slashing rounds, even if it would not be possible within one block. It also
    // lets someone else pay for the slashing gas on your behalf, which might be required in the event there are many
    // many valid requests in a particular round.
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

    // submit 5 requests, and vote on them (round 1,2,3,4,5)
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
    assert.equal((await voting.methods.voterStakes(account1).call()).nextIndexToProcess, 0);
    assert.equal((await voting.methods.voterStakes(account2).call()).nextIndexToProcess, 5);

    // Now, check we can partially sync their trackers by updating to request1 (only the first request that was before
    // the forloop block of requests).
    await voting.methods.updateTrackersRange(account1, 1).send({ from: account1 });

    // As we've updated the trackers all requests should be resolved. Resolution of price requests is independent of
    // slashing tracker updates. there should be 6 requests, 1 before the loop then 5 in the loop.
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberResolvedPriceRequests, 6);

    assert.equal((await voting.methods.voterStakes(account1).call()).nextIndexToProcess, 1);

    assert.equal((await voting.methods.voterStakes(account1).call()).stake, toWei("32000000").add(toWei("108800")));

    // Now, update the tracker one more time with maxItterations on updateTracker range set to 1. Should increment once.
    await voting.methods.updateTrackersRange(account1, 1).send({ from: account1 });
    assert.equal((await voting.methods.voterStakes(account1).call()).nextIndexToProcess, 2);
    await voting.methods.updateTrackersRange(account1, 1).send({ from: account1 });
    assert.equal((await voting.methods.voterStakes(account1).call()).nextIndexToProcess, 3);

    // We can consider the account1 amount by looking at the partial update to their slashing trackers. They were
    // the only account to vote correctly the first time and we've updated to request index 3. They should have received
    // 68mm * 0.0016 on the first request then progressively lost 0.0016 for the following 2 request. As these such they
    // should have (32mm + 68mm * 0.0016) * (1 - 0.0016) * (1 - 0.0016) = 32006134.038528
    assert.equal((await voting.methods.voterStakes(account1).call()).stake, toWei("32006134.038528"));

    await voting.methods.updateTrackersRange(account1, 1).send({ from: account1 });
    assert.equal((await voting.methods.voterStakes(account1).call()).nextIndexToProcess, 4);

    // Slashing should now be 32006134.0385 slashed again at 0.0016 = 32006134.0385 * (1 - 0.0016) = 31954924.2240663552
    assert.equal((await voting.methods.voterStakes(account1).call()).stake, toWei("31954924.2240663552"));

    // Finally, can update the entire remaining range.
    await voting.methods.updateTrackers(account1).send({ from: account1 });

    // Slashing should now be 31954924.2240663552 (1 - 0.0016) * (1 - 0.0016)= 31852750.2712.
    assert.equal((await voting.methods.voterStakes(account1).call()).stake, toBN("31852750271155356473229312"));

    // Finally, test updating the other voter who is short exactly one tracker.
    const stakeBefore = (await voting.methods.voterStakes(account2).call()).stake;
    await voting.methods.updateTrackersRange(account2, 6).send({ from: account2 });
    assert.equal(
      (await voting.methods.voterStakes(account2).call()).stake,
      toBN(stakeBefore)
        .add(toWei("100000000").sub(toBN(stakeBefore)).mul(toWei("0.0016")).div(toWei("1")))
        .toString()
    );
  });
  it("Staking after some number of price requests correctly shortcuts how many requests the voter needs to traverse", async function () {
    // If a voter stakes after some number of requests their nextIndexToProcess should skip the active unsettled
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
    assert.equal((await voting.methods.voterStakes(account1).call()).nextIndexToProcess, 0);

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
    await voting.methods.updateTrackers(account1).send({ from: account1 });
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberResolvedPriceRequests, "1");

    // Now, stake from another account. we are in the reveal phase of an active request and so the starting index should
    // be 1 as this voter should not be susceptible to slashing for this request.
    await voting.methods.stake(toWei("32000000")).send({ from: account2 });
    assert.equal((await voting.methods.voterStakes(account2).call()).nextIndexToProcess, 1);

    // Now, construct another price request and move into the commit phase.
    await voting.methods.requestPrice(identifier, time + 1).send({ from: registeredContract });
    await moveToNextRound(voting, accounts[0]);
    baseRequest.roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    const hash2 = computeVoteHash({ ...baseRequest, price, account: account1, time: time + 1 });
    await voting.methods.commitVote(identifier, time + 1, hash2).send({ from: account1 });

    // We are in an active commit phase right now (with one vote having been voted on!). the total number of price requests
    // is now 2 with one in the resolved phase and one still in the pending phase. However, if someone was to stake now
    // they can still vote on this request and so their nextIndexToProcess should still be set to 1.
    await voting.methods.updateTrackers(account1).send({ from: account1 });
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberResolvedPriceRequests, "1");
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberPendingPriceRequests, "1");
    await voting.methods.stake(toWei("32000000")).send({ from: account3 });
    assert.equal((await voting.methods.voterStakes(account3).call()).nextIndexToProcess, 1);

    // Account3 can now vote on the second request.
    const hash4 = computeVoteHash({ ...baseRequest, price, account: account3, time: time + 1 });
    await voting.methods.commitVote(identifier, time + 1, hash4).send({ from: account3 });

    // Now, move into the reveal phase. If a voter stakes at this point they should automatically skip the previous
    // requests slashing them as it was not possible for them to be staked at that point in time.
    await moveToNextPhase(voting, accounts[0]);
    await voting.methods.stake(toWei("4000000")).send({ from: account4 });
    assert.equal((await voting.methods.voterStakes(account4).call()).nextIndexToProcess, 1);

    // reveal votes
    await voting.methods.revealVote(identifier, time + 1, price, salt).send({ from: account1 });
    await voting.methods.revealVote(identifier, time + 1, price, salt).send({ from: account3 });

    // move to the next round.
    await moveToNextRound(voting, accounts[0]);
  });

  it("Edge case when updating slashing tracker range intra round", async function () {
    // Slashing is meant to be applied linearly and independent within a round: each request within a round does not
    // effect other request in the same round but cumulatively between rounds. This is enforced by the
    // updateAccountSlashingTrackers function. However, The voting contract provides updateTrackersRange which lets
    // anyone provide arbitrary toIndex to apply slashing over. This means that a voter could apply cumulative slashing
    // between votes within the same round, rather than them being linear and independent.

    const identifier = padRight(utf8ToHex("slash-test"), 64); // Use the same identifier for both.
    const time = "420";

    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });
    await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });
    await voting.methods.requestPrice(identifier, time + 1).send({ from: registeredContract });

    await moveToNextRound(voting, accounts[0]);
    const roundId = (await voting.methods.getCurrentRoundId().call()).toString();

    // Account1 votes correctly on both and account4 votes wrong on both.
    // Commit votes.
    const losingPrice = 123;
    const salt = getRandomSignedInt(); // use the same salt for all votes. bad practice but wont impact anything.
    const baseRequest = { salt, roundId, identifier };
    const hash1 = computeVoteHash({ ...baseRequest, price: losingPrice, account: account4, time: time });
    await voting.methods.commitVote(identifier, time, hash1).send({ from: account4 });
    const hash2 = computeVoteHash({ ...baseRequest, price: losingPrice, account: account4, time: time + 1 });
    await voting.methods.commitVote(identifier, time + 1, hash2).send({ from: account4 });

    const winningPrice = 456;
    const hash3 = computeVoteHash({ ...baseRequest, price: winningPrice, account: account1, time: time });
    await voting.methods.commitVote(identifier, time, hash3).send({ from: account1 });
    const hash4 = computeVoteHash({ ...baseRequest, price: winningPrice, account: account1, time: time + 1 });
    await voting.methods.commitVote(identifier, time + 1, hash4).send({ from: account1 });

    await moveToNextPhase(voting, accounts[0]); // Reveal the votes.

    // Reveal the votes.
    await voting.methods.revealVote(identifier, time, losingPrice, salt).send({ from: account4 });
    await voting.methods.revealVote(identifier, time + 1, losingPrice, salt).send({ from: account4 });
    await voting.methods.revealVote(identifier, time, winningPrice, salt).send({ from: account1 });
    await voting.methods.revealVote(identifier, time + 1, winningPrice, salt).send({ from: account1 });

    await moveToNextRound(voting, accounts[0]); // Move to the next round.

    await voting.methods.updateTrackers(account4).send({ from: account1 });

    // Account4 should loose two equal slots of 4mm*0.0016 as they were both within the same voting round.
    assert.equal(
      (await voting.methods.voterStakes(account4).call()).stake,
      toWei("4000000").sub(toWei("6400")).sub(toWei("6400"))
    );

    // Now, apply the slashing trackers in range for account1. As both votes are in the same round and we are partially
    // traversing the round we should not slash the first request and store it within unapplied slashing until both
    // requests have been traversed, at which point both should be applied linearly, as if they were applied at the same time.
    await voting.methods.updateTrackersRange(account1, 1).send({ from: account1 });
    assert.equal((await voting.methods.voterStakes(account1).call()).stake, toWei("32000000"));
    assert.equal((await voting.methods.voterStakes(account1).call()).unappliedSlash, toWei("108800"));
    await voting.methods.updateTrackersRange(account1, 2).send({ from: account1 });
    assert.equal(
      (await voting.methods.voterStakes(account1).call()).stake,
      toWei("32000000").add(toWei("108800").add(toWei("108800")))
    );
    assert.equal((await voting.methods.voterStakes(account1).call()).unappliedSlash, "0");
  });
  it("Rolling interplay with unapplied slashing", async function () {
    // Validate When multiple rounds are rolled and slashing is applied over a range things are applied as expected.

    const identifier = padRight(utf8ToHex("slash-test"), 64); // Use the same identifier for both.
    const time = 420;

    // Make 4 requests. Pass 1 and 4. Roll 2 and 3.
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });
    await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });
    await voting.methods.requestPrice(identifier, time + 1).send({ from: registeredContract });
    await voting.methods.requestPrice(identifier, time + 2).send({ from: registeredContract });
    await voting.methods.requestPrice(identifier, time + 3).send({ from: registeredContract });
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberPendingPriceRequests, 4);

    await moveToNextRound(voting, accounts[0]);
    const roundId = (await voting.methods.getCurrentRoundId().call()).toString();

    // Roll all votes except for request1.
    // Commit votes.
    const price = 123;
    const salt = getRandomSignedInt(); // use the same salt for all votes. bad practice but wont impact anything.
    const baseRequest = { salt, roundId, identifier };
    const hash1 = computeVoteHash({ ...baseRequest, price: price, account: account1, time: time });
    await voting.methods.commitVote(identifier, time, hash1).send({ from: account1 });
    const hash2 = computeVoteHash({ ...baseRequest, price: price, account: account4, time: time + 1 });
    await voting.methods.commitVote(identifier, time + 1, hash2).send({ from: account4 });
    const hash3 = computeVoteHash({ ...baseRequest, price: price, account: account4, time: time + 2 });
    await voting.methods.commitVote(identifier, time + 2, hash3).send({ from: account4 });
    const hash4 = computeVoteHash({ ...baseRequest, price: price, account: account4, time: time + 3 });
    await voting.methods.commitVote(identifier, time + 3, hash4).send({ from: account4 });

    await moveToNextPhase(voting, accounts[0]); // Reveal the votes.

    await voting.methods.revealVote(identifier, time, price, salt).send({ from: account1 });
    await voting.methods.revealVote(identifier, time + 1, price, salt).send({ from: account4 });
    await voting.methods.revealVote(identifier, time + 2, price, salt).send({ from: account4 });
    await voting.methods.revealVote(identifier, time + 3, price, salt).send({ from: account4 });

    // There should be a total of 4 requests, still.
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberPendingPriceRequests, 4);
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberResolvedPriceRequests, 0);

    await moveToNextRound(voting, accounts[0]); // Move to the next round.

    await voting.methods.updateTrackersRange(account4, 1).send({ from: account1 });

    // Account4 should loose one slots of 4mm*0.0016 from not participating in the one vote that settled.
    assert.equal((await voting.methods.voterStakes(account4).call()).stake, toWei("4000000").sub(toWei("6400")));

    // There should now show up as being 4 resolved requests and 3 pending requests.
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberResolvedPriceRequests, 1);
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberPendingPriceRequests, 3);

    // Now, re-commit and reveal on 2 of the rolled requests, this time from account1 so they dont roll. Re-commit and
    // reveal on the last vote with an account that does not meet the gat. this should push 3/4 votes to settled.
    baseRequest.roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    const hash5 = computeVoteHash({ ...baseRequest, price: price, account: account1, time: time + 1 });
    await voting.methods.commitVote(identifier, time + 1, hash5).send({ from: account1 });
    const hash6 = computeVoteHash({ ...baseRequest, price: price, account: account1, time: time + 2 });
    await voting.methods.commitVote(identifier, time + 2, hash6).send({ from: account1 });
    const hash7 = computeVoteHash({ ...baseRequest, price: price, account: account4, time: time + 3 });
    await voting.methods.commitVote(identifier, time + 3, hash7).send({ from: account4 });

    await moveToNextPhase(voting, accounts[0]); // Reveal the votes.
    await voting.methods.revealVote(identifier, time + 1, price, salt).send({ from: account1 });
    await voting.methods.revealVote(identifier, time + 2, price, salt).send({ from: account1 });
    await voting.methods.revealVote(identifier, time + 3, price, salt).send({ from: account4 });

    await moveToNextRound(voting, accounts[0]); // Move to the next round.

    await voting.methods.updateTrackers(account4).send({ from: account1 });

    // We should now expect to see 3 settled requests and one remaining pending request.
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberResolvedPriceRequests, 3);
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberPendingPriceRequests, 1);

    // Account4 should loose two equal slots of (4mm-6400)*0.0016 as they were both within the same voting
    // round and they did not vote on them after the roll.
    assert.equal(
      (await voting.methods.voterStakes(account4).call()).stake,
      toWei("3993600").sub(toWei("6389.76")).sub(toWei("6389.76"))
    );

    // The nextIndexToProcess for account4 should be 3. we've settled 3 of the requests, over which slashing
    // has been applied, one request was rolled once (+1) and the other two requests were rolled the first time (+2).
    assert.equal((await voting.methods.voterStakes(account4).call()).nextIndexToProcess, 3);

    // Now, apply the slashing trackers in range for account1. Account1 should be at the last request index of 1 as it
    // the last call to the update trackers happened after the settlement of the first vote the account participated in.
    // Before applying any further round updates the stakedAmount of account1 their original balance grown by
    // slashing over all other participants as 32mm + 68mm * 0.0016 = 32010880. Account 1
    assert.equal((await voting.methods.voterStakes(account1).call()).nextIndexToProcess, 1);
    assert.equal((await voting.methods.voterStakes(account1).call()).stake, toWei("32000000").add(toWei("108800")));
    assert.equal((await voting.methods.voterStakes(account1).call()).unappliedSlash, toWei("0"));

    // Now, update the trackers piece wise to validate that this still works over multiple discrete rounds. This is the
    // first rolled but settled index. it was settled in the same round as index3 and so we should see it set within the unappliedSlash tracker. Expected unapplied slashing is (68e6-108800)*0.0016 = 108625.92 which is the total amount of
    // all tokens other than account1, minus the first slashing, slashed at 0.0016.
    await voting.methods.updateTrackersRange(account1, 1).send({ from: account1 });
    assert.equal((await voting.methods.voterStakes(account1).call()).nextIndexToProcess, 2);
    assert.equal((await voting.methods.voterStakes(account1).call()).stake, toWei("32000000").add(toWei("108800")));
    assert.equal((await voting.methods.voterStakes(account1).call()).unappliedSlash, toWei("108625.92"));

    // Now, update to request 3 (the final request. we should see 2x the unapplied slasing now applied to the ballance.
    await voting.methods.updateTrackersRange(account1, 1).send({ from: account1 });
    assert.equal((await voting.methods.voterStakes(account1).call()).nextIndexToProcess, 3);
    let expectedStake = toWei("32000000").add(toWei("108800")).add(toWei("108625.92")).add(toWei("108625.92"));
    assert.equal((await voting.methods.voterStakes(account1).call()).stake, expectedStake);

    // As index3 was the last index this should be the same value if we were to update the trackers to the current
    // latest value.
    await voting.methods.updateTrackers(account4).send({ from: account1 });
    assert.equal((await voting.methods.voterStakes(account1).call()).stake, expectedStake);

    // Finally, vote on and slash the last request.
    baseRequest.roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    const hash8 = computeVoteHash({ ...baseRequest, price: price, account: account1, time: time + 3 });
    await voting.methods.commitVote(identifier, time + 3, hash8).send({ from: account1 });
    await moveToNextPhase(voting, accounts[0]); // Reveal the votes.`
    await voting.methods.revealVote(identifier, time + 3, price, salt).send({ from: account1 });

    await moveToNextRound(voting, accounts[0]); // Move to the next round.

    // Apply the final slashing trackers. we should see (68e6-108800-108625.92*2)*0.0016 = 108278.317056 added to the
    // active stake of account1.
    await voting.methods.updateTrackers(account1).send({ from: account1 });
    assert.equal((await voting.methods.voterStakes(account1).call()).nextIndexToProcess, 4);
    assert.equal(
      (await voting.methods.voterStakes(account1).call()).stake,
      toWei("32000000").add(toWei("108800")).add(toWei("108625.92")).add(toWei("108625.92")).add(toWei("108278.317056"))
    );
  });

  it("Discontinuous rolling interplay with unapplied slashing", async function () {
    // Validate When multiple rounds are rolled and slashing is applied over a range things are applied as expected.

    const identifier = padRight(utf8ToHex("slash-test"), 64); // Use the same identifier for both.
    const time = 420;

    // Make 4 requests. Pass 1 and 4. Roll 2 and 3.
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });
    await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });
    await voting.methods.requestPrice(identifier, time + 1).send({ from: registeredContract });
    await voting.methods.requestPrice(identifier, time + 2).send({ from: registeredContract });
    await voting.methods.requestPrice(identifier, time + 3).send({ from: registeredContract });
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberPendingPriceRequests, 4);

    await moveToNextRound(voting, accounts[0]);
    const roundId = (await voting.methods.getCurrentRoundId().call()).toString();

    // Roll all votes except for request1.
    // Commit votes.
    const price = 123;
    const salt = getRandomSignedInt(); // use the same salt for all votes. bad practice but wont impact anything.
    const baseRequest = { salt, roundId, identifier };
    const hash1 = computeVoteHash({ ...baseRequest, price: price, account: account1, time: time });
    await voting.methods.commitVote(identifier, time, hash1).send({ from: account1 });
    const hash2 = computeVoteHash({ ...baseRequest, price: price, account: account4, time: time + 1 });
    await voting.methods.commitVote(identifier, time + 1, hash2).send({ from: account4 });
    const hash3 = computeVoteHash({ ...baseRequest, price: price, account: account4, time: time + 2 });
    await voting.methods.commitVote(identifier, time + 2, hash3).send({ from: account4 });
    const hash4 = computeVoteHash({ ...baseRequest, price: price, account: account1, time: time + 3 });
    await voting.methods.commitVote(identifier, time + 3, hash4).send({ from: account1 });

    await moveToNextPhase(voting, accounts[0]); // Reveal the votes.

    await voting.methods.revealVote(identifier, time, price, salt).send({ from: account1 });
    await voting.methods.revealVote(identifier, time + 1, price, salt).send({ from: account4 });
    await voting.methods.revealVote(identifier, time + 2, price, salt).send({ from: account4 });
    await voting.methods.revealVote(identifier, time + 3, price, salt).send({ from: account1 });

    // There should be a total of 4  pending requests, still.
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberPendingPriceRequests, 4);

    await moveToNextRound(voting, accounts[0]); // Move to the next round.

    // Increment range one-by-one to ensure no compounding of slashing occurs. we can apply for 1 and 2 as these have
    // settled but 3 and 4 have not.
    await voting.methods.updateTrackersRange(account4, 1).send({ from: account1 });
    await voting.methods.updateTrackersRange(account4, 2).send({ from: account1 });

    // Account4 should lose two slots of 4mm*0.0016 from not participating in the two votes that settled.
    // 2 * 4mm * 0.0016 = 12800.
    assert.equal((await voting.methods.voterStakes(account4).call()).stake, toWei("4000000").sub(toWei("12800")));

    // Equally, we should be able to update account2 in one call and their balance should update as expected traversing
    // all requests in one go. They should loose two slots of 32mm*0.0016. 2 * 32mm * 0.0016 = 102400.
    await voting.methods.updateTrackers(account2).send({ from: account1 });
    assert.equal((await voting.methods.voterStakes(account2).call()).stake, toWei("32000000").sub(toWei("102400")));

    // Finally, try partial updates on account3 with interspersed balance checks. Updating request 1 should apply a
    // 51200 negative unapplied slash.
    await voting.methods.updateTrackersRange(account3, 1).send({ from: account1 });
    assert.equal((await voting.methods.voterStakes(account3).call()).stake, toWei("32000000"));
    assert.equal((await voting.methods.voterStakes(account3).call()).unappliedSlash, toWei("-51200"));
    // Round 2 should apply the unapplied slash + the next settled round of 51200. After this, the unapplied slash
    // should go to zero and for all subsequent rounds the slash should be set to 102400 for the two settled rounds.
    await voting.methods.updateTrackersRange(account3, 2).send({ from: account1 });
    assert.equal((await voting.methods.voterStakes(account3).call()).stake, toWei("32000000").sub(toWei("102400")));
    assert.equal((await voting.methods.voterStakes(account3).call()).unappliedSlash, toWei("0"));

    // There are still 2 pending requests and two settled requests after these 2 requests settle.
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberPendingPriceRequests, 2);
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberResolvedPriceRequests, 2);
  });

  it("Duplicate Request Rewards", async function () {
    // We want to test that the slashing mechanism works properly when two consecutive price requests are rolled.
    // To accomplish this, we generate four price requests, the first and fourth of which are voted on and resolved,
    // while p2 and p3 do not receive votes and are thus rolled. Given that all users calling updateTrackers, regardless of order,
    // process the same price requests, the nextIndexToProcess must be the same for all.

    const identifier1 = padRight(utf8ToHex("request-retrieval1"), 64);
    const time1 = "1000";
    const identifier2 = padRight(utf8ToHex("request-retrieval2"), 64);
    const time2 = "2000";
    const identifier3 = padRight(utf8ToHex("request-retrieval3"), 64);
    const time3 = "3000";
    const identifier4 = padRight(utf8ToHex("request-retrieval4"), 64);
    const time4 = "4000";

    // Make the Oracle support these identifiers.
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier1).send({ from: accounts[0] });
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier2).send({ from: accounts[0] });
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier3).send({ from: accounts[0] });
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier4).send({ from: accounts[0] });

    await voting.methods.requestPrice(identifier1, time1).send({ from: registeredContract });
    await voting.methods.requestPrice(identifier2, time2).send({ from: registeredContract });
    await voting.methods.requestPrice(identifier3, time3).send({ from: registeredContract });
    await voting.methods.requestPrice(identifier4, time4).send({ from: registeredContract });

    // Move to the voting round.
    await moveToNextRound(voting, accounts[0]);
    const roundId = (await voting.methods.getCurrentRoundId().call()).toString();

    // Commit vote 1 and 4.
    const price = getRandomSignedInt();
    const salt = getRandomSignedInt();
    const hash4 = computeVoteHash({
      price: price,
      salt: salt,
      account: account1,
      time: time4,
      roundId,
      identifier: identifier4,
    });
    const hash1 = computeVoteHash({
      price: price,
      salt: salt,
      account: account1,
      time: time1,
      roundId,
      identifier: identifier1,
    });

    await voting.methods.commitVote(identifier4, time4, hash4).send({ from: account1 });
    await voting.methods.commitVote(identifier1, time1, hash1).send({ from: account1 });

    // Move to the reveal phase of the voting period.
    await moveToNextPhase(voting, account1);

    // Reveal vote.
    await voting.methods.revealVote(identifier4, time4, price, salt).send({ from: account1 });
    await voting.methods.revealVote(identifier1, time1, price, salt).send({ from: account1 });

    await moveToNextRound(voting, account1);

    assert.isTrue(await voting.methods.hasPrice(identifier4, time4).call({ from: registeredContract }));
    assert.isTrue(await voting.methods.hasPrice(identifier1, time1).call({ from: registeredContract }));
    assert.isFalse(await voting.methods.hasPrice(identifier2, time2).call({ from: registeredContract }));
    assert.isFalse(await voting.methods.hasPrice(identifier3, time3).call({ from: registeredContract }));

    assert.equal(
      (await voting.methods.getPrice(identifier4, time4).call({ from: registeredContract })).toString(),
      price.toString()
    );
    assert.equal(
      (await voting.methods.getPrice(identifier1, time1).call({ from: registeredContract })).toString(),
      price.toString()
    );

    await voting.methods.updateTrackers(account1).send({ from: account1 });
    await voting.methods.updateTrackers(account2).send({ from: account1 });

    // Both users should have the same nextIndexToProcess.
    assert.equal((await voting.methods.voterStakes(account1).call()).nextIndexToProcess, 2);
    assert.equal((await voting.methods.voterStakes(account2).call()).nextIndexToProcess, 2);
  });

  it("Inactive user's must be slashed", async function () {
    // In this test, a user stakes during an activeReveal phase, does not vote in several priceRequests
    // in successive rounds, and his stake remains inactive throughout, preventing him from being slashed.
    // The user receives the initial staked sum as well as the rewards for the constant emission rate at the end.

    const identifier = padRight(utf8ToHex("test"), 64);
    const time = "1000";
    const time2 = "1001";

    const randStakingAmount = toWei("4000000");

    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });

    await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });

    await votingToken.methods.mint(rand, toWei("3200000000")).send({ from: accounts[0] });
    await votingToken.methods.approve(voting.options.address, toWei("3200000000")).send({ from: rand });

    await moveToNextRound(voting, accounts[0]);
    await moveToNextPhase(voting, accounts[0]);

    assert.equal(await voting.methods.getVotePhase().call(), 1);
    assert.equal(await voting.methods.currentActiveRequests().call(), true);

    // User stakes during active reveal so his staked amount is "inactive"
    await voting.methods.stake(randStakingAmount).send({ from: rand });

    await moveToNextRound(voting, accounts[0]);

    // Check that amount is 0 and pendingStake equals the initial staked amount
    assert.equal((await voting.methods.voterStakes(rand).call()).stake, randStakingAmount);

    let roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    const salt = getRandomSignedInt();

    const price = 0;
    const hash2 = computeVoteHash({ salt, roundId, identifier, price, account: account1, time });
    await voting.methods.commitVote(identifier, time, hash2).send({ from: account1 });

    await moveToNextPhase(voting, accounts[0]); // Reveal the votes.
    await voting.methods.revealVote(identifier, time, price, salt).send({ from: account1 });

    // Create a second price request
    await voting.methods.requestPrice(identifier, time2).send({ from: registeredContract });

    await moveToNextRound(voting, accounts[0]);
    await moveToNextPhase(voting, accounts[0]);

    // First price request is resolved. User rand didn't vote.
    assert.equal(
      (await voting.methods.getPrice(identifier, time).call({ from: registeredContract })).toString(),
      price.toString()
    );

    assert.equal(await voting.methods.getVotePhase().call(), 1);
    assert.equal(await voting.methods.currentActiveRequests().call(), true);

    await voting.methods.updateTrackers(account1).send({ from: account1 });
    await voting.methods.updateTrackers(account2).send({ from: account1 });
    await voting.methods.updateTrackers(account3).send({ from: account1 });
    await voting.methods.updateTrackers(account4).send({ from: account1 });
    await voting.methods.updateTrackers(rand).send({ from: account1 });

    await moveToNextPhase(voting, accounts[0]);
    roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    const hash3 = computeVoteHash({ salt, roundId, identifier, price, account: account1, time: time2 });

    await voting.methods.commitVote(identifier, time2, hash3).send({ from: account1 });

    await moveToNextPhase(voting, accounts[0]); // Reveal the votes.
    await voting.methods.revealVote(identifier, time2, price, salt).send({ from: account1 });

    await moveToNextRound(voting, accounts[0]);
    // await moveToNextPhase(voting, accounts[0]);

    // New price request is resolved. User rand has not voted in this one either
    assert.equal(
      (await voting.methods.getPrice(identifier, time2).call({ from: registeredContract })).toString(),
      price.toString()
    );

    const events = await voting.getPastEvents("VoterSlashApplied", { fromBlock: 0, toBlock: "latest" });

    const sum = events.map((e) => Number(web3.utils.fromWei(e.returnValues.slashedTokens))).reduce((a, b) => a + b, 0);

    assert(sum === 0, "Slashing calculation problem");

    // Rand user has been slashed
    assert(toBN((await voting.methods.voterStakes(rand).call()).stake).lt(toBN(randStakingAmount)));

    await moveToNextRound(voting, accounts[0]);
    assert.equal(await voting.methods.getVotePhase().call(), 0);

    await voting.methods.updateTrackers(rand).send({ from: account1 });

    // Rand user has been slashed
    assert(toBN((await voting.methods.voterStakes(rand).call()).stake).lt(toBN(randStakingAmount)));

    await voting.methods.setUnstakeCoolDown(0).send({ from: account1 });
    await voting.methods.requestUnstake((await voting.methods.voterStakes(rand).call()).stake).send({ from: rand });

    const balanceBefore = await votingToken.methods.balanceOf(rand).call();
    await voting.methods.executeUnstake().send({ from: rand });
    const balanceAfter = await votingToken.methods.balanceOf(rand).call();

    // Rand has been slashed
    assert(toBN(balanceAfter).sub(toBN(balanceBefore)).lt(toBN(randStakingAmount)));

    const outstandingRewards = await voting.methods.outstandingRewards(rand).call();

    assert(toBN(outstandingRewards).gt(toBN("0")));
    const balanceBefore2 = await votingToken.methods.balanceOf(rand).call();
    await voting.methods.withdrawRewards().send({ from: rand });
    const balanceAfter2 = await votingToken.methods.balanceOf(rand).call();

    // Rand receives the rewards
    assert(toBN(balanceAfter2).eq(toBN(balanceBefore2).add(toBN(outstandingRewards))));
  });
  it("Staking after a price request should work", async function () {
    // While testing the voting contract on Goerli, we found a very specific situation that cases price requests to
    // become unresolvable. If: a) a price request is made, b) the request rolls c) the only participant who votes on
    // the request was not staked before the request AND they staked during the reveal phase post roll then the request
    //  becomes unresolvable. If the request rolls again and someone who was staked before the request participates in
    // the vote then it again becomes resolvable. This test would fail if the fix was not implemented in the contract.
    await addNonSlashingVote(); // increment the starting index of the test by 1, without applying any slashing.
    const identifier = padRight(utf8ToHex("governance-price-request"), 64); // Use the same identifier for both.
    const time = "420";
    const ancillaryData = web3.utils.randomHex(420);

    await voting.methods.requestGovernanceAction(identifier, time, ancillaryData).send({ from: accounts[0] });

    await votingToken.methods.mint(rand, toWei("3200000000")).send({ from: accounts[0] });
    await votingToken.methods.approve(voting.options.address, toWei("3200000000")).send({ from: rand });

    // The next two lines are critical: the vote needs to both be rolled and the only participate in the vote must
    // stake in the reveal phase (which is now "active").
    await moveToNextRound(voting, accounts[0]);
    await moveToNextPhase(voting, accounts[0]);

    await voting.methods.stake(toWei("32000000")).send({ from: rand });

    // This raises the cumulative stake to 132M so we need to lower the SPAT to 20% to allow a voter with 32M to reach
    // the threshold.
    await voting.methods.setGatAndSpat(toWei("5"), toWei("0.2")).send({ from: accounts[0] });

    await moveToNextRound(voting, accounts[0]);

    let roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    let salt = getRandomSignedInt();
    let price = 1;
    let hash = computeVoteHashAncillary({ salt, roundId, identifier, price, account: rand, time, ancillaryData });
    await voting.methods.commitVote(identifier, time, ancillaryData, hash).send({ from: rand });
    await moveToNextPhase(voting, accounts[0]); // Reveal the votes.
    await voting.methods.revealVote(identifier, time, price, ancillaryData, salt).send({ from: rand });

    // Verify the round's cumulativeStakeAtRound contains the new staker's now active liquidity.
    assert.equal((await voting.methods.rounds(roundId).call()).cumulativeStakeAtRound, toWei("132000000"));

    await moveToNextRound(voting, accounts[0]);

    // If the fix is not implemented then this call will revert as the request, even though voted on correctly, is
    // unsealable. If the fix works then this should pass.
    assert.equal(
      (await voting.methods.getPrice(identifier, time, ancillaryData).call({ from: registeredContract })).toString(),
      price.toString()
    );

    // Similarly there is a follow on edge case we should verify: if you stake during an active
    // reveal, the vote is rolled and then you vote your nextIndexToProcess will be higher than the request index
    // you are voting on! This means that the slashing trackers will incorrectly skip you, resulting in misallocation
    // of slashing. The assertions below will fail if the fix was not implemented correctly in the contract.
    await voting.methods.setUnstakeCoolDown(0).send({ from: account1 });

    await voting.methods
      .requestUnstake(await voting.methods.getVoterStakePostUpdate(account1).call())
      .send({ from: account1 });

    await voting.methods
      .requestUnstake(await voting.methods.getVoterStakePostUpdate(account2).call())
      .send({ from: account2 });

    await voting.methods
      .requestUnstake(await voting.methods.getVoterStakePostUpdate(account3).call())
      .send({ from: account3 });

    await voting.methods
      .requestUnstake(await voting.methods.getVoterStakePostUpdate(account4).call())
      .send({ from: account4 });

    // Unstake from all accounts. Accounts 1,2,3,4 should all loose 0.0016 of their balance due to the one round of
    // slashing and rand should gain the sum of the other four, as 100mm*0.0016.
    await voting.methods.requestUnstake(await voting.methods.getVoterStakePostUpdate(rand).call()).send({ from: rand });
    await voting.methods.executeUnstake().send({ from: account1 });
    assert.equal(await votingToken.methods.balanceOf(account1).call(), toWei("31948800")); // 32mm*(1-0.0016)=31948800
    await voting.methods.executeUnstake().send({ from: account2 });
    assert.equal(await votingToken.methods.balanceOf(account2).call(), toWei("31948800")); // 32mm*(1-0.0016)=31948800
    await voting.methods.executeUnstake().send({ from: account3 });
    assert.equal(await votingToken.methods.balanceOf(account3).call(), toWei("31948800")); // 32mm*(1-0.0016)=31948800
    await voting.methods.executeUnstake().send({ from: account4 });
    assert.equal(await votingToken.methods.balanceOf(account4).call(), toWei("3993600")); // 4mm*(1-0.0016)=3993600

    // If the contract does not correctly update the rand (deposit after request but before rolled) nextIndexToProcess
    // the below two assertions will fail.
    await voting.methods.executeUnstake().send({ from: rand });
    assert.equal(await votingToken.methods.balanceOf(rand).call(), toWei("3200160000")); // 32mm+100mm*0.0016=3200160000

    // After unstaking all positions the total balance left in the voting contract should be 0.
    assert.equal(await votingToken.methods.balanceOf(voting.options.address).call(), "0");

    // Lastly, sum of all slashing events should add to zero (positive slashing summed should equal negative slash).
    const events = await voting.getPastEvents("VoterSlashApplied", { fromBlock: 0, toBlock: "latest" });
    const sum = events.map((e) => Number(web3.utils.fromWei(e.returnValues.slashedTokens))).reduce((a, b) => a + b, 0);
    assert.equal(sum, 0);
  });
  it("Interplay between multiple voters and staking during active reveal", async function () {
    // This is a subset of the previous test where in we can see the interplay between multiple voters and staking
    // where one staker stakes during an active reveal, the vote is rolled and they are then excluded from slashing.
    // As before, if the contract does not correctly handel this situation the test will fail.
    await addNonSlashingVote(); // increment the starting index of the test by 1, without applying any slashing.
    const identifier = padRight(utf8ToHex("test"), 64);
    const time = "1000";

    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });
    await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });

    // Move into the next round so voting can begin and place us in the active reveal. Check this is the case.
    await moveToNextRound(voting, accounts[0]);
    await moveToNextPhase(voting, accounts[0]);
    assert.equal(await voting.methods.getVotePhase().call(), 1);
    assert.equal(await voting.methods.currentActiveRequests().call(), true);

    // Stake in the active reveal. this will set our nextIndexToProcess to 1.
    await votingToken.methods.mint(rand, toWei("4000000")).send({ from: accounts[0] });
    await votingToken.methods.approve(voting.options.address, toWei("4000000")).send({ from: rand });
    await voting.methods.stake(toWei("4000000")).send({ from: rand });

    // To enable this voter to vote on this round we MUST roll to the next round as we are in a reveal phase and you
    // cant commit in a reveal phase.
    await moveToNextRound(voting, accounts[0]);

    // Now, the staker liquidity has become activated (we are no longer in an active reveal phase) due to the roll.
    // nextIndexToProcess == 1, so rand won't be slashed for price request 0
    // assert.equal((await voting.methods.voterStakes(rand).call()).nextIndexToProcess, "2");

    const roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    const salt = getRandomSignedInt();

    const price2 = 0;
    const hash2 = computeVoteHash({ salt, roundId, identifier, price: price2, account: account1, time });
    await voting.methods.commitVote(identifier, time, hash2).send({ from: account1 });

    const price = 1;
    const hash = computeVoteHash({ salt, roundId, identifier, price, account: rand, time });
    await voting.methods.commitVote(identifier, time, hash).send({ from: rand });

    await moveToNextPhase(voting, accounts[0]); // Reveal the votes.
    await voting.methods.revealVote(identifier, time, price2, salt).send({ from: account1 });
    await voting.methods.revealVote(identifier, time, price, salt).send({ from: rand });

    await moveToNextRound(voting, accounts[0]);

    // Price2 is resolved, meaning that rand voted so he should be slashed
    assert.equal(
      (await voting.methods.getPrice(identifier, time).call({ from: registeredContract })).toString(),
      price2.toString()
    );

    // Expect that all accounts should be slashed, including rand who staked during the active reveal, except account1
    // who correctly settled the vote. The total staked UMA at the time of this vote was 104mm, of which 32mm voted
    // correctly with 72mm voting wrong or not voting.
    await voting.methods.updateTrackers(account1).send({ from: account1 });

    assert.equal((await voting.methods.voterStakes(account1).call()).stake, toWei("32115200")); // 32mm+72mm*0.0016=32115200
    await voting.methods.updateTrackers(account2).send({ from: account1 });
    assert.equal((await voting.methods.voterStakes(account2).call()).stake, toWei("31948800")); // 32mm*(1-0.0016)=31948800
    await voting.methods.updateTrackers(account3).send({ from: account1 });
    assert.equal((await voting.methods.voterStakes(account3).call()).stake, toWei("31948800")); // 32mm*(1-0.0016)=31948800
    await voting.methods.updateTrackers(account4).send({ from: account1 });
    assert.equal((await voting.methods.voterStakes(account4).call()).stake, toWei("3993600")); // 4mm*(1-0.0016)=3993600

    // The call below will fail if slashing was not correctly appled to rand, who staked during the active reveal pre-roll.
    await voting.methods.updateTrackers(rand).send({ from: account1 });
    assert.equal((await voting.methods.voterStakes(rand).call()).stake, toWei("3993600")); // 4mm*(1-0.0016)=3993600

    const events = await voting.getPastEvents("VoterSlashApplied", { fromBlock: 0, toBlock: "latest" });
    const sum = events.map((e) => Number(web3.utils.fromWei(e.returnValues.slashedTokens))).reduce((a, b) => a + b, 0);
    assert.equal(sum, 0);

    await voting.methods.setUnstakeCoolDown(0).send({ from: account1 });
    await voting.methods
      .requestUnstake((await voting.methods.voterStakes(account1).call()).stake)
      .send({ from: account1 });
    await voting.methods
      .requestUnstake((await voting.methods.voterStakes(account2).call()).stake)
      .send({ from: account2 });
    await voting.methods
      .requestUnstake((await voting.methods.voterStakes(account3).call()).stake)
      .send({ from: account3 });
    await voting.methods
      .requestUnstake((await voting.methods.voterStakes(account4).call()).stake)
      .send({ from: account4 });
    await voting.methods.requestUnstake((await voting.methods.voterStakes(rand).call()).stake).send({ from: rand });

    await voting.methods.executeUnstake().send({ from: account1 });
    await voting.methods.executeUnstake().send({ from: account2 });
    await voting.methods.executeUnstake().send({ from: account3 });
    await voting.methods.executeUnstake().send({ from: account4 });
    await voting.methods.executeUnstake().send({ from: rand });

    const finalContractBalance = await votingToken.methods.balanceOf(voting.options.address).call();
    assert.equal(finalContractBalance, "0");
  });
  it("Roll right after request", async function () {
    // Validate that a request can roll multiple times without any participation by any voters.
    await addNonSlashingVote(); // increment the starting index of the test by 1, without applying any slashing.
    const identifier = padRight(utf8ToHex("test"), 64);
    const time = "1000";
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });
    await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });

    await moveToNextRound(voting, accounts[0]);
    await moveToNextRound(voting, accounts[0]);

    const roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    const salt = getRandomSignedInt();
    const price = 0;
    const hash2 = computeVoteHash({ salt, roundId, identifier, price, account: account1, time });
    await voting.methods.commitVote(identifier, time, hash2).send({ from: account1 });

    await moveToNextPhase(voting, accounts[0]); // Reveal the votes.
    await voting.methods.revealVote(identifier, time, price, salt).send({ from: account1 });

    await moveToNextRound(voting, accounts[0]);

    assert.equal(
      (await voting.methods.getPrice(identifier, time).call({ from: registeredContract })).toString(),
      price.toString()
    );

    // Expect that all accounts should be slashed
    await voting.methods.updateTrackers(account1).send({ from: account1 });
    assert.equal((await voting.methods.voterStakes(account1).call()).stake, toWei("32108800")); // 32mm+68mm*0.0016=32108800
    await voting.methods.updateTrackers(account2).send({ from: account1 });
    assert.equal((await voting.methods.voterStakes(account2).call()).stake, toWei("31948800")); // 32mm*(1-0.0016)=31948800
    await voting.methods.updateTrackers(account3).send({ from: account1 });
    assert.equal((await voting.methods.voterStakes(account3).call()).stake, toWei("31948800")); // 32mm*(1-0.0016)=31948800
    await voting.methods.updateTrackers(account4).send({ from: account1 });
    assert.equal((await voting.methods.voterStakes(account4).call()).stake, toWei("3993600")); // 4mm*(1-0.0016)=3993600

    const events = await voting.getPastEvents("VoterSlashApplied", { fromBlock: 0, toBlock: "latest" });
    const sum = events.map((e) => Number(web3.utils.fromWei(e.returnValues.slashedTokens))).reduce((a, b) => a + b, 0);
    assert.equal(sum, 0);

    await voting.methods.setUnstakeCoolDown(0).send({ from: account1 });
    await voting.methods
      .requestUnstake((await voting.methods.voterStakes(account1).call()).stake)
      .send({ from: account1 });
    await voting.methods
      .requestUnstake((await voting.methods.voterStakes(account2).call()).stake)
      .send({ from: account2 });
    await voting.methods
      .requestUnstake((await voting.methods.voterStakes(account3).call()).stake)
      .send({ from: account3 });
    await voting.methods
      .requestUnstake((await voting.methods.voterStakes(account4).call()).stake)
      .send({ from: account4 });

    await voting.methods.executeUnstake().send({ from: account1 });
    await voting.methods.executeUnstake().send({ from: account2 });
    await voting.methods.executeUnstake().send({ from: account3 });
    await voting.methods.executeUnstake().send({ from: account4 });

    const finalContractBalance = await votingToken.methods.balanceOf(voting.options.address).call();
    assert.equal(finalContractBalance, "0");
  });
  it("Roll tracker updates as expected after request", async function () {
    const identifier = padRight(utf8ToHex("test"), 64);
    const time = "1000";

    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });
    await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });

    let requestRound = Number(await voting.methods.getCurrentRoundId().call());

    // We should expect the lastVotingRound to be the next round (the round the request is voted on).
    let statuses = await voting.methods.getPriceRequestStatuses([{ identifier, time }]).call();
    assert.equal(statuses[0].lastVotingRound.toString(), requestRound + 1);

    // If we call processResolvablePriceRequests this should not change as it's for the next round.
    await voting.methods.processResolvablePriceRequests().send({ from: accounts[0] });
    statuses = await voting.methods.getPriceRequestStatuses([{ identifier, time }]).call();
    assert.equal(statuses[0].lastVotingRound.toString(), requestRound + 1);

    // Move to the next round so we can vote on this. Again, calling processResolvablePriceRequests should not change
    // the lastVotingRound as we are currently in the voting round.
    await moveToNextRound(voting, accounts[0]);
    await voting.methods.processResolvablePriceRequests().send({ from: accounts[0] });
    statuses = await voting.methods.getPriceRequestStatuses([{ identifier, time }]).call();
    assert.equal(statuses[0].lastVotingRound.toString(), requestRound + 1);

    // Move to the next round without voting on this. This time, when we resolve resolvable price requests we should
    // see the lastVotingRound update to the current round.
    await moveToNextRound(voting, accounts[0]);
    await voting.methods.processResolvablePriceRequests().send({ from: accounts[0] });
    statuses = await voting.methods.getPriceRequestStatuses([{ identifier, time }]).call();
    assert.equal(statuses[0].lastVotingRound.toString(), requestRound + 2);

    // Now, let's vote on this request and ensure that once settled it does not further increment the lastVotingRound.
    const voteRoundId = (await voting.methods.getCurrentRoundId().call()).toString();
    const salt = getRandomSignedInt();
    const price2 = 0;
    const hash2 = computeVoteHash({ salt, roundId: voteRoundId, identifier, price: price2, account: account1, time });
    await voting.methods.commitVote(identifier, time, hash2).send({ from: account1 });
    await moveToNextPhase(voting, accounts[0]); // Reveal the votes.
    await voting.methods.revealVote(identifier, time, price2, salt).send({ from: account1 });

    // No changes made at this point.
    await voting.methods.processResolvablePriceRequests().send({ from: accounts[0] });
    statuses = await voting.methods.getPriceRequestStatuses([{ identifier, time }]).call();
    assert.equal(statuses[0].lastVotingRound.toString(), requestRound + 2);

    // Move to the next round and resolve the price request. This should not change the lastVotingRound as we are settled.
    await moveToNextRound(voting, accounts[0]);
    await voting.methods.processResolvablePriceRequests().send({ from: accounts[0] });
    statuses = await voting.methods.getPriceRequestStatuses([{ identifier, time }]).call();
    assert.equal(statuses[0].status.toString(), "2"); // status should be 2 for settled.
    assert.equal(statuses[0].lastVotingRound.toString(), requestRound + 2);

    // Equally, if we move to the next round and then call processResolvablePriceRequests, it should not change the value.
    await moveToNextRound(voting, accounts[0]);
    await voting.methods.processResolvablePriceRequests().send({ from: accounts[0] });
    statuses = await voting.methods.getPriceRequestStatuses([{ identifier, time }]).call();
    assert.equal(statuses[0].lastVotingRound.toString(), requestRound + 2);
  });
  it("Request order is respected", async function () {
    const identifier = padRight(utf8ToHex("test"), 64);
    const time = "1000";
    // Verify that the order of requests is respected as they move between the pending and settled arrays.
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });
    await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });
    await voting.methods.requestPrice(identifier, time + 1).send({ from: registeredContract });
    await voting.methods.requestPrice(identifier, time + 2).send({ from: registeredContract });
    await voting.methods.requestPrice(identifier, time + 3).send({ from: registeredContract });
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberPendingPriceRequests, 4);
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberResolvedPriceRequests, 0);

    // Roll request 2 and 3. Settle request 1 and 4. We should see the order respected when settled.
    await moveToNextRound(voting, accounts[0]);
    const price = 123;
    const salt = getRandomSignedInt(); // use the same salt for all votes. bad practice but wont impact anything.
    let roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    let baseRequest = { salt, roundId, identifier };
    const hash1 = computeVoteHash({ ...baseRequest, price: price, account: account1, time: time });
    await voting.methods.commitVote(identifier, time, hash1).send({ from: account1 });
    const hash2 = computeVoteHash({ ...baseRequest, price: price, account: account4, time: time + 1 });
    await voting.methods.commitVote(identifier, time + 1, hash2).send({ from: account4 });
    const hash3 = computeVoteHash({ ...baseRequest, price: price, account: account4, time: time + 2 });
    await voting.methods.commitVote(identifier, time + 2, hash3).send({ from: account4 });
    const hash4 = computeVoteHash({ ...baseRequest, price: price, account: account1, time: time + 3 });
    await voting.methods.commitVote(identifier, time + 3, hash4).send({ from: account1 });

    await moveToNextPhase(voting, accounts[0]); // Reveal the votes.

    await voting.methods.revealVote(identifier, time, price, salt).send({ from: account1 });
    await voting.methods.revealVote(identifier, time + 1, price, salt).send({ from: account4 });
    await voting.methods.revealVote(identifier, time + 2, price, salt).send({ from: account4 });
    await voting.methods.revealVote(identifier, time + 3, price, salt).send({ from: account1 });

    await moveToNextRound(voting, accounts[0]);
    await voting.methods.processResolvablePriceRequests().send({ from: accounts[0] });
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberPendingPriceRequests, 2);
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberResolvedPriceRequests, 2);

    // Check slot 0 in the resolved array is the first request (based on time of the request).
    const resolvedRequest1Id = await voting.methods.resolvedPriceRequestIds(0).call();
    assert.equal((await voting.methods.priceRequests(resolvedRequest1Id).call()).time, time);

    // Check slot 1 in the resolved array is the fourth request (based on time of the request).
    const resolvedRequest2Id = await voting.methods.resolvedPriceRequestIds(1).call();
    assert.equal((await voting.methods.priceRequests(resolvedRequest2Id).call()).time, time + 3);

    // Now, move to the next round and settle the remaining two requests. We should see the order respected when settled.

    await moveToNextRound(voting, accounts[0]);
    roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    baseRequest = { salt, roundId, identifier };
    const hash5 = computeVoteHash({ ...baseRequest, price: price, account: account1, time: time + 1 });
    await voting.methods.commitVote(identifier, time + 1, hash5).send({ from: account1 });
    const hash6 = computeVoteHash({ ...baseRequest, price: price, account: account1, time: time + 2 });
    await voting.methods.commitVote(identifier, time + 2, hash6).send({ from: account1 });

    await moveToNextPhase(voting, accounts[0]); // Reveal the votes.
    await voting.methods.revealVote(identifier, time + 1, price, salt).send({ from: account1 });
    await voting.methods.revealVote(identifier, time + 2, price, salt).send({ from: account1 });

    await moveToNextRound(voting, accounts[0]);
    await voting.methods.processResolvablePriceRequests().send({ from: accounts[0] });
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberPendingPriceRequests, 0);
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberResolvedPriceRequests, 4);
  });
  it("Requests are automatically removed after a fixed number of rolls", async function () {
    // Verify that if a request rolls enough times (to hit maxRolls) it is automatically removed from the
    // pending requests array and becomes unresolvable.
    const identifier = padRight(utf8ToHex("test"), 64);
    const time = "1000";
    // Verify that the order of requests is respected as they move between the pending and settled arrays.
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });

    await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });
    await voting.methods.requestPrice(identifier, time + 1).send({ from: registeredContract });
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberPendingPriceRequests, 2);
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberResolvedPriceRequests, 0);

    const request1Id = await voting.methods.pendingPriceRequestsIds(0).call();
    const request2Id = await voting.methods.pendingPriceRequestsIds(1).call();

    // First, verify that the roll counter increments as expected as requests roll.

    // Within the first active commit the roll counter should be 0.
    await moveToNextRound(voting, accounts[0]);
    await voting.methods.processResolvablePriceRequests().send({ from: accounts[0] });
    assert.equal((await voting.methods.priceRequests(request1Id).call()).rollCount, 0);
    assert.equal((await voting.methods.priceRequests(request2Id).call()).rollCount, 0);

    // Now, roll the votes by moving to the next round. We should see the roll count increment.
    await moveToNextRound(voting, accounts[0]);
    await voting.methods.processResolvablePriceRequests().send({ from: accounts[0] });
    assert.equal((await voting.methods.priceRequests(request1Id).call()).rollCount, 1);
    assert.equal((await voting.methods.priceRequests(request2Id).call()).rollCount, 1);

    // Now, roll the votes up to the maxRolls. This is set to 3 by default
    await moveToNextRound(voting, accounts[0]);
    await voting.methods.processResolvablePriceRequests().send({ from: accounts[0] });
    assert.equal((await voting.methods.priceRequests(request1Id).call()).rollCount, 2);
    assert.equal((await voting.methods.priceRequests(request2Id).call()).rollCount, 2);

    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberPendingPriceRequests, 2);
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberResolvedPriceRequests, 0);

    // On the next roll these requests should be automatically removed from the pending array and become unresolvable.
    await moveToNextRound(voting, accounts[0]);
    await voting.methods.processResolvablePriceRequests().send({ from: accounts[0] });

    // Both requests should be deleted now. First, check events content and count. Then, check the state is purged.
    // Lastly, check the arrays were updated correctly.
    const events = await voting.getPastEvents("RequestDeleted", { fromBlock: 0, toBlock: "latest" });
    assert.equal(events.length, 2);
    assert.equal(events[0].returnValues.identifier, identifier);
    assert.equal(events[0].returnValues.time, time);
    assert.equal(events[1].returnValues.identifier, identifier);
    assert.equal(events[1].returnValues.time, time + 1);

    const spamRequest1 = await voting.methods.priceRequests(request1Id).call();
    const spamRequest2 = await voting.methods.priceRequests(request2Id).call();
    assert.equal(spamRequest1.lastVotingRound, "0");
    assert.isFalse(spamRequest1.isGovernance);
    assert.equal(spamRequest1.time, "0");
    assert.equal(spamRequest1.identifier, padRight(utf8ToHex(""), 64));
    assert.isNull(spamRequest1.ancillaryData);
    assert.equal(spamRequest2.lastVotingRound, "0");
    assert.isFalse(spamRequest2.isGovernance);
    assert.equal(spamRequest2.time, "0");
    assert.equal(spamRequest2.identifier, padRight(utf8ToHex(""), 64));
    assert.isNull(spamRequest2.ancillaryData);

    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberPendingPriceRequests, 0);
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberResolvedPriceRequests, 0);
  });
  it("Request to be deleted can be re-requested only after processing resolvable price requests", async function () {
    // Verify that if a request rolls enough times (to hit maxRolls) it is automatically removed from the
    // pending requests array and becomes unresolvable.
    const identifier = padRight(utf8ToHex("test"), 64);
    const time = "1000";
    // Verify that the order of requests is respected as they move between the pending and settled arrays.
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });

    await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberPendingPriceRequests, 1);
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberResolvedPriceRequests, 0);

    // Within the first active commit the roll counter should be 0.
    await moveToNextRound(voting, accounts[0]);
    await moveToNextRound(voting, accounts[0]);
    await moveToNextRound(voting, accounts[0]);

    assert.equal((await voting.methods.getPendingRequests().call())[0].rollCount, 2);

    assert.equal((await voting.methods.getPriceRequestStatuses([{ identifier, time }]).call())[0].status, "1");

    await moveToNextRound(voting, accounts[0]);

    assert.equal((await voting.methods.getPendingRequests().call()).length, 0);
    assert.equal((await voting.methods.getPriceRequestStatuses([{ identifier, time }]).call())[0].status, "4");

    assert(
      await didContractRevertWith(
        voting.methods.getPrice(identifier, time).send({ from: registeredContract }),
        "Price will be deleted"
      )
    );

    let result = await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });
    await assertEventNotEmitted(result, voting, "RequestAdded");

    await voting.methods.processResolvablePriceRequests().send({ from: accounts[0] });

    const currentRoundId = await voting.methods.getCurrentRoundId().call();
    result = await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });
    await assertEventEmitted(result, voting, "RequestAdded", (ev) => {
      return (
        // The vote is added to the next round, so we have to add 1 to the current round id.
        ev.roundId.toString() == toBN(currentRoundId).addn(1).toString() &&
        web3.utils.hexToUtf8(ev.identifier) == web3.utils.hexToUtf8(identifier) &&
        ev.time.toString() == time.toString()
      );
    });

    await moveToNextRound(voting, accounts[0]);

    assert.equal((await voting.methods.getPendingRequests().call()).length, 1);
    assert.equal((await voting.methods.getPendingRequests().call())[0].rollCount, 0);

    assert(
      await didContractRevertWith(
        voting.methods.getPrice(identifier, time).send({ from: registeredContract }),
        "Current voting round not ended"
      )
    );
  });
  it("Handles calling settle during reveal", async function () {
    // In the event that someone calls processResolvablePriceRequests() during the reveal phase, after a vote has reached
    // the gat but before the end of the round.
    const identifier = padRight(utf8ToHex("slash-test"), 64);
    const time = 420;

    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });
    await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });

    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberPendingPriceRequests, 1);

    await moveToNextRound(voting, accounts[0]);
    const roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    const price = 123;
    const salt = getRandomSignedInt(); // use the same salt for all votes. bad practice but wont impact anything.
    const baseRequest = { salt, roundId, identifier };
    const hash1 = computeVoteHash({ ...baseRequest, price: price, account: account1, time: time });
    await voting.methods.commitVote(identifier, time, hash1).send({ from: account1 });
    await moveToNextPhase(voting, accounts[0]); // Reveal the votes.
    await voting.methods.revealVote(identifier, time, price, salt).send({ from: account1 });

    // We are now in the reveal phase with the vote having met the gat. If someone tries to settle the request now
    // nothing should happen as the round is not over yet, even though the gat has been met.
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberPendingPriceRequests, 1);
    await voting.methods.processResolvablePriceRequests().send({ from: accounts[0] });
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberPendingPriceRequests, 1);
  });
  it("Handles multiple rolls with no contract interactions", async function () {
    // Consider the case where a vote rolls for a number of rounds with no voter interaction with the voting contract to
    // resolve votes. Even in this case rolling trackers should update as expected.
    const identifier = padRight(utf8ToHex("test"), 64);
    const time = "1000";
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });
    await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });
    await voting.methods.requestPrice(identifier, time + 1).send({ from: registeredContract });
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberPendingPriceRequests, 2);
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberResolvedPriceRequests, 0);

    const request1Id = await voting.methods.pendingPriceRequestsIds(0).call();
    const request2Id = await voting.methods.pendingPriceRequestsIds(1).call();

    // Within the first active commit the roll counter should be 0.
    await moveToNextRound(voting, accounts[0]);
    assert.equal((await voting.methods.priceRequests(request1Id).call()).rollCount, 0);
    assert.equal((await voting.methods.priceRequests(request2Id).call()).rollCount, 0);

    // Now, roll two rounds forward. in neither round call processResolvablePriceRequests. The roll counter should still
    // be 0. Only after updating call it should we see both jump to 2.

    await moveToNextRound(voting, accounts[0]);
    await moveToNextRound(voting, accounts[0]);
    assert.equal((await voting.methods.priceRequests(request1Id).call()).rollCount, 0);
    assert.equal((await voting.methods.priceRequests(request2Id).call()).rollCount, 0);
    await voting.methods.processResolvablePriceRequests().send({ from: accounts[0] });
    assert.equal((await voting.methods.priceRequests(request1Id).call()).rollCount, 2);
    assert.equal((await voting.methods.priceRequests(request2Id).call()).rollCount, 2);
  });
  it("Sequential interactions with processResolvablePriceRequests do not re-traverse pending requests", async function () {
    // Resolve resolvable price requests requires, in the worst case, to loop over all pending price requests. This is
    // an action that only needs to be done by the first account to interact with the voting contracts within a given
    // round. We can show this is the case by submitting a large number of requests (30) and then looking at the gas used
    // between the first and second caller.

    await submitManyRequests(1, 30); // send 30 requests within 1 multical tx.

    await moveToNextRound(voting, accounts[0]);

    // look at the gas used to resolve the 30 requests. a second call should use a fraction of this gas.

    let gasUsed1 = (await voting.methods.processResolvablePriceRequests().send({ from: account1 })).gasUsed;
    let gasUsed2 = (await voting.methods.processResolvablePriceRequests().send({ from: account2 })).gasUsed;
    // The gas used on the first call should be at least 5x that of the second call.
    assert(gasUsed1 > gasUsed2 * 5);

    // Moving to the next round, we should need to re-spend the gas used on the first call and should see the same behavour.
    await moveToNextRound(voting, accounts[0]);
    gasUsed1 = (await voting.methods.processResolvablePriceRequests().send({ from: account1 })).gasUsed;
    gasUsed2 = (await voting.methods.processResolvablePriceRequests().send({ from: account2 })).gasUsed;
    assert(gasUsed1 > gasUsed2 * 5);
  });

  it("Request resolution can happen piecewise", async function () {
    // It should be possible to sequentially update the resolvable index for a given round by calling resolve resolvable
    // price request range.
    const identifier = padRight(utf8ToHex("test"), 64);
    const time = "1000";
    // Verify that the order of requests is respected as they move between the pending and settled arrays.
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });
    await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });
    await voting.methods.requestPrice(identifier, time + 1).send({ from: registeredContract });
    await voting.methods.requestPrice(identifier, time + 2).send({ from: registeredContract });
    await voting.methods.requestPrice(identifier, time + 3).send({ from: registeredContract });

    const request1Id = await voting.methods.pendingPriceRequestsIds(0).call();
    const request2Id = await voting.methods.pendingPriceRequestsIds(1).call();
    const request3Id = await voting.methods.pendingPriceRequestsIds(2).call();
    const request4Id = await voting.methods.pendingPriceRequestsIds(3).call();

    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberPendingPriceRequests, 4);
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberResolvedPriceRequests, 0);

    // Before doing anything the nextPendingIndexToProcess should be 0.
    assert.equal(await voting.methods.nextPendingIndexToProcess().call(), "0");

    // Updating in range should update to current roundId and the resolvable index to 1.
    await voting.methods.processResolvablePriceRequestsRange(1).send({ from: accounts[0] });
    let roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    assert.equal(await voting.methods.lastRoundIdProcessed().call(), roundId);
    assert.equal(await voting.methods.nextPendingIndexToProcess().call(), "1");

    // calling processResolvablePriceRequests should update to the end of the range.
    await voting.methods.processResolvablePriceRequests().send({ from: accounts[0] });
    assert.equal(await voting.methods.lastRoundIdProcessed().call(), roundId);
    assert.equal(await voting.methods.nextPendingIndexToProcess().call(), "4");

    // Equally, we can show the same behavior works when rolling and updating the rolling trackers.
    await moveToNextRound(voting, accounts[0]);
    await moveToNextRound(voting, accounts[0]);

    assert.equal((await voting.methods.priceRequests(request1Id).call()).rollCount, 0);
    assert.equal((await voting.methods.priceRequests(request2Id).call()).rollCount, 0);
    assert.equal((await voting.methods.priceRequests(request3Id).call()).rollCount, 0);
    assert.equal((await voting.methods.priceRequests(request4Id).call()).rollCount, 0);

    // Now, update in range and we should see the number of indices update correspond to which requests are updated.
    await voting.methods.processResolvablePriceRequestsRange(1).send({ from: accounts[0] });
    assert.equal((await voting.methods.priceRequests(request1Id).call()).rollCount, 1);
    assert.equal((await voting.methods.priceRequests(request2Id).call()).rollCount, 0);
    assert.equal((await voting.methods.priceRequests(request3Id).call()).rollCount, 0);
    assert.equal((await voting.methods.priceRequests(request4Id).call()).rollCount, 0);

    await voting.methods.processResolvablePriceRequestsRange(1).send({ from: accounts[0] });
    assert.equal((await voting.methods.priceRequests(request1Id).call()).rollCount, 1);
    assert.equal((await voting.methods.priceRequests(request2Id).call()).rollCount, 1);
    assert.equal((await voting.methods.priceRequests(request3Id).call()).rollCount, 0);
    assert.equal((await voting.methods.priceRequests(request4Id).call()).rollCount, 0);

    // Update the remaining.
    await voting.methods.processResolvablePriceRequests().send({ from: accounts[0] });
    assert.equal((await voting.methods.priceRequests(request1Id).call()).rollCount, 1);
    assert.equal((await voting.methods.priceRequests(request2Id).call()).rollCount, 1);
    assert.equal((await voting.methods.priceRequests(request3Id).call()).rollCount, 1);
    assert.equal((await voting.methods.priceRequests(request4Id).call()).rollCount, 1);

    // Same behavour occurs when settling requests.
    const price = 123;
    const salt = getRandomSignedInt(); // use the same salt for all votes. bad practice but wont impact anything.
    roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    let baseRequest = { salt, roundId, identifier };
    const hash1 = computeVoteHash({ ...baseRequest, price: price, account: account1, time: time });
    await voting.methods.commitVote(identifier, time, hash1).send({ from: account1 });
    const hash2 = computeVoteHash({ ...baseRequest, price: price, account: account1, time: time + 1 });
    await voting.methods.commitVote(identifier, time + 1, hash2).send({ from: account1 });
    const hash3 = computeVoteHash({ ...baseRequest, price: price, account: account1, time: time + 2 });
    await voting.methods.commitVote(identifier, time + 2, hash3).send({ from: account1 });
    const hash4 = computeVoteHash({ ...baseRequest, price: price, account: account1, time: time + 3 });
    await voting.methods.commitVote(identifier, time + 3, hash4).send({ from: account1 });

    await moveToNextPhase(voting, accounts[0]); // Reveal the votes.

    await voting.methods.revealVote(identifier, time, price, salt).send({ from: account1 });
    await voting.methods.revealVote(identifier, time + 1, price, salt).send({ from: account1 });
    await voting.methods.revealVote(identifier, time + 2, price, salt).send({ from: account1 });
    await voting.methods.revealVote(identifier, time + 3, price, salt).send({ from: account1 });

    await moveToNextRound(voting, accounts[0]);

    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberPendingPriceRequests, 4);
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberResolvedPriceRequests, 0);

    await voting.methods.processResolvablePriceRequestsRange(1).send({ from: accounts[0] });
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberPendingPriceRequests, 3);
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberResolvedPriceRequests, 1);

    await voting.methods.processResolvablePriceRequestsRange(1).send({ from: accounts[0] });
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberPendingPriceRequests, 2);
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberResolvedPriceRequests, 2);

    await voting.methods.processResolvablePriceRequests().send({ from: accounts[0] });
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberPendingPriceRequests, 0);
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberResolvedPriceRequests, 4);
  });
  it("Can successfully remove large amounts of spam piecewise", async function () {
    // Request so many requests in one go that we cant resolve them all in one transaction. Rather, we need to update
    // them piecewise. The same goes for deleting the requests once we've rolled enough times. This checks that in the
    // event the DVM is spammed we can recover gracefully.
    await submitManyRequests(5, 125); // send 625 requests, split over 5 multicalls of size 125.
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberPendingPriceRequests, 625);
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberResolvedPriceRequests, 0);

    // Move to the active round and then a following round. This will force these requests to need to be rolled.
    // When resolving we will now need to roll 625 requests in one go.
    await moveToNextRound(voting, accounts[0]);
    await moveToNextRound(voting, accounts[0]);

    // look at the gas used to resolve the 30 requests. a second call should use a fraction of this gas.

    // If we try and update these all in one go we will run out of gas (note that Hardhat tests have a lower gas limit
    // than ethereum mainnet but the same concept still applies).
    let didRunOutOfGas = false;
    try {
      await voting.methods.processResolvablePriceRequests().send({ from: account1 });
    } catch (error) {
      didRunOutOfGas = true;
      assert(error.data.stack.includes("Transaction ran out of gas"));
    }
    assert(didRunOutOfGas);

    // Now, show that we can still update by splitting this request into two goes. Let's do one of 315 and one of 310.
    await voting.methods.processResolvablePriceRequestsRange(315).send({ from: account1 });
    await voting.methods.processResolvablePriceRequestsRange(310).send({ from: account1 });

    // verify that we've traversed all the requests and that subsequent calls are very cheap.
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberPendingPriceRequests, 625);
    const roundId = await voting.methods.getCurrentRoundId().call();
    assert.equal(await voting.methods.lastRoundIdProcessed().call(), roundId);
    assert.equal(await voting.methods.nextPendingIndexToProcess().call(), 625);
    const gasUsed1 = (await voting.methods.processResolvablePriceRequests().send({ from: account1 })).gasUsed;
    assert(gasUsed1 < 40000);

    // now, keep rolling until these requests are deletable.

    await moveToNextRound(voting, accounts[0]);
    await moveToNextRound(voting, accounts[0]);

    // If we now try resolve these requests can be deleted. Again, we cant do this in one go and need to split it into
    // multiple transactions.
    didRunOutOfGas = false;
    try {
      await voting.methods.processResolvablePriceRequests().send({ from: account1 });
    } catch (error) {
      didRunOutOfGas = true;
      assert(error.data.stack.includes("Transaction ran out of gas"));
    }
    assert(didRunOutOfGas);
    await voting.methods.processResolvablePriceRequestsRange(315).send({ from: account1 });
    await voting.methods.processResolvablePriceRequestsRange(310).send({ from: account1 });
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberPendingPriceRequests, 0);
    assert.equal((await voting.getPastEvents("RequestDeleted", { fromBlock: 0, toBlock: "latest" })).length, 625);
    const gasUsed2 = (await voting.methods.processResolvablePriceRequests().send({ from: account1 })).gasUsed;
    assert(gasUsed2 < 40000);
  });
  it("Can successfully remove votes that need to be deleted, interspersed with valid votes", async function () {
    // Consider a combination of spam and valid votes. We should be able to correctly resolve the valid requests and
    // remove the spam without issue.
    await submitManyRequests(2, 125); // send 250 spam requests.
    const identifier = padRight(utf8ToHex("test"), 64);
    const time = "1000";
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });
    await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });
    await submitManyRequests(2, 125, 500); // send 250 spam requests.
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberPendingPriceRequests, 501);
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberResolvedPriceRequests, 0);

    // Move to the active round and then a following round. This will force these requests to need to be rolled.
    // When resolving we will now need to roll 501 requests in one go.
    await moveToNextRound(voting, accounts[0]);
    await moveToNextRound(voting, accounts[0]);

    // Now, commit and reveal on the one valid request. by proxy of committing we should roll the other votes.
    const price = 123;
    const salt = getRandomSignedInt(); // use the same salt for all votes. bad practice but wont impact anything.
    let roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    let baseRequest = { salt, roundId, identifier };
    const hash1 = computeVoteHash({ ...baseRequest, price: price, account: account1, time: time });
    await voting.methods.commitVote(identifier, time, hash1).send({ from: account1 });
    assert.equal((await voting.getPastEvents("RequestRolled", { fromBlock: 0, toBlock: "latest" })).length, 501);
    await moveToNextPhase(voting, accounts[0]); // Reveal the votes.
    await voting.methods.revealVote(identifier, time, price, salt).send({ from: account1 });
    await moveToNextRound(voting, accounts[0]);
    await voting.methods.processResolvablePriceRequests().send({ from: account1 });

    // There should now be 1 resolved request and 500 rolled requests.
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberPendingPriceRequests, 500);
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberResolvedPriceRequests, 1);
    assert.equal(
      (await voting.methods.getPrice(identifier, time).call({ from: registeredContract })).toString(),
      price.toString()
    );

    // Now, roll again and then update. this should delete these requests.
    await moveToNextRound(voting, accounts[0]);
    await moveToNextRound(voting, accounts[0]);
    await voting.methods.processResolvablePriceRequestsRange(250).send({ from: account1 });
    await voting.methods.processResolvablePriceRequestsRange(250).send({ from: account1 });
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberPendingPriceRequests, 0);
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberResolvedPriceRequests, 1);
  });

  it("Staking during active reveal is dealt with correctly via pendingStakes", async function () {
    // An issue was found in the contract wherein a staked voter stakes again during the active reveal round, thereby
    // increasing their effective stake to a value higher than what they had at the variable freeze time (first commit or stake during active reveal phase).
    // The contract's pendingStake variable is meant to capture this correctly wherein the pending stake for a given round
    // offsets stake that has been added by not yet "activated." However, this was found to not correctly work in the
    // specific case where you stake after committing, but within the reveal phase. The impact of this is that this voter
    // gets a disproportionate amount of voting impact vs the total votes that participated in the vote and the total
    // amount of tokens staked is incorrect. This results in wrong slashing/tracker updates, leaving some tokens in the
    // contract after all rewards have been withdrawn and results in the sum of all slashing trackers not correctly
    // equalling 0 for the vote in which this voter increase their stake.
    const identifier = padRight(utf8ToHex("test"), 64);
    const time = "1000";
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });
    await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });

    await moveToNextRound(voting, accounts[0]);

    // Commit a vote, move to reveal phase.
    const roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    const salt = getRandomSignedInt();
    const price = 0;
    const hash2 = computeVoteHash({ salt, roundId, identifier, price, account: account1, time });
    await voting.methods.commitVote(identifier, time, hash2).send({ from: account1 });
    await moveToNextPhase(voting, accounts[0]); // Reveal the votes.

    // Before revealing the vote the staker stakes again. This should be reflected in the pendingStake variable. If the
    // bug discussed above is still present then this will break heuristic that the sum of all slashing trackers must
    // always equal 0 and that if all voters withdraw (after some amount of slashing) there should be 0 tokens left.
    await votingToken.methods.mint(account1, toWei("10000000")).send({ from: account1 });
    await votingToken.methods.approve(voting.options.address, toWei("10000000")).send({ from: account1 });
    await voting.methods.stake(toWei("10000000")).send({ from: account1 });
    await voting.methods.revealVote(identifier, time, price, salt).send({ from: account1 });

    await moveToNextRound(voting, accounts[0]);

    assert.equal(
      (await voting.methods.getPrice(identifier, time).call({ from: registeredContract })).toString(),
      price.toString()
    );

    // Expect that all accounts should be slashed
    await voting.methods.updateTrackers(account1).send({ from: account1 });
    await voting.methods.updateTrackers(account2).send({ from: account1 });
    await voting.methods.updateTrackers(account3).send({ from: account1 });
    await voting.methods.updateTrackers(account4).send({ from: account1 });

    const events = await voting.getPastEvents("VoterSlashApplied", { fromBlock: 0, toBlock: "latest" });

    const sum = events.map((e) => Number(web3.utils.fromWei(e.returnValues.slashedTokens))).reduce((a, b) => a + b, 0);
    assert.equal(sum, 0);

    await voting.methods.setUnstakeCoolDown(0).send({ from: account1 });
    await voting.methods
      .requestUnstake((await voting.methods.voterStakes(account1).call()).stake)
      .send({ from: account1 });
    await voting.methods
      .requestUnstake((await voting.methods.voterStakes(account2).call()).stake)
      .send({ from: account2 });
    await voting.methods
      .requestUnstake((await voting.methods.voterStakes(account3).call()).stake)
      .send({ from: account3 });
    await voting.methods
      .requestUnstake((await voting.methods.voterStakes(account4).call()).stake)
      .send({ from: account4 });

    await voting.methods.executeUnstake().send({ from: account1 });
    await voting.methods.executeUnstake().send({ from: account2 });
    await voting.methods.executeUnstake().send({ from: account3 });
    await voting.methods.executeUnstake().send({ from: account4 });

    const finalContractBalance = await votingToken.methods.balanceOf(voting.options.address).call();
    assert.equal(finalContractBalance, "0");
  });
  it("Should never allow total stakes to exceed cumulative stake", async function () {
    // This test proves how the total user stakes never exceed the cumulativeStake parameter. This is important because
    // otherwise the VotingV2 contract could not pay the users stakes and also would issue more rewards than it should.
    // To check this we will use a more punitive slashing library that slashes 99% of staked tokens of users who vote
    // incorrectly or do not vote at all. Account1 and Account2 will be the only stakers to vote and therefore receive
    // the tokens of the other users which should reach 0 staked balance.

    // Set up contracts
    const punitiveSlashingLibraryTest = await PunitiveSlashingLibraryTest.new().send({ from: accounts[0] });
    await voting.methods.setSlashingLibrary(punitiveSlashingLibraryTest.options.address).send({ from: accounts[0] });
    const identifier = padRight(utf8ToHex("test"), 64);
    const time = "1000";
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });

    const accountsStartingBallance = toBN(await voting.methods.getVoterStakePostUpdate(account1).call()).add(
      toBN(await voting.methods.getVoterStakePostUpdate(account2).call())
    ); // 32M
    const restOfStakedBalance = toBN(await votingToken.methods.balanceOf(voting.options.address).call()).sub(
      toBN(accountsStartingBallance)
    ); // 68M

    // Number of active voting rounds to test with
    const activeVotingRounds = 20;

    // Account1 will vote with 32M tokens so reaching the gat and then receiving the slashing rewards comming from
    // account2, account3 and account4
    for (let i = 0; i < activeVotingRounds; i++) {
      const newTime = Number(time) + i;
      await voting.methods.requestPrice(identifier, newTime).send({ from: registeredContract });
      await moveToNextRound(voting, accounts[0]);
      assert.equal(await voting.methods.currentActiveRequests().call(), true);

      let roundId = (await voting.methods.getCurrentRoundId().call()).toString(); // Cast vote
      const salt = getRandomSignedInt();
      const price = 0;
      const hash1 = computeVoteHash({ salt, roundId, identifier, price, account: account1, time: newTime });
      await voting.methods.commitVote(identifier, newTime, hash1).send({ from: account1 });
      const hash2 = computeVoteHash({ salt, roundId, identifier, price, account: account2, time: newTime });
      await voting.methods.commitVote(identifier, newTime, hash2).send({ from: account2 });

      await moveToNextPhase(voting, accounts[0]); // Reveal vote
      await voting.methods.revealVote(identifier, newTime, price, salt).send({ from: account1 });
      await voting.methods.revealVote(identifier, newTime, price, salt).send({ from: account2 });
    }

    // Update the trackers of all accounts
    for (const ac of [account1, account2, account3, account4, rand]) {
      await voting.methods.updateTrackers(ac).send({ from: account1 });
    }

    const events = await voting.getPastEvents("VoterSlashApplied", { fromBlock: 0, toBlock: "latest" });

    // Sum of all the positive slashed tokens received by account1
    const sumPositive = events
      .map((e) => e.returnValues.slashedTokens)
      .filter((e) => toBN(e).gt(toBN(0)))
      .reduce((a, b) => toBN(a).add(toBN(b)), toBN(0));

    // Sum of all the negative slashed tokens removed to the rest of accounts
    const sumNegative = events
      .map((e) => e.returnValues.slashedTokens)
      .filter((e) => toBN(e).lt(toBN(0)))
      .reduce((a, b) => toBN(a).add(toBN(b)), toBN(0));

    // Check that the sum of all the positive slashed tokens is equal to the total staked balance minus the account1
    // starting balance. Due to rounding drifts, we allow 1 WEI of error per round.

    assert(restOfStakedBalance.sub(sumPositive).lte(toBN(activeVotingRounds)));

    // Check that the sum of all the negative slashed tokens is equal to the total staked balance minus the account1
    // starting balance. Due to rounding drifts, we allow 1 WEI of error per round.
    assert(restOfStakedBalance.add(sumNegative).lt(toBN(activeVotingRounds)));

    // The sum of all the positive and negative slashed tokens should be equal ~ 0. Due to rounding drifts, we allow 1
    // WEI of error per round.
    assert(sumPositive.add(sumNegative).lt(toBN(activeVotingRounds)));

    // Check that the total user stakes never excede the cumulativeStake
    const cumulativeStake = await voting.methods.cumulativeStake().call();

    const account1Stake = await voting.methods.getVoterStakePostUpdate(account1).call(); // ~ 100M
    const account2Stake = await voting.methods.getVoterStakePostUpdate(account2).call(); // ~ 0
    const account3Stake = await voting.methods.getVoterStakePostUpdate(account3).call(); // ~ 0
    const account4Stake = await voting.methods.getVoterStakePostUpdate(account4).call(); // ~ 0

    const totalUserStakes = toBN(account1Stake)
      .add(toBN(account2Stake))
      .add(toBN(account3Stake))
      .add(toBN(account4Stake));

    // Abs value of difference between totalUserStakes and cumulativeStake
    const diff = toBN(totalUserStakes).gt(toBN(cumulativeStake))
      ? toBN(totalUserStakes).sub(toBN(cumulativeStake))
      : toBN(cumulativeStake).sub(toBN(totalUserStakes)); // ~ 0

    // Due to rounding drifts, we allow 1 WEI of error per round.
    assert(diff.lte(toBN(activeVotingRounds)));
  });

  it("Slashing can be configured depending on price request identifier", async function () {
    // The PriceIdentifierSlashingLibaryTest contract is used to test the ability to configure the slashing library
    // depending on the price request identifier. The library has a hardcoded identifier "SAFE_NO_VOTE" that is
    // whitelisted and will not slash no votes. All other identifiers will be slashed. The test uses this to ensure that
    // the library is correctly configured and that the correct slashing is applied.

    // Set up the contract and library.
    const priceIdentifierSlashingLibaryTest = await PriceIdentifierSlashingLibaryTest.new(voting.options.address).send({
      from: accounts[0],
    });
    await voting.methods
      .setSlashingLibrary(priceIdentifierSlashingLibaryTest.options.address)
      .send({ from: accounts[0] });

    const whitelistedIdentifier = padRight(utf8ToHex("SAFE_NO_VOTE"), 64);
    const identifier = padRight(utf8ToHex("slash"), 64);
    const time = "10";

    // Make the Oracle support these identifiers.
    await supportedIdentifiers.methods.addSupportedIdentifier(whitelistedIdentifier).send({ from: accounts[0] });
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });

    // Request two different price requests, one of the with the whitelistedIdentifier and move to the next round where
    // they will be voted on.
    await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });
    await voting.methods.requestPrice(whitelistedIdentifier, time).send({ from: registeredContract });
    await moveToNextRound(voting, accounts[0]);
    const roundId = (await voting.methods.getCurrentRoundId().call()).toString();

    // Commit votes.
    const price = 123;
    const wrongPrice = 456;
    const salt = getRandomSignedInt();

    // Account1 vote correctly on both price requests.
    // Account4 vote incorrectly on both price requests.
    const hash1 = computeVoteHash({ price: price, salt: salt, account: account1, time, roundId, identifier });
    const hash1Wrong = computeVoteHash({ price: wrongPrice, salt: salt, account: account4, time, roundId, identifier });
    const hash2 = computeVoteHash({
      price: price,
      salt: salt,
      account: account1,
      time,
      roundId,
      identifier: whitelistedIdentifier,
    });
    const hash2Wrong = computeVoteHash({
      price: wrongPrice,
      salt: salt,
      account: account4,
      time,
      roundId,
      identifier: whitelistedIdentifier,
    });
    await voting.methods.commitVote(identifier, time, hash1).send({ from: account1 });
    await voting.methods.commitVote(identifier, time, hash1Wrong).send({ from: account4 });
    await voting.methods.commitVote(whitelistedIdentifier, time, hash2).send({ from: account1 });
    await voting.methods.commitVote(whitelistedIdentifier, time, hash2Wrong).send({ from: account4 });

    // Reveal the votes.
    await moveToNextPhase(voting, accounts[0]);

    await voting.methods.revealVote(identifier, time, price, salt).send({ from: account1 });
    await voting.methods.revealVote(identifier, time, wrongPrice, salt).send({ from: account4 });
    await voting.methods.revealVote(whitelistedIdentifier, time, price, salt).send({ from: account1 });
    await voting.methods.revealVote(whitelistedIdentifier, time, wrongPrice, salt).send({ from: account4 });

    // Price should resolve to the one that 2 and 3 voted for.
    await moveToNextRound(voting, accounts[0]);

    await voting.methods.updateTrackers(account1).send({ from: account1 });
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberPendingPriceRequests, 0);
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberResolvedPriceRequests, 2);

    // Check that the correct amount of tokens were slashed.
    const slashingTracker = await voting.methods.requestSlashingTrackers(0).call();
    const slashingTrackerWhitelisted = await voting.methods.requestSlashingTrackers(1).call();

    // Non whitelisted identifier should slash 0.0016 per token for both no vote and wrong vote.
    assert.equal(slashingTracker.wrongVoteSlashPerToken, toWei("0.0016"));
    assert.equal(slashingTracker.noVoteSlashPerToken, toWei("0.0016"));
    assert.equal(slashingTracker.totalSlashed, toWei("108800")); // 64mm * 0.0016 + 4mm * 0.0016 = 108800
    assert.equal(slashingTracker.totalCorrectVotes, toWei("32000000"));

    // Whitelisted identifier should slash 0.0016 per token for wrong vote but not no vote.
    assert.equal(slashingTrackerWhitelisted.wrongVoteSlashPerToken, toWei("0.0016"));
    assert.equal(slashingTrackerWhitelisted.noVoteSlashPerToken, toWei("0")); // No vote is not slashed.
    assert.equal(slashingTrackerWhitelisted.totalSlashed, toWei("6400")); // 4mm * 0.0016 = 6400 (no vote is not slashed)
    assert.equal(slashingTrackerWhitelisted.totalCorrectVotes, toWei("32000000"));

    // Check that the correct amount of tokens were slashed.
    assert.equal(
      await voting.methods.getVoterStakePostUpdate(account1).call(),
      toWei("32000000").add(toWei("108800")).add(toWei("6400"))
    );

    assert.equal(await voting.methods.getVoterStakePostUpdate(account2).call(), toWei("32000000").sub(toWei("51200")));

    assert.equal(await voting.methods.getVoterStakePostUpdate(account3).call(), toWei("32000000").sub(toWei("51200")));

    assert.equal(
      await voting.methods.getVoterStakePostUpdate(account4).call(),
      toWei("4000000").sub(toWei("6400")).sub(toWei("6400"))
    );
  });
  it("Requests are auto rolled if a given round hits the limit of number of requests it can handle", async function () {
    // The contract is meant to bound how many requests can be placed in a given round to limit the upper bound of slashing
    // that can be applied linearly within one round if a voter was to not participate. Set maxRequestersPerRound to 2.
    // If we request 3 it should auto roll the 3rd into the next round. If we request 5 it should place 2 in the first
    // 2 in the second and 1 in the third.
    await voting.methods.setMaxRequestPerRound(2).send({ from: accounts[0] });

    // Request 3 price requests.
    const identifier = padRight(utf8ToHex("test"), 64);
    const time = "1000";
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });
    await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });
    await voting.methods.requestPrice(identifier, time + 1).send({ from: registeredContract });
    await voting.methods.requestPrice(identifier, time + 2).send({ from: registeredContract });

    const requestRoundId = Number(await voting.methods.getCurrentRoundId().call());

    // Request0 and request 1 should be voted on in the next round (requestRoundId + 1) and the 3rd request should be
    // voted on in the round after that (requestRoundId + 2).
    const request1Id = await voting.methods.pendingPriceRequestsIds(0).call();
    assert.equal((await voting.methods.priceRequests(request1Id).call()).lastVotingRound, requestRoundId + 1);

    const request2Id = await voting.methods.pendingPriceRequestsIds(1).call();
    assert.equal((await voting.methods.priceRequests(request2Id).call()).lastVotingRound, requestRoundId + 1);

    const request3Id = await voting.methods.pendingPriceRequestsIds(2).call();
    assert.equal((await voting.methods.priceRequests(request3Id).call()).lastVotingRound, requestRoundId + 2);

    // Submit another 2 price requests. the next should be in the next round and the last should be in the round after that.
    await voting.methods.requestPrice(identifier, time + 3).send({ from: registeredContract });
    await voting.methods.requestPrice(identifier, time + 4).send({ from: registeredContract });

    const request4Id = await voting.methods.pendingPriceRequestsIds(3).call();
    assert.equal((await voting.methods.priceRequests(request4Id).call()).lastVotingRound, requestRoundId + 2);

    const request5Id = await voting.methods.pendingPriceRequestsIds(4).call();
    assert.equal((await voting.methods.priceRequests(request5Id).call()).lastVotingRound, requestRoundId + 3);

    // Verify that voting respects what round a request is meant to be voted on. We should be able to vote on request1
    // and request2 at the same time, but not 3,4,5.
    await moveToNextRound(voting, accounts[0]);

    await voting.methods.processResolvablePriceRequests().send({ from: account1 });
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberPendingPriceRequests, 5);
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberResolvedPriceRequests, 0);

    const price = 123;
    const salt = getRandomSignedInt(); // use the same salt for all votes. bad practice but wont impact anything.
    let roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    let baseRequest = { salt, roundId, identifier };
    const hash1 = computeVoteHash({ ...baseRequest, price: price, account: account1, time: time });
    const hash2 = computeVoteHash({ ...baseRequest, price: price, account: account1, time: time + 1 });
    let hash3 = computeVoteHash({ ...baseRequest, price: price, account: account1, time: time + 2 });
    await voting.methods.commitVote(identifier, time, hash1).send({ from: account1 });
    await voting.methods.commitVote(identifier, time + 1, hash2).send({ from: account1 });

    // Voting on request 3 should revert as it's not active in this round.
    assert(await didContractThrow(voting.methods.commitVote(identifier, time + 2, hash3).send({ from: account1 })));

    await moveToNextPhase(voting, accounts[0]); // Reveal the votes.
    await voting.methods.revealVote(identifier, time, price, salt).send({ from: account1 });
    await voting.methods.revealVote(identifier, time + 1, price, salt).send({ from: account1 });
    assert(
      await didContractThrow(voting.methods.revealVote(identifier, time + 2, price, salt).send({ from: account1 }))
    );
    await moveToNextRound(voting, accounts[0]);
    await voting.methods.processResolvablePriceRequests().send({ from: account1 });
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberPendingPriceRequests, 3);
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberResolvedPriceRequests, 2);

    // Now, we should expect none of the requests to have rolled as they were enqued for this round, not the previous
    // round and so should not have rolled. Equally, we should now be able to vote on 3 and 4 but not 5.
    assert.equal((await voting.methods.priceRequests(request1Id).call()).lastVotingRound, requestRoundId + 1);
    assert.equal((await voting.methods.priceRequests(request1Id).call()).rollCount, 0);
    assert.equal((await voting.methods.priceRequests(request2Id).call()).lastVotingRound, requestRoundId + 1);
    assert.equal((await voting.methods.priceRequests(request2Id).call()).rollCount, 0);
    assert.equal((await voting.methods.priceRequests(request3Id).call()).lastVotingRound, requestRoundId + 2);
    assert.equal((await voting.methods.priceRequests(request3Id).call()).rollCount, 0);

    // We should now be able to vote on requests 3, 4 but not 5.
    baseRequest.roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    hash3 = computeVoteHash({ ...baseRequest, price: price, account: account1, time: time + 2 });
    const hash4 = computeVoteHash({ ...baseRequest, price: price, account: account1, time: time + 3 });
    let hash5 = computeVoteHash({ ...baseRequest, price: price, account: account1, time: time + 4 });
    await voting.methods.commitVote(identifier, time + 2, hash3).send({ from: account1 });
    await voting.methods.commitVote(identifier, time + 3, hash4).send({ from: account1 });
    assert(await didContractThrow(voting.methods.commitVote(identifier, time + 4, hash5).send({ from: account1 })));

    await moveToNextPhase(voting, accounts[0]); // Reveal the votes.
    await voting.methods.revealVote(identifier, time + 2, price, salt).send({ from: account1 });
    await voting.methods.revealVote(identifier, time + 3, price, salt).send({ from: account1 });
    assert(
      await didContractThrow(voting.methods.revealVote(identifier, time + 4, price, salt).send({ from: account1 }))
    );

    await moveToNextRound(voting, accounts[0]);
    await voting.methods.processResolvablePriceRequests().send({ from: account1 });
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberPendingPriceRequests, 1);
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberResolvedPriceRequests, 4);

    assert.equal((await voting.methods.priceRequests(request3Id).call()).lastVotingRound, requestRoundId + 2);
    assert.equal((await voting.methods.priceRequests(request3Id).call()).rollCount, 0);
    assert.equal((await voting.methods.priceRequests(request4Id).call()).lastVotingRound, requestRoundId + 2);
    assert.equal((await voting.methods.priceRequests(request4Id).call()).rollCount, 0);
    assert.equal((await voting.methods.priceRequests(request5Id).call()).lastVotingRound, requestRoundId + 3);
    assert.equal((await voting.methods.priceRequests(request5Id).call()).rollCount, 0);

    // Finally, we can vote on the last request.
    baseRequest.roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    hash5 = computeVoteHash({ ...baseRequest, price: price, account: account1, time: time + 4 });
    await voting.methods.commitVote(identifier, time + 4, hash5).send({ from: account1 });
    await moveToNextPhase(voting, accounts[0]); // Reveal the votes.
    await voting.methods.revealVote(identifier, time + 4, price, salt).send({ from: account1 });
    await moveToNextRound(voting, accounts[0]);
    await voting.methods.processResolvablePriceRequests().send({ from: account1 });
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberPendingPriceRequests, 0);
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberResolvedPriceRequests, 5);

    // All prices are resolved.
    assert.equal(
      price.toString(),
      await voting.methods.getPrice(identifier, time).call({ from: registeredContract }),
      await voting.methods.getPrice(identifier, time + 1).call({ from: registeredContract }),
      await voting.methods.getPrice(identifier, time + 2).call({ from: registeredContract }),
      await voting.methods.getPrice(identifier, time + 3).call({ from: registeredContract }),
      await voting.methods.getPrice(identifier, time + 4).call({ from: registeredContract })
    );
  });
  it("Auto roll from max request limit interplays correctly with rolls due to no quorum", async function () {
    // Consider a situation where we are rolling votes due to the limit per round being hit, but votes are also rolling
    // due to not having enough votes to pass. In this case, the rolled votes from missed quarum should auto roll past
    // where they can be enqued from the auto roll from max request limit. To test this we will set the max requests per
    // round to 2, request 3 price requests. This will place 2 requests in the next round and 1 in the round after next.
    // Then, move to the vote round and do not hit quarum on either vote. A a result we should see the first 2 requests
    // roll with the first request landing in the subsequent round and the 3rd request landing in the round after that.
    await voting.methods.setMaxRequestPerRound(2).send({ from: accounts[0] });

    // Request 3 price requests.
    const identifier = padRight(utf8ToHex("test"), 64);
    const time = "1000";
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });
    await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });
    await voting.methods.requestPrice(identifier, time + 1).send({ from: registeredContract });
    await voting.methods.requestPrice(identifier, time + 2).send({ from: registeredContract });

    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberPendingPriceRequests, 3);
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberResolvedPriceRequests, 0);

    const requestRoundId = Number(await voting.methods.getCurrentRoundId().call());

    // Request0 and request 1 should be voted on in the next round (requestRoundId + 1) and the 3rd request should be
    // voted on in the round after that (requestRoundId + 2).
    const request1Id = await voting.methods.pendingPriceRequestsIds(0).call();
    assert.equal((await voting.methods.priceRequests(request1Id).call()).lastVotingRound, requestRoundId + 1);

    const request2Id = await voting.methods.pendingPriceRequestsIds(1).call();
    assert.equal((await voting.methods.priceRequests(request2Id).call()).lastVotingRound, requestRoundId + 1);

    const request3Id = await voting.methods.pendingPriceRequestsIds(2).call();
    assert.equal((await voting.methods.priceRequests(request3Id).call()).lastVotingRound, requestRoundId + 2);

    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberPendingPriceRequests, 3);
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberResolvedPriceRequests, 0);

    // Now, make the votes roll. To do this we can simply move 2 rounds forward (the next round is the active round and
    // the subsequent round is will cause them to roll. We should see
    await moveToNextRound(voting, accounts[0]);
    await moveToNextRound(voting, accounts[0]);

    // The first 2 requests should now have a roll count of 1, the 3rd request should not have a roll count. The first
    // request should be voted in requestRoundId + 2 and the 2nd request should be voted on in requestRoundId + 3 as the
    // round it first tried to roll in was full.
    await voting.methods.processResolvablePriceRequests().send({ from: account1 });
    assert.equal((await voting.methods.priceRequests(request1Id).call()).lastVotingRound, requestRoundId + 2);
    assert.equal((await voting.methods.priceRequests(request1Id).call()).rollCount, 1);
    assert.equal((await voting.methods.priceRequests(request2Id).call()).lastVotingRound, requestRoundId + 3);
    assert.equal((await voting.methods.priceRequests(request2Id).call()).rollCount, 1);
    assert.equal((await voting.methods.priceRequests(request3Id).call()).lastVotingRound, requestRoundId + 2);
    assert.equal((await voting.methods.priceRequests(request3Id).call()).rollCount, 0);

    // Make another 2 price requests. We should see them respect the fullness of the subsequent rounds such that the
    // next request lands in requestRoundId + 3 (next available round) and the one after that lands in requestRoundId + 4.
    await voting.methods.requestPrice(identifier, time + 3).send({ from: registeredContract });
    await voting.methods.requestPrice(identifier, time + 4).send({ from: registeredContract });

    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberPendingPriceRequests, 5);
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberResolvedPriceRequests, 0);

    const request4Id = await voting.methods.pendingPriceRequestsIds(3).call();
    assert.equal((await voting.methods.priceRequests(request4Id).call()).lastVotingRound, requestRoundId + 3);

    const request5Id = await voting.methods.pendingPriceRequestsIds(4).call();
    assert.equal((await voting.methods.priceRequests(request5Id).call()).lastVotingRound, requestRoundId + 4);

    // Now actually vote. Note that we can actually only vote on requests 1 and 3, not 2, due to how the re-enquing
    // worked with the rolling.
    const price = 123;
    const salt = getRandomSignedInt(); // use the same salt for all votes. bad practice but wont impact anything.
    let roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    let baseRequest = { salt, roundId, identifier };
    let hash1 = computeVoteHash({ ...baseRequest, price: price, account: account1, time: time });
    let hash2 = computeVoteHash({ ...baseRequest, price: price, account: account1, time: time + 1 });
    let hash3 = computeVoteHash({ ...baseRequest, price: price, account: account1, time: time + 2 });
    await voting.methods.commitVote(identifier, time, hash1).send({ from: account1 });
    // Voting on request 2 should revert as it's not active in this round.
    assert(await didContractThrow(voting.methods.commitVote(identifier, time + 1, hash2).send({ from: account1 })));
    await voting.methods.commitVote(identifier, time + 2, hash3).send({ from: account1 });

    await moveToNextPhase(voting, accounts[0]); // Reveal the votes.
    await voting.methods.revealVote(identifier, time, price, salt).send({ from: account1 });
    // Equally, cant reveal request 2 as it was not votable this round.
    assert(
      await didContractThrow(voting.methods.revealVote(identifier, time + 1, price, salt).send({ from: account1 }))
    );
    await voting.methods.revealVote(identifier, time + 2, price, salt).send({ from: account1 });

    await moveToNextRound(voting, accounts[0]);
    await voting.methods.processResolvablePriceRequests().send({ from: account1 });
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberPendingPriceRequests, 3);
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberResolvedPriceRequests, 2);

    // Traverse the next 2 rounds, voting as we go to resolve everything.
    baseRequest.roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    hash3 = computeVoteHash({ ...baseRequest, price: price, account: account1, time: time + 1 });
    const hash4 = computeVoteHash({ ...baseRequest, price: price, account: account1, time: time + 3 });
    let hash5 = computeVoteHash({ ...baseRequest, price: price, account: account1, time: time + 4 });
    await voting.methods.commitVote(identifier, time + 1, hash3).send({ from: account1 });
    await voting.methods.commitVote(identifier, time + 3, hash4).send({ from: account1 });
    assert(await didContractThrow(voting.methods.commitVote(identifier, time + 4, hash5).send({ from: account1 })));

    await moveToNextPhase(voting, accounts[0]); // Reveal the votes.
    await voting.methods.revealVote(identifier, time + 1, price, salt).send({ from: account1 });
    await voting.methods.revealVote(identifier, time + 3, price, salt).send({ from: account1 });
    assert(
      await didContractThrow(voting.methods.revealVote(identifier, time + 4, price, salt).send({ from: account1 }))
    );

    await moveToNextRound(voting, accounts[0]);
    await voting.methods.processResolvablePriceRequests().send({ from: account1 });
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberPendingPriceRequests, 1);
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberResolvedPriceRequests, 4);

    // Resolve final request.
    baseRequest.roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    hash5 = computeVoteHash({ ...baseRequest, price: price, account: account1, time: time + 4 });
    await voting.methods.commitVote(identifier, time + 4, hash5).send({ from: account1 });
    await moveToNextPhase(voting, accounts[0]); // Reveal the votes.
    await voting.methods.revealVote(identifier, time + 4, price, salt).send({ from: account1 });
    await moveToNextRound(voting, accounts[0]);
    await voting.methods.processResolvablePriceRequests().send({ from: account1 });
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberPendingPriceRequests, 0);
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberResolvedPriceRequests, 5);

    // All prices are resolved.
    assert.equal(
      price.toString(),
      await voting.methods.getPrice(identifier, time).call({ from: registeredContract }),
      await voting.methods.getPrice(identifier, time + 1).call({ from: registeredContract }),
      await voting.methods.getPrice(identifier, time + 2).call({ from: registeredContract }),
      await voting.methods.getPrice(identifier, time + 3).call({ from: registeredContract }),
      await voting.methods.getPrice(identifier, time + 4).call({ from: registeredContract })
    );
  });
  it("Should never allow total stakes to exceed cumulative stake", async function () {
    // Show that, even when there are multiple requests within the same round, and the theoretical max slash is exceed,
    // we are saved by the max requests per round setting. To show this we set the slashing library to the punitive
    // slashing library which slashes 99% of the stake per round. Due to this we must set the max requests per round to
    // 1 as maxRequestPerRound must be a whole number less than 1/(slashing percentage). In this case SP is 0.99 so
    // 1/0.99 = 1.01. Therefore, we can only allow 1 request per round. This bounds the maximum requests per round to
    // 1 and therefore prevents sequential slashing within the same round.

    // Set up contracts
    const punitiveSlashingLibraryTest = await PunitiveSlashingLibraryTest.new().send({ from: accounts[0] });
    await voting.methods.setSlashingLibrary(punitiveSlashingLibraryTest.options.address).send({ from: accounts[0] });
    await voting.methods.setMaxRequestPerRound(1).send({ from: accounts[0] });

    // setup two identifiers which will be used to request two price requests in one round
    const identifier1 = padRight(utf8ToHex("aaaa"), 64);
    const identifier2 = padRight(utf8ToHex("bbbb"), 64);
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier1).send({ from: accounts[0] });
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier2).send({ from: accounts[0] });

    // get the starting UMA balances of each account
    // account1 and account2 will vote whereas account3 and account4 will not vote
    // additionally account2 will vote incorrectly and therefore will be slashed
    const startingBalanceAccount1 = toBN(await voting.methods.getVoterStakePostUpdate(account1).call());
    const startingBalanceAccount2 = toBN(await voting.methods.getVoterStakePostUpdate(account2).call());
    const startingBalanceAccount3 = toBN(await voting.methods.getVoterStakePostUpdate(account3).call());
    const startingBalanceAccount4 = toBN(await voting.methods.getVoterStakePostUpdate(account4).call());

    const startingAccountBalances = {
      [account1]: startingBalanceAccount1,
      [account2]: startingBalanceAccount2,
      [account3]: startingBalanceAccount3,
      [account4]: startingBalanceAccount4,
    };

    // Account1 will vote with 32M tokens so reaching the gat and then receiving the slashing rewards coming from
    // account2, account3 and account4
    const time = 1000;
    await voting.methods.requestPrice(identifier1, time).send({ from: registeredContract });
    await voting.methods.requestPrice(identifier2, time).send({ from: registeredContract });

    await moveToNextRound(voting, accounts[0]);
    assert.equal(await voting.methods.currentActiveRequests().call(), true);

    let roundId = (await voting.methods.getCurrentRoundId().call()).toString(); // Cast vote
    const salt = getRandomSignedInt();

    // commit votes for first price request
    const hash1v1 = computeVoteHash({ salt, roundId, identifier: identifier1, price: 0, account: account1, time });
    await voting.methods.commitVote(identifier1, time, hash1v1).send({ from: account1 });
    const hash2v1 = computeVoteHash({ salt, roundId, identifier: identifier1, price: 1, account: account2, time });
    await voting.methods.commitVote(identifier1, time, hash2v1).send({ from: account2 });

    // We can not commit on the second request as it is not active in this round (subsequent round due to max per round).
    let hash1v2 = computeVoteHash({ salt, roundId, identifier: identifier2, price: 0, account: account1, time });
    assert(await didContractThrow(voting.methods.commitVote(identifier2, time, hash1v2).send({ from: account1 })));

    await moveToNextPhase(voting, accounts[0]);

    // Reveal votes
    await voting.methods.revealVote(identifier1, time, 0, salt).send({ from: account1 });
    await voting.methods.revealVote(identifier1, time, 1, salt).send({ from: account2 });

    // Now, we can move to the next round and vote on the remaining request.
    await moveToNextPhase(voting, accounts[0]);
    // commit votes for second price request
    roundId = (await voting.methods.getCurrentRoundId().call()).toString(); // Cast vote
    hash1v2 = computeVoteHash({ salt, roundId, identifier: identifier2, price: 0, account: account1, time });
    await voting.methods.commitVote(identifier2, time, hash1v2).send({ from: account1 });
    const hash2v2 = computeVoteHash({ salt, roundId, identifier: identifier2, price: 1, account: account2, time });
    await voting.methods.commitVote(identifier2, time, hash2v2).send({ from: account2 });
    await moveToNextPhase(voting, accounts[0]);
    await voting.methods.revealVote(identifier2, time, 0, salt).send({ from: account1 });
    await voting.methods.revealVote(identifier2, time, 1, salt).send({ from: account2 });

    // move to the next voting round so slashing can occur next
    await moveToNextRound(voting, accounts[0]);

    // Update the trackers of all accounts
    for (const ac of [account1, account2, account3, account4])
      await voting.methods.updateTrackers(ac).send({ from: account1 });

    const events = await voting.getPastEvents("VoterSlashApplied", { fromBlock: 0, toBlock: "latest" });
    for (const event of events) {
      let {
        returnValues: { voter, slashedTokens },
      } = event;
      // the total amount that was slashed for each account should not exceed the starting UMA balance
      if (toBN(slashedTokens).isNeg()) assert(startingAccountBalances[voter].gte(toBN(slashedTokens).abs()));
    }
  });
  it("Rounding of slashing does not make contract insolvent, skip default seeding", async function () {
    // Test how the rounding of slashing affects the contract's solvency. The setup of this test is dependent on using
    // FixedSlashSlashingLibrary with baseSlashAmount set to 0.0016 * 10^18. Floor rounding would cause 1000 wei staked
    // balance to be slashed by 1 wei while for 2 such voters their total 2000 wei would cause total negative slash of
    // 3 wei to be applied for the correct voters. The distribution of staked tokens should be constructed such that the
    // total negative slash amount is perfectly divisible by the number of correct voters.

    // Following distribution for ~90MM among 5 accounts satisfies the conditions for the test:
    // 1: 20MM (will vote correctly)
    // 2: 20MM (will vote correctly)
    // 3: 20MM (will vote correctly)
    // 4: 15MM + 1000wei (will vote incorrectly)
    // 5(rand): 15MM + 1000wei (will vote incorrectly)
    // account1 starts with 100MM tokens, so divide up as:
    await votingToken.methods.approve(voting.options.address, toWei("2000000000")).send({ from: account1 });
    await voting.methods.stake(toWei("20000000")).send({ from: account1 });
    await votingToken.methods.transfer(account2, toWei("20000000")).send({ from: accounts[0] });
    await votingToken.methods.approve(voting.options.address, toWei("2000000000")).send({ from: account2 });
    await voting.methods.stake(toWei("20000000")).send({ from: account2 });
    await votingToken.methods.transfer(account3, toWei("20000000")).send({ from: accounts[0] });
    await votingToken.methods.approve(voting.options.address, toWei("2000000000")).send({ from: account3 });
    await voting.methods.stake(toWei("20000000")).send({ from: account3 });
    await votingToken.methods.transfer(account4, toWei("15000000").add(toBN("1000"))).send({ from: accounts[0] });
    await votingToken.methods
      .approve(voting.options.address, toWei("15000000").add(toBN("1000")))
      .send({ from: account4 });
    await voting.methods.stake(toWei("15000000").add(toBN("1000"))).send({ from: account4 });
    await votingToken.methods.transfer(rand, toWei("15000000").add(toBN("1000"))).send({ from: accounts[0] });
    await votingToken.methods.approve(voting.options.address, toWei("15000000").add(toBN("1000"))).send({ from: rand });
    await voting.methods.stake(toWei("15000000").add(toBN("1000"))).send({ from: rand });

    // Submit test price request.
    const identifier = padRight(utf8ToHex("test"), 64);
    const time = "1000";
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });
    await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });
    await moveToNextRound(voting, accounts[0]);
    const roundId = (await voting.methods.getCurrentRoundId().call()).toString();

    // Commit votes.
    const price = 123;
    const wrongPrice = 456;
    const salt = getRandomSignedInt();
    const hash1 = computeVoteHash({ price: price, salt: salt, account: account1, time, roundId, identifier });
    const hash2 = computeVoteHash({ price: price, salt: salt, account: account2, time, roundId, identifier });
    const hash3 = computeVoteHash({ price: price, salt: salt, account: account3, time, roundId, identifier });
    const hash4 = computeVoteHash({ price: wrongPrice, salt: salt, account: account4, time, roundId, identifier });
    const hash5 = computeVoteHash({ price: wrongPrice, salt: salt, account: rand, time, roundId, identifier });
    await voting.methods.commitVote(identifier, time, hash1).send({ from: account1 });
    await voting.methods.commitVote(identifier, time, hash2).send({ from: account2 });
    await voting.methods.commitVote(identifier, time, hash3).send({ from: account3 });
    await voting.methods.commitVote(identifier, time, hash4).send({ from: account4 });
    await voting.methods.commitVote(identifier, time, hash5).send({ from: rand });

    // Reveal the votes.
    await moveToNextPhase(voting, accounts[0]);
    await voting.methods.revealVote(identifier, time, price, salt).send({ from: account1 });
    await voting.methods.revealVote(identifier, time, price, salt).send({ from: account2 });
    await voting.methods.revealVote(identifier, time, price, salt).send({ from: account3 });
    await voting.methods.revealVote(identifier, time, wrongPrice, salt).send({ from: account4 });
    await voting.methods.revealVote(identifier, time, wrongPrice, salt).send({ from: rand });

    // Move to next round and verify that the balance of voting contract and cumulativeStake variable are at least equal
    // to the sum of individual stake amounts. Actual unstaking is performed in the afterEach hook.
    await moveToNextRound(voting, accounts[0]);
    let totalStaked = toBN(0);
    for (const ac of [account1, account2, account3, account4, rand]) {
      totalStaked = totalStaked.add(toBN(await voting.methods.getVoterStakePostUpdate(ac).call()));
    }
    assert.isTrue(toBN(await voting.methods.cumulativeStake().call()).gte(totalStaked));
    assert.isTrue(toBN(await votingToken.methods.balanceOf(voting.options.address).call()).gte(totalStaked));
  });
  it("Rounding of slashing does not brick contract if everyone is voting, skip default seeding", async function () {
    // Test how the rounding of slashing affects the consistency of totalVotes and cumulativeStakeAtRound when everybody
    // is voting. The setup of this test is dependent on using FixedSlashSlashingLibrary with baseSlashAmount set to
    // 0.0016 * 10^18. Floor rounding would cause 1000 wei staked balance to be slashed by 1 wei while for 2 such voters
    // their total 2000 wei would cause total negative slash of 3 wei to be applied for the correct voters. The
    // distribution of staked tokens should be constructed such that the total negative slash amount is perfectly
    // divisible by the number of correct voters.

    // Following distribution for ~90MM among 5 accounts satisfies the conditions for the test:
    // 1: 20MM (will vote correctly)
    // 2: 20MM (will vote correctly)
    // 3: 20MM (will vote correctly)
    // 4: 15MM + 1000wei (will vote incorrectly)
    // 5(rand): 15MM + 1000wei (will vote incorrectly)
    // account1 starts with 100MM tokens, so divide up as:
    await votingToken.methods.approve(voting.options.address, toWei("2000000000")).send({ from: account1 });
    await voting.methods.stake(toWei("20000000")).send({ from: account1 });
    await votingToken.methods.transfer(account2, toWei("20000000")).send({ from: accounts[0] });
    await votingToken.methods.approve(voting.options.address, toWei("2000000000")).send({ from: account2 });
    await voting.methods.stake(toWei("20000000")).send({ from: account2 });
    await votingToken.methods.transfer(account3, toWei("20000000")).send({ from: accounts[0] });
    await votingToken.methods.approve(voting.options.address, toWei("2000000000")).send({ from: account3 });
    await voting.methods.stake(toWei("20000000")).send({ from: account3 });
    await votingToken.methods.transfer(account4, toWei("15000000").add(toBN("1000"))).send({ from: accounts[0] });
    await votingToken.methods
      .approve(voting.options.address, toWei("15000000").add(toBN("1000")))
      .send({ from: account4 });
    await voting.methods.stake(toWei("15000000").add(toBN("1000"))).send({ from: account4 });
    await votingToken.methods.transfer(rand, toWei("15000000").add(toBN("1000"))).send({ from: accounts[0] });
    await votingToken.methods.approve(voting.options.address, toWei("15000000").add(toBN("1000"))).send({ from: rand });
    await voting.methods.stake(toWei("15000000").add(toBN("1000"))).send({ from: rand });

    // Submit test price request.
    const identifier = padRight(utf8ToHex("test"), 64);
    let time = "1000";
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });
    await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });
    await moveToNextRound(voting, accounts[0]);
    let roundId = (await voting.methods.getCurrentRoundId().call()).toString();

    // Commit votes.
    const price = 123;
    const wrongPrice = 456;
    const salt = getRandomSignedInt();
    const hash1 = computeVoteHash({ price: price, salt: salt, account: account1, time, roundId, identifier });
    const hash2 = computeVoteHash({ price: price, salt: salt, account: account2, time, roundId, identifier });
    const hash3 = computeVoteHash({ price: price, salt: salt, account: account3, time, roundId, identifier });
    const hash4 = computeVoteHash({ price: wrongPrice, salt: salt, account: account4, time, roundId, identifier });
    const hash5 = computeVoteHash({ price: wrongPrice, salt: salt, account: rand, time, roundId, identifier });
    await voting.methods.commitVote(identifier, time, hash1).send({ from: account1 });
    await voting.methods.commitVote(identifier, time, hash2).send({ from: account2 });
    await voting.methods.commitVote(identifier, time, hash3).send({ from: account3 });
    await voting.methods.commitVote(identifier, time, hash4).send({ from: account4 });
    await voting.methods.commitVote(identifier, time, hash5).send({ from: rand });

    // Reveal the votes.
    await moveToNextPhase(voting, accounts[0]);
    await voting.methods.revealVote(identifier, time, price, salt).send({ from: account1 });
    await voting.methods.revealVote(identifier, time, price, salt).send({ from: account2 });
    await voting.methods.revealVote(identifier, time, price, salt).send({ from: account3 });
    await voting.methods.revealVote(identifier, time, wrongPrice, salt).send({ from: account4 });
    await voting.methods.revealVote(identifier, time, wrongPrice, salt).send({ from: rand });

    // Submit the second test price request.
    time = time + 1;
    await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });
    await moveToNextRound(voting, accounts[0]);
    roundId = (await voting.methods.getCurrentRoundId().call()).toString();

    // Commit votes with everybody voting for the same price.
    const newHash1 = computeVoteHash({ price, salt, account: account1, time, roundId, identifier });
    const newHash2 = computeVoteHash({ price, salt, account: account2, time, roundId, identifier });
    const newHash3 = computeVoteHash({ price, salt, account: account3, time, roundId, identifier });
    const newHash4 = computeVoteHash({ price, salt, account: account4, time, roundId, identifier });
    const newHash5 = computeVoteHash({ price, salt, account: rand, time, roundId, identifier });
    await voting.methods.commitVote(identifier, time, newHash1).send({ from: account1 });
    await voting.methods.commitVote(identifier, time, newHash2).send({ from: account2 });
    await voting.methods.commitVote(identifier, time, newHash3).send({ from: account3 });
    await voting.methods.commitVote(identifier, time, newHash4).send({ from: account4 });
    await voting.methods.commitVote(identifier, time, newHash5).send({ from: rand });

    // Reveal the votes.
    await moveToNextPhase(voting, accounts[0]);
    await voting.methods.revealVote(identifier, time, price, salt).send({ from: account1 });
    await voting.methods.revealVote(identifier, time, price, salt).send({ from: account2 });
    await voting.methods.revealVote(identifier, time, price, salt).send({ from: account3 });
    await voting.methods.revealVote(identifier, time, price, salt).send({ from: account4 });
    await voting.methods.revealVote(identifier, time, price, salt).send({ from: rand });

    // Move to next round and verify that all stakers are able to claim rewards. This would be impossible if
    // cumulativeStakeAtRound were to be out of sync with totalVotes for the round.
    await moveToNextRound(voting, accounts[0]);
    for (const ac of [account1, account2, account3, account4, rand])
      await voting.methods.withdrawRewards().send({ from: ac });
  });
  it("Can change address of slashing library between rounds and voters are slashed appropriately", async function () {
    // consider the slashing library being changed between. A voter should be slashed based on the slashing library that
    // was set at the round the vote resolved. For example consider there being two rounds with requests in each. In
    // round 1 the standard slashing library is used. In round 2 the slashing library changes to slashing amounts by 2x.
    // If a voter was staked but did not interact with the contracts between these rounds they should be slashed according
    // to the library set on each round.

    const identifier = padRight(utf8ToHex("test"), 64);
    const time = "1000";
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });
    await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });
    await moveToNextRound(voting, accounts[0]);

    const price = 123;
    const salt = getRandomSignedInt(); // use the same salt for all votes. bad practice but wont impact anything.
    let roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    let baseRequest = { salt, roundId, identifier };
    let hash1 = computeVoteHash({ ...baseRequest, price: price, account: account1, time: time });
    await voting.methods.commitVote(identifier, time, hash1).send({ from: account1 });

    // move to the next phase, reveal and change the slashing library and request another price to vote on in the next round.

    await moveToNextPhase(voting, accounts[0]);
    await voting.methods.revealVote(identifier, time, price, salt).send({ from: account1 });
    const newSlashingLib = await SlashingLibrary.new(toWei("0.0032", "ether"), "0").send({ from: accounts[0] });
    console.log("newSlashingLib", newSlashingLib.options.address);
    await voting.methods.setSlashingLibrary(newSlashingLib.options.address).send({ from: accounts[0] });
    const time2 = time + 1;
    await voting.methods.requestPrice(identifier, time2).send({ from: registeredContract });
    await moveToNextRound(voting, accounts[0]);

    // commit and reveal a vote on the second price request.
    roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    baseRequest = { salt, roundId, identifier };
    hash1 = computeVoteHash({ ...baseRequest, price: price, account: account1, time: time2 });
    await voting.methods.commitVote(identifier, time2, hash1).send({ from: account1 });

    await moveToNextPhase(voting, accounts[0]);
    await voting.methods.revealVote(identifier, time2, price, salt).send({ from: account1 });

    // We should also be able to check that the round this request was voted on correctly had the new slashing lib frozen.
    assert.equal((await voting.methods.rounds(roundId).call()).slashingLibrary, newSlashingLib.options.address);

    // Move to next round, update all account slashing trackers and verify the slashing is applied as expected.
    await moveToNextRound(voting, accounts[0]);
    for (const account of [account1, account2, account3, account4])
      await voting.methods.updateTrackers(account).send({ from: account1 });

    // Cumulative slash on first round should be 0.0016 * (100mm-32mm) = 108800. Cumulative slash on second round should
    // be 0.0032 * (100mm-32mm-108800) = 217,251.84. We should therefore expect the balance of the account1 who
    // voted in both rounds to be 32mm + 108800 + 217,251.84 = 32326051.84
    assert.equal(await voting.methods.getVoterStakePostUpdate(account1).call(), toWei("32326051.84"));

    // Equally, we should see the stakers who did not participate slashed at the expected rates. Consider account2. They
    // did not vote in either request and should habve been slashed at 0.0016 for the first request as 32mm * 0.0016 = 51200
    // and for the second request at 0.0032 * (32mm-51200) = 102236.16. They should therefore have a balance of
    // 32mm - 51200 - 102236.16 = 31846563.84
    assert.equal(await voting.methods.getVoterStakePostUpdate(account2).call(), toWei("31846563.84"));
  });
  it("Can still resolve requests if voting contract migrates during vote cycle", async function () {
    // Consider the situation where during a voting cycle the voting contract is migrated to a new address. This could
    // happen if there are requests at the same time as a contract upgrade, for example. In this situation the prices that
    // were requested before the migration should still be able to be resolved.

    // Request a price.
    const identifier = padRight(utf8ToHex("test"), 64);
    const time = "1000";
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });
    await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });
    await moveToNextRound(voting, accounts[0]);

    // Say one voter is able to commit before the execution of the migration.
    const price = 123;
    const salt = getRandomSignedInt(); // use the same salt for all votes. bad practice but wont impact anything.
    let roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    let baseRequest = { salt, roundId, identifier };
    let hash1 = computeVoteHash({ ...baseRequest, price: price, account: account1, time: time });
    await voting.methods.commitVote(identifier, time, hash1).send({ from: account1 });

    // Now, before anyone else can commit the migration happens. This voter should be able to reveal and other voters
    // should be able to commit and reveal without issue, despite the migration.

    await voting.methods.setMigrated(rand).send({ from: account1 });

    let hash2 = computeVoteHash({ ...baseRequest, price: price, account: account2, time: time });
    await voting.methods.commitVote(identifier, time, hash2).send({ from: account2 });

    await moveToNextPhase(voting, accounts[0]);

    await voting.methods.revealVote(identifier, time, price, salt).send({ from: account1 });
    await voting.methods.revealVote(identifier, time, price, salt).send({ from: account2 });

    // The price should be resolved.
    await moveToNextRound(voting, accounts[0]);
    assert.equal(
      (await voting.methods.getPrice(identifier, time).call({ from: registeredContract })).toString(),
      price.toString()
    );

    // However, cant request another price as migrated.
    assert(
      await didContractThrow(voting.methods.requestPrice(identifier, time + 1).send({ from: registeredContract }))
    );
  });
  it("Changing max rolls while requests are unresolved does not impact requests", async function () {
    // Consider if requests are resolveable but before they can be resolved the maxRolls variable is changed. If this
    // was to happen then it is possible that requests that could be resolved get deleted before they resolve. To
    // protect against this the contract processes resolvable price requests before setting max rolls. To test this
    // we will construct a price request, vote on the request, move 2 rounds forward, then set maxRolls to a value
    // that would delete them. Without resolving the request, we will call setMaxRolls. the contract should resolve
    // these requests before setting the new max rolls.

    const identifier = padRight(utf8ToHex("test"), 64);
    const time = "1000";
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });
    await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });
    await moveToNextRound(voting, accounts[0]);

    const price = 123;
    const salt = getRandomSignedInt(); // use the same salt for all votes. bad practice but wont impact anything.
    let roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    let baseRequest = { salt, roundId, identifier };
    let hash1 = computeVoteHash({ ...baseRequest, price: price, account: account1, time: time });
    await voting.methods.commitVote(identifier, time, hash1).send({ from: account1 });

    // move to the next phase, reveal and change the slashing library and request another price to vote on in the next round.
    await moveToNextPhase(voting, accounts[0]);
    await voting.methods.revealVote(identifier, time, price, salt).send({ from: account1 });

    await moveToNextRound(voting, accounts[0]);
    await moveToNextRound(voting, accounts[0]);

    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberPendingPriceRequests, 1);
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberResolvedPriceRequests, 0);
    await voting.methods.setMaxRolls(1).send({ from: accounts[0] });

    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberPendingPriceRequests, 0);
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberResolvedPriceRequests, 1);

    // This action should have resolved the request.
    assert.equal(
      (await voting.methods.getPrice(identifier, time).call({ from: registeredContract })).toString(),
      price.toString()
    );
  });
  it("Increasing max rolls does not apply to existing requests that should be deleted", async function () {
    // Consider if requests are not resolvable and should have been deleted based on a current maxRolls variable. If
    // maxRolls value was extended this change should not apply retroactively and the contract should still delete
    // these requests. To test this we will construct a price request, roll it 3 rounds forward without a vote and then
    // extend maxRolls from its initial value of 2 to 3. The contract should delete the request as it was not
    // resolvable before the maxRolls extension.

    const identifier = padRight(utf8ToHex("test"), 64);
    const time = "1000";
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });
    await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });

    // Move to the round where price request should originally be voted on.
    await moveToNextRound(voting, accounts[0]);

    // Move 3 more rounds forward to make the request deletable based on the initial maxRolls of 2.
    await moveToNextRound(voting, accounts[0]);
    await moveToNextRound(voting, accounts[0]);
    await moveToNextRound(voting, accounts[0]);

    // Extend maxRolls to 3.
    await voting.methods.setMaxRolls(3).send({ from: accounts[0] });

    // Verify that the request was deleted.
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberPendingPriceRequests, 0);
    assert.equal((await voting.methods.getNumberOfPriceRequests().call()).numberResolvedPriceRequests, 0);
    assert(
      await didContractRevertWith(
        voting.methods.getPrice(identifier, time).call({ from: registeredContract }),
        "Price was never requested"
      )
    );
  });

  const addNonSlashingVote = async () => {
    // There is a known issue with the contract wherein you roll the first request multiple times which results in this
    // request being double slashed. We can avoid this by creating one request that is fully settled before the following
    // tests. However, we dont want to apply any slashing in this before-each block. To achieve this we can set the slash
    // lib to the ZeroedSlashingSlashingLibraryTest which applies no slashing, execute a vote, update all staking trackers
    // and set back the slashing lib to the original one.
    // Execute a full voting cycle
    const zeroedSlashingSlashingLibraryTest = await ZeroedSlashingSlashingLibraryTest.new().send({ from: accounts[0] });
    await voting.methods
      .setSlashingLibrary(zeroedSlashingSlashingLibraryTest.options.address)
      .send({ from: accounts[0] });
    let identifier = padRight(utf8ToHex("slash-test-advance"), 64);
    let time = "420";
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });

    await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });
    let salt = getRandomSignedInt();
    let price = "69696969";
    await moveToNextRound(voting, accounts[0]); // Move into the commit phase.

    let baseRequest = { salt, roundId: (await voting.methods.getCurrentRoundId().call()).toString(), identifier };
    const hash = computeVoteHash({ ...baseRequest, price, account: account1, time });
    await voting.methods.commitVote(identifier, time, hash).send({ from: account1 });
    await moveToNextPhase(voting, accounts[0]);
    await voting.methods.revealVote(identifier, time, price, salt).send({ from: account1 });
    await moveToNextRound(voting, accounts[0]);

    await voting.methods.updateTrackers(account1).send({ from: account1 });
    await voting.methods.updateTrackers(account2).send({ from: account2 });
    await voting.methods.updateTrackers(account3).send({ from: account3 });
    await voting.methods.updateTrackers(account4).send({ from: account4 });

    await voting.methods
      .setSlashingLibrary((await SlashingLibrary.deployed()).options.address)
      .send({ from: accounts[0] });
  };
  const submitManyRequests = async (numberOfMulticallCalls, numberOfRequestsPerMulticall, timeOffset = 0) => {
    const identifier = padRight(utf8ToHex("bulk"), 64);
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });
    const firstRequestTime = Number(await voting.methods.getCurrentTime().call()) - 10000;

    for (const j of [...Array(numberOfMulticallCalls).keys()]) {
      const priceRequestData = [];
      for (const i of [...Array(numberOfRequestsPerMulticall).keys()]) {
        const time = firstRequestTime + i + j * numberOfRequestsPerMulticall + timeOffset;
        priceRequestData.push(voting.methods.requestPrice(identifier, time).encodeABI());
      }
      await voting.methods.multicall(priceRequestData).send({ from: registeredContract });
    }
  };
});

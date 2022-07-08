const hre = require("hardhat");
const { web3 } = hre;
const { runVotingV2Fixture } = require("@uma/common");
const { getContract, assertEventEmitted, assertEventNotEmitted } = hre;
const {
  RegistryRolesEnum,
  didContractThrow,
  getRandomSignedInt,
  encryptMessage,
  deriveKeyPairFromSignatureTruffle,
  computeVoteHash,
  getKeyGenMessage,
} = require("@uma/common");
const { moveToNextRound, moveToNextPhase } = require("../../utils/Voting.js");
const { assert } = require("chai");
const { toBN } = web3.utils;

const Registry = getContract("Registry");
const VotingV2 = getContract("VotingV2");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const VotingToken = getContract("VotingToken");

const { utf8ToHex, padRight } = web3.utils;

const toWei = (value) => toBN(web3.utils.toWei(value, "ether"));

const assertGasVariation = (gasUsed, oldGasUsed, testName) => {
  if (gasUsed != oldGasUsed) {
    console.log(`Gas used variation for "${testName}": ${gasUsed - oldGasUsed}`);
    console.log(`New gas used: ${gasUsed}`);
  }
  assert(gasUsed <= oldGasUsed, `Gas used for "${testName}" is greater than previous gas used`);
};

describe("VotingV2 gas usage", function () {
  let voting, votingToken, registry, supportedIdentifiers, registeredContract;
  let accounts, account1, account2, account3, account4;

  beforeEach(async function () {
    accounts = await web3.eth.getAccounts();
    [account1, account2, account3, account4, registeredContract] = accounts;
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

    // Reset the rounds.
    await moveToNextRound(voting, accounts[0]);
  });

  it("Simple vote resolution", async function () {
    const expectedGas = 596014;
    let receipt;
    let gasUsed = 0;
    const identifier = padRight(utf8ToHex("simple-vote"), 64);
    const time = "1000";

    // Make the Oracle support this identifier.
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });

    // Request a price and move to the next round where that will be voted on.
    receipt = await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });
    gasUsed += receipt.gasUsed;

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
    receipt = await voting.methods.commitVote(identifier, time, hash).send({ from: accounts[0] });
    gasUsed += receipt.gasUsed;

    // Reveal the vote.
    await moveToNextPhase(voting, accounts[0]);

    receipt = await voting.methods.revealVote(identifier, time, price, salt).send({ from: accounts[0] });
    gasUsed += receipt.gasUsed;

    // Should resolve to the selected price since there was only one voter (100% for the mode) and the voter had enough
    // tokens to exceed the GAT.
    await moveToNextRound(voting, accounts[0]);
    assert.equal(
      (await voting.methods.getPrice(identifier, time).call({ from: registeredContract })).toString(),
      price.toString()
    );
    assertGasVariation(gasUsed, expectedGas, this.test.title);
  });

  it("Batches multiple commits into one", async function () {
    const expectedGas = 765229;
    let receipt;
    let gasUsed = 0;

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
    gasUsed += result.gasUsed;

    // This time we commit while storing the encrypted messages
    receipt = await voting.methods.batchCommit(priceRequests).send({ from: accounts[0] });
    gasUsed += receipt.gasUsed;

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
    receipt = await voting.methods
      .commitAndEmitEncryptedVote(
        modifiedPriceRequest.identifier,
        modifiedPriceRequest.time,
        modifiedPriceRequest.hash,
        modifiedPriceRequest.encryptedVote
      )
      .send({ from: accounts[0] });
    gasUsed += receipt.gasUsed;

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
    assertGasVariation(gasUsed, expectedGas, this.test.title);
  });

  it("Batch reveal multiple commits", async function () {
    const expectedGas = 356220;
    let receipt;
    let gasUsed = 0;
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
    receipt = await voting.methods
      .commitAndEmitEncryptedVote(identifier, time1, hash1, encryptedMessage)
      .send({ from: accounts[0] });
    gasUsed += receipt.gasUsed;
    receipt = await voting.methods.commitVote(identifier, time2, hash2).send({ from: accounts[0] });
    gasUsed += receipt.gasUsed;

    await moveToNextPhase(voting, accounts[0]);

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
    assertGasVariation(gasUsed, expectedGas, this.test.title);
  });

  it("Voter doesn't vote in 100 rounds", async function () {
    const expectedGas = 3169270;
    let receipt;
    let gasUsed = 0;
    const identifier = padRight(utf8ToHex("simple-vote"), 64);
    let time = 1000;

    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: account1 });
    const price = 123;
    const salt = getRandomSignedInt();

    for (let i = 0; i < 100; i++) {
      await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });
      await moveToNextRound(voting, account1);

      const roundId = (await voting.methods.getCurrentRoundId().call()).toString();
      // Commit vote.
      const hash = computeVoteHash({ price, salt, account: account1, time, roundId, identifier });
      await voting.methods.commitVote(identifier, time, hash).send({ from: account1 });

      // Reveal the vote.
      await moveToNextPhase(voting, account1);

      await voting.methods.revealVote(identifier, time, price, salt).send({ from: account1 });

      // Should resolve to the selected price since there was only one voter (100% for the mode) and the voter had enough
      // tokens to exceed the GAT.
      await moveToNextRound(voting, account1);
      assert.equal(
        (await voting.methods.getPrice(identifier, time).call({ from: registeredContract })).toString(),
        price.toString()
      );

      time++;
    }

    receipt = await voting.methods.withdrawRewards().send({ from: account2 });
    gasUsed += receipt.gasUsed;

    assertGasVariation(gasUsed, expectedGas, this.test.title);
  });
});

// TODO: add tests for staking/ustaking during a voting round. this can only be done once we've decided on this locking mechanism.

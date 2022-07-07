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
    const expectedGas = 589900;
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
    const expectedGas = 1056011;
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
    const expectedGas = 375186;
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

  // it("Multiple votes in the same voting round slash cumulatively", async function () {
  //   const expectedGas = 375150;
  //   let receipt;
  //   let gasUsed = 0;
  //   // Put two price requests into the same voting round.
  //   const identifier = padRight(utf8ToHex("slash-test"), 64); // Use the same identifier for both.
  //   const time1 = "420";
  //   const time2 = "421";
  //   await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });
  //   await voting.methods.requestPrice(identifier, time1).send({ from: registeredContract });
  //   await voting.methods.requestPrice(identifier, time2).send({ from: registeredContract });
  //   await moveToNextRound(voting, accounts[0]);
  //   const roundId = (await voting.methods.getCurrentRoundId().call()).toString();

  //   // Account1 and account4 votes correctly, account2 votes wrong in both votes and account3 does not vote in either.
  //   // Commit votes.
  //   const losingPrice = 123;
  //   const salt = getRandomSignedInt(); // use the same salt for all votes. bad practice but wont impact anything.
  //   const baseRequest = { salt, roundId, identifier };
  //   const hash1 = computeVoteHash({ ...baseRequest, price: losingPrice, account: account2, time: time1 });
  //   await voting.methods.commitVote(identifier, time1, hash1).send({ from: account2 });
  //   const hash2 = computeVoteHash({ ...baseRequest, price: losingPrice, account: account2, time: time2 });
  //   await voting.methods.commitVote(identifier, time2, hash2).send({ from: account2 });
  //   const winningPrice = 456;
  //   const hash3 = computeVoteHash({ ...baseRequest, price: winningPrice, account: account1, time: time1 });
  //   await voting.methods.commitVote(identifier, time1, hash3).send({ from: account1 });
  //   const hash4 = computeVoteHash({ ...baseRequest, price: winningPrice, account: account1, time: time2 });
  //   await voting.methods.commitVote(identifier, time2, hash4).send({ from: account1 });

  //   const hash5 = computeVoteHash({ ...baseRequest, price: winningPrice, account: account4, time: time1 });
  //   await voting.methods.commitVote(identifier, time1, hash5).send({ from: account4 });
  //   const hash6 = computeVoteHash({ ...baseRequest, price: winningPrice, account: account4, time: time2 });
  //   await voting.methods.commitVote(identifier, time2, hash6).send({ from: account4 });

  //   await moveToNextPhase(voting, accounts[0]); // Reveal the votes.

  //   await voting.methods.revealVote(identifier, time1, losingPrice, salt).send({ from: account2 });
  //   await voting.methods.revealVote(identifier, time2, losingPrice, salt).send({ from: account2 });
  //   await voting.methods.revealVote(identifier, time1, winningPrice, salt).send({ from: account1 });

  //   await voting.methods.revealVote(identifier, time2, winningPrice, salt).send({ from: account1 });

  //   await voting.methods.revealVote(identifier, time1, winningPrice, salt).send({ from: account4 });
  //   await voting.methods.revealVote(identifier, time2, winningPrice, salt).send({ from: account4 });

  //   await moveToNextRound(voting, accounts[0]);
  //   // Now call updateTrackers to update the slashing metrics. We should see a cumulative slashing amount increment and
  //   // the slash per wrong vote and slash per no vote set correctly.
  //   await voting.methods.updateTrackers(account1).send({ from: account1 });
  //   // Based off the votes in the batch we should see account2 slashed twice for voting wrong and account3 slashed twice
  //   // for not voting, both at a rate of 0.0016 tokens per vote. We should be able to see two separate request slashing
  //   // trackers. The totalSlashed should therefor be 32mm * 2 * 0.0016 = 102400 per slashing tracker. The total correct
  //   // votes should be account1 (32mm) and account4(4mm) as 46mm.
  //   const slashingTracker1 = await voting.methods.requestSlashingTrackers(0).call();
  //   assert.equal(slashingTracker1.wrongVoteSlashPerToken, toWei("0.0016"));
  //   assert.equal(slashingTracker1.noVoteSlashPerToken, toWei("0.0016"));
  //   assert.equal(slashingTracker1.totalSlashed, toWei("102400"));
  //   assert.equal(slashingTracker1.totalCorrectVotes, toWei("36000000"));
  //   const slashingTracker2 = await voting.methods.requestSlashingTrackers(1).call();
  //   assert.equal(slashingTracker2.wrongVoteSlashPerToken, toWei("0.0016"));
  //   assert.equal(slashingTracker2.noVoteSlashPerToken, toWei("0.0016"));
  //   assert.equal(slashingTracker2.totalSlashed, toWei("102400"));
  //   assert.equal(slashingTracker2.totalCorrectVotes, toWei("36000000"));
  //   // Now consider the impact on the individual voters cumulative staked amounts. First, let's consider the voters who
  //   // were wrong and lost balance. Account2 and Account3 were both wrong with 32mm tokens, slashed twice. They should
  //   // each loose 32mm * 2 * 0.0016 = 102400 tokens.
  //   await voting.methods.updateTrackers(account2).send({ from: account1 });
  //   assert.equal(
  //     (await voting.methods.voterStakes(account2).call()).cumulativeStaked,
  //     toWei("32000000").sub(toWei("102400")) // Their original stake amount of 32mm minus the slashing of 102400.
  //   );

  //   await voting.methods.updateTrackers(account3).send({ from: account1 });
  //   assert.equal(
  //     (await voting.methods.voterStakes(account3).call()).cumulativeStaked,
  //     toWei("32000000").sub(toWei("102400")) // Their original stake amount of 32mm minus the slashing of 102400.
  //   );

  //   // Now consider the accounts that should have accrued positive slashing. Account1 has 32mm and should have gotten
  //   // 32mm/(32mm+4mm) * 102400 * 2 = 182044.4444444444 (their fraction of the total slashed)
  //   // await voting.methods.updateTrackers(account1).send({ from: account1 });
  //   assert.equal(
  //     (await voting.methods.voterStakes(account1).call()).cumulativeStaked,
  //     toWei("32000000").add(toBN("182044444444444444444444")) // Their original stake amount of 32mm plus the slash of 182044.4
  //   );

  //   // Account4 has 4mm and should have gotten 4mm/(32mm+4mm) * 102400 * 2 = 22755.555 (their fraction of the total slashed)
  //   await voting.methods.updateTrackers(account4).send({ from: account4 });
  //   assert.equal(
  //     (await voting.methods.voterStakes(account4).call()).cumulativeStaked,
  //     toWei("4000000").add(toBN("22755555555555555555554")) // Their original stake amount of 4mm plus the slash of 22755.555
  //   );
  // });
  // it("votes slashed over multiple voting rounds with no claims in between", async function () {
  //   // Consider multiple voting rounds with no one claiming rewards/restaging ect(to update the slashing accomulators).
  //   // Contract should correctly accomidate this over the interval.
  //   // Put two price requests into the same voting round.
  //   const identifier = padRight(utf8ToHex("slash-test"), 64); // Use the same identifier for both.
  //   const time1 = "420";

  //   await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });
  //   await voting.methods.requestPrice(identifier, time1).send({ from: registeredContract });
  //   await moveToNextRound(voting, accounts[0]);
  //   const roundId = (await voting.methods.getCurrentRoundId().call()).toString();

  //   // Account1 and account4 votes correctly, account2 votes wrong and account3 does not vote..
  //   // Commit votes.
  //   const losingPrice = 123;
  //   const salt = getRandomSignedInt(); // use the same salt for all votes. bad practice but wont impact anything.
  //   const baseRequest = { salt, roundId, identifier };
  //   const hash1 = computeVoteHash({ ...baseRequest, price: losingPrice, account: account2, time: time1 });

  //   await voting.methods.commitVote(identifier, time1, hash1).send({ from: account2 });

  //   const winningPrice = 456;
  //   const hash2 = computeVoteHash({ ...baseRequest, price: winningPrice, account: account1, time: time1 });
  //   await voting.methods.commitVote(identifier, time1, hash2).send({ from: account1 });

  //   const hash3 = computeVoteHash({ ...baseRequest, price: winningPrice, account: account4, time: time1 });
  //   await voting.methods.commitVote(identifier, time1, hash3).send({ from: account4 });

  //   await moveToNextPhase(voting, accounts[0]); // Reveal the votes.

  //   await voting.methods.revealVote(identifier, time1, losingPrice, salt).send({ from: account2 });
  //   await voting.methods.revealVote(identifier, time1, winningPrice, salt).send({ from: account1 });
  //   await voting.methods.revealVote(identifier, time1, winningPrice, salt).send({ from: account4 });

  //   const time2 = "690";
  //   await voting.methods.requestPrice(identifier, time2).send({ from: registeredContract });
  //   await moveToNextRound(voting, accounts[0]);
  //   const roundId2 = (await voting.methods.getCurrentRoundId().call()).toString();
  //   // In this vote say that Account1 and account3 votes correctly, account4 votes wrong and account2 does not vote.
  //   const baseRequest2 = { salt, roundId: roundId2, identifier };
  //   const hash4 = computeVoteHash({ ...baseRequest2, price: losingPrice, account: account4, time: time2 });

  //   await voting.methods.commitVote(identifier, time2, hash4).send({ from: account4 });

  //   const hash5 = computeVoteHash({ ...baseRequest2, price: winningPrice, account: account1, time: time2 });
  //   await voting.methods.commitVote(identifier, time2, hash5).send({ from: account1 });

  //   const hash6 = computeVoteHash({ ...baseRequest2, price: winningPrice, account: account3, time: time2 });
  //   await voting.methods.commitVote(identifier, time2, hash6).send({ from: account3 });

  //   await moveToNextPhase(voting, accounts[0]); // Reveal the votes.

  //   await voting.methods.revealVote(identifier, time2, losingPrice, salt).send({ from: account4 });
  //   await voting.methods.revealVote(identifier, time2, winningPrice, salt).send({ from: account1 });
  //   await voting.methods.revealVote(identifier, time2, winningPrice, salt).send({ from: account3 });

  //   await moveToNextRound(voting, accounts[0]);

  //   // Now call updateTrackers to update the slashing metrics. We should see a cumulative slashing amount increment and
  //   // the slash per wrong vote and slash per no vote set correctly.
  //   await voting.methods.updateTrackers(account1).send({ from: account1 });

  //   // Based off the vote batch we should see two request slashing trackers for each of the two votes. The first one should
  //   // have a total slashing of 32mm * 2*0.0016 = 102400 (same as previous test.)
  //   const slashingTracker1 = await voting.methods.requestSlashingTrackers(0).call();
  //   assert.equal(slashingTracker1.wrongVoteSlashPerToken, toWei("0.0016"));
  //   assert.equal(slashingTracker1.noVoteSlashPerToken, toWei("0.0016"));
  //   assert.equal(slashingTracker1.totalSlashed, toWei("102400"));
  //   assert.equal(slashingTracker1.totalCorrectVotes, toWei("36000000")); // 32mm + 4mm

  //   // After the first round of voting there was some slashing that happened which impacts the slashing trackers in the
  //   // second round! This differs from the previous test as there has been some time evolution between the rounds in this
  //   // test, which was not the case in the previous test where there were multiple votes in the same round. Expect:
  //   // account1 gains 32mm/(32mm+4mm)*102400. account2 looses 32mm/(32mm+32mm)*102400. account3 looses 32mm/(32mm+32mm)*102400
  //   // and account4 gains 4mm/(32mm+4mm)*102400. For the next round of votes, considering these balances, the total
  //   // correct votes will be account1 + account3 so (32mm+91022.222) + (32mm-51200)=64039822.222. Slashed votes will be
  //   // (account2+account4) * 0.0016 = [(32mm-51200)+(4mm+11377.77)]*0.0016=57536.284432
  //   //
  //   // For the second slashing tracker we had 32mm * 2 correct votes and wrong votes was 34mm + 4mm. Slashing should then
  //   // be 36mm * 0.0016 = 57600
  //   const slashingTracker2 = await voting.methods.requestSlashingTrackers(1).call();
  //   assert.equal(slashingTracker2.wrongVoteSlashPerToken, toWei("0.0016"));
  //   assert.equal(slashingTracker2.noVoteSlashPerToken, toWei("0.0016"));
  //   assert.equal(slashingTracker2.totalSlashed, toBN("57536284444444444444444"));
  //   assert.equal(slashingTracker2.totalCorrectVotes, toBN("64039822222222222222222222"));

  //   // Now consider the impact on the individual voters cumulative staked amounts. This is a bit more complex than
  //   // previous tests as there was multiple voting rounds and voters were slashed between the rounds. Account1 voted
  //   // correctly both times. In the first voting round they should have accumulated 32mm/(36mm)*102400 = 91022.2222222
  //   // and in the second they accumulated (32mm+91022.2222222)/(64039822.222) * 57536.284432 = 28832.0316 (note here
  //   // we factored in the balance from round 1+ the rewards from round 1 and then took the their share of the total
  //   // correct votes) resulting a a total positive slashing of 91022.2222222+28832.0316=119854.2538959
  //   // await voting.methods.updateTrackers(account1).send({ from: account1 });
  //   assert.equal(
  //     (await voting.methods.voterStakes(account1).call()).cumulativeStaked,
  //     toWei("32000000").add(toBN("119854253895946226051937")) // Their original stake amount of 32mm minus the slashing of 119854.25389.
  //   );

  //   // Account2 voted wrong the first time and did not vote the second time. They should get slashed at 32mm*0.0016=51200
  //   // for the first slash and at (32mm-51200)*0.0016=51118.08 for the second slash. This totals 102318.08.

  //   await voting.methods.updateTrackers(account2).send({ from: account2 });
  //   assert.equal(
  //     (await voting.methods.voterStakes(account2).call()).cumulativeStaked,
  //     toWei("32000000").sub(toWei("102318.08")) // Their original stake amount of 32mm minus the slashing of 102318.08.
  //   );

  //   // Account3 did not vote the first time and voted correctly the second time. They should get slashed at 32mm*0.0016
  //   // = 51200 for the first vote and then on the second vote they should get (32mm-51200)/(64039822.22)*57536.284=28704.2525
  //   // Overall they should have a resulting slash of -22495.7474
  //   await voting.methods.updateTrackers(account3).send({ from: account3 });
  //   assert.equal(
  //     (await voting.methods.voterStakes(account3).call()).cumulativeStaked,
  //     toWei("32000000").sub(toBN("22495747229279559385272")) // Their original stake amount of 32mm minus the slash of 22495.7474
  //   );

  //   // Account4 has 4mm and voted correctly the first time and wrong the second time. On the first vote they should have
  //   // gotten 4mm/(32mm+4mm)*102400=11377.77 and on the second vote they should have lost (4mm+11377.77)*0.0016*57536.284
  //   // =6418.204432. Overall they should have gained 4959.56

  //   await voting.methods.updateTrackers(account4).send({ from: account4 });
  //   assert.equal(
  //     (await voting.methods.voterStakes(account4).call()).cumulativeStaked,
  //     toWei("4000000").add(toBN("4959573333333333333333")) // Their original stake amount of 4mm plus the slash of 4959.56.
  //   );
  // });
});

// TODO: add tests for staking/ustaking during a voting round. this can only be done once we've decided on this locking mechanism.

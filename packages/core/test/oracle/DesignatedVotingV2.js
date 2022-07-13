const hre = require("hardhat");
const { web3 } = hre;
const { toBN } = web3.utils;
const { runVotingV2Fixture } = require("@uma/common");
const { getContract } = hre;
const { RegistryRolesEnum, didContractThrow, getRandomSignedInt, computeVoteHashAncillary } = require("@uma/common");
const { assert } = require("chai");

const DesignatedVotingV2 = getContract("DesignatedVotingV2");
const Finder = getContract("Finder");
const Registry = getContract("Registry");
const VotingV2 = getContract("VotingV2");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const VotingToken = getContract("VotingToken");
const { moveToNextRound, moveToNextPhase } = require("../../utils/Voting.js");
const { utf8ToHex, padRight } = web3.utils;

describe("DesignatedVotingV2", function () {
  let accounts, umaAdmin, tokenOwner, voter, registeredContract;
  let voting, votingToken, designatedVoting, supportedIdentifiers, tokenBalance;

  // Corresponds to DesignatedVoting.Roles.Voter.
  const voterRole = "1";

  const advanceTime = async (time) => {
    await voting.methods
      .setCurrentTime(Number(await voting.methods.getCurrentTime().call()) + time)
      .send({ from: accounts[0] });
  };

  beforeEach(async function () {
    accounts = await web3.eth.getAccounts();
    [umaAdmin, tokenOwner, voter, registeredContract] = accounts;
    await runVotingV2Fixture(hre);
    voting = await VotingV2.deployed();
    supportedIdentifiers = await IdentifierWhitelist.deployed();
    votingToken = await VotingToken.deployed();
    const finder = await Finder.deployed();
    designatedVoting = await DesignatedVotingV2.new(finder.options.address, tokenOwner, voter).send({
      from: accounts[0],
    });

    tokenBalance = web3.utils.toWei("10000000"); // 10mm tokens to gve to the designated voting contract.
    // The admin can burn tokens for the purposes of this test.
    await votingToken.methods.addMember("2", umaAdmin).send({ from: accounts[0] });
    await votingToken.methods.transfer(tokenOwner, tokenBalance).send({ from: umaAdmin });

    const registry = await Registry.deployed();
    await registry.methods.addMember(RegistryRolesEnum.CONTRACT_CREATOR, umaAdmin).send({ from: accounts[0] });
    await registry.methods.registerContract([], registeredContract).send({ from: umaAdmin });

    // Reset the rounds.
    await moveToNextRound(voting, accounts[0]);
  });

  it("Deposit and withdraw", async function () {
    assert.equal(await votingToken.methods.balanceOf(tokenOwner).call(), tokenBalance);
    assert.equal(await votingToken.methods.balanceOf(designatedVoting.options.address).call(), web3.utils.toWei("0"));

    // The owner can transfer tokens into DesignatedVoting.
    await votingToken.methods.transfer(designatedVoting.options.address, tokenBalance).send({ from: tokenOwner });
    assert.equal(await votingToken.methods.balanceOf(tokenOwner).call(), web3.utils.toWei("0"));
    assert.equal(await votingToken.methods.balanceOf(designatedVoting.options.address).call(), tokenBalance);

    // Neither the designated voter nor the UMA admin can withdraw tokens.
    assert(
      await didContractThrow(
        designatedVoting.methods.withdrawErc20(votingToken.options.address, tokenBalance).send({ from: voter })
      )
    );
    assert(
      await didContractThrow(
        designatedVoting.methods.withdrawErc20(votingToken.options.address, tokenBalance).send({ from: umaAdmin })
      )
    );

    // `tokenOwner` can withdraw tokens.
    await designatedVoting.methods.withdrawErc20(votingToken.options.address, tokenBalance).send({ from: tokenOwner });
    assert.equal(await votingToken.methods.balanceOf(tokenOwner).call(), tokenBalance);
    assert.equal(await votingToken.methods.balanceOf(designatedVoting.options.address).call(), web3.utils.toWei("0"));
  });

  it("Stake, request unstake and executeUnstake", async function () {
    // Deposit tokens into designated token contract.
    await votingToken.methods.transfer(designatedVoting.options.address, tokenBalance).send({ from: tokenOwner });

    // Stake tokens into the voting contract. Only the token owner can execute the stake call.
    assert(
      await didContractThrow(designatedVoting.methods.stake(tokenBalance, voting.options.address).send({ from: voter }))
    );
    assert(
      await didContractThrow(
        designatedVoting.methods.stake(tokenBalance, voting.options.address).send({ from: umaAdmin })
      )
    );
    assert.equal(await votingToken.methods.balanceOf(designatedVoting.options.address).call(), tokenBalance);
    await designatedVoting.methods.stake(tokenBalance, voting.options.address).send({ from: tokenOwner });
    assert.equal(await votingToken.methods.balanceOf(designatedVoting.options.address).call(), 0);
    assert.equal(await votingToken.methods.balanceOf(voting.options.address).call(), tokenBalance);

    // Voting contract should now have a stake balance for the designatedVoting contract.
    assert.equal((await voting.methods.voterStakes(designatedVoting.options.address).call()).activeStake, tokenBalance);

    // Only the token owner can request to unstake.
    assert(
      await didContractThrow(
        designatedVoting.methods.requestUnstake(tokenBalance, voting.options.address).send({ from: voter })
      )
    );
    assert(
      await didContractThrow(
        designatedVoting.methods.requestUnstake(tokenBalance, voting.options.address).send({ from: umaAdmin })
      )
    );
    await designatedVoting.methods.requestUnstake(tokenBalance, voting.options.address).send({ from: tokenOwner });

    assert.equal(
      (await voting.methods.voterStakes(designatedVoting.options.address).call()).pendingUnstake,
      tokenBalance
    );

    // Advance time so the unstake can be executed.
    await advanceTime(60 * 60 * 24 * 30 + 1);

    await designatedVoting.methods.executeUnstake(voting.options.address).send({ from: tokenOwner });
    assert.equal(await votingToken.methods.balanceOf(designatedVoting.options.address).call(), tokenBalance);
    assert.equal(await votingToken.methods.balanceOf(voting.options.address).call(), 0);
  });

  it("Reverts passed through", async function () {
    // Verify that there are no silent failures, and reverts get bubbled up.
    assert(
      await didContractThrow(
        designatedVoting.methods
          .commitVote(padRight(utf8ToHex("bad"), 64), "100", "0x0", "0x123456")
          .send({ from: voter })
      )
    );
    assert(
      await didContractThrow(
        designatedVoting.methods
          .revealVote(padRight(utf8ToHex("bad"), 64), "100", "200", "0x123456", "300")
          .send({ from: voter })
      )
    );
  });

  it("Commit, reveal and retrieve", async function () {
    await votingToken.methods.transfer(designatedVoting.options.address, tokenBalance).send({ from: tokenOwner });
    await designatedVoting.methods.stake(tokenBalance, voting.options.address).send({ from: tokenOwner });
    const stakeTime = await voting.methods.getCurrentTime().call();

    // Request a price.
    const identifier = padRight(utf8ToHex("one-voter"), 64);
    const time = "1000";
    const ancillaryData = "0x123456";
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });
    await voting.methods.requestPrice(identifier, time, ancillaryData).send({ from: registeredContract });
    await moveToNextRound(voting, accounts[0]);
    let roundId = await voting.methods.getCurrentRoundId().call();

    const price = getRandomSignedInt();
    const salt = getRandomSignedInt();
    // Note: the "voter" address for this vote must be the designated voting contract since its the one that will ultimately
    // "reveal" the vote. Only the voter can call reveal through the designated voting contract.
    const hash = computeVoteHashAncillary({
      price,
      salt,
      account: designatedVoting.options.address,
      time,
      ancillaryData: ancillaryData,
      roundId,
      identifier,
    });

    // Only the voter can commit a vote.
    assert(
      await didContractThrow(
        designatedVoting.methods.commitVote(identifier, time, ancillaryData, hash).send({ from: tokenOwner })
      )
    );
    assert(
      await didContractThrow(
        designatedVoting.methods.commitVote(identifier, time, ancillaryData, hash).send({ from: umaAdmin })
      )
    );
    await designatedVoting.methods.commitVote(identifier, time, ancillaryData, hash).send({ from: voter });

    // The UMA admin can't add new voters.
    assert(await didContractThrow(designatedVoting.methods.resetMember(voterRole, umaAdmin).send({ from: umaAdmin })));

    // Move to the reveal phase.
    await moveToNextPhase(voting, accounts[0]);

    // Only the voter can reveal a vote.
    assert(
      await didContractThrow(
        designatedVoting.methods.revealVote(identifier, time, price, ancillaryData, salt).send({ from: tokenOwner })
      )
    );
    assert(
      await didContractThrow(
        designatedVoting.methods.revealVote(identifier, time, price, ancillaryData, salt).send({ from: umaAdmin })
      )
    );
    await designatedVoting.methods.revealVote(identifier, time, price, ancillaryData, salt).send({ from: voter });

    // Check the resolved price.
    roundId = await voting.methods.getCurrentRoundId().call();
    await moveToNextRound(voting, accounts[0]);
    assert.equal(
      (await voting.methods.getPrice(identifier, time, ancillaryData).call({ from: registeredContract })).toString(),
      price
    );

    // Retrieve rewards and check that rewards accrued to the `designatedVoting` contract.
    assert(await didContractThrow(designatedVoting.methods.retrieveRewards().send({ from: tokenOwner })));
    assert(await didContractThrow(designatedVoting.methods.retrieveRewards().send({ from: umaAdmin })));

    await designatedVoting.methods.retrieveRewards().send({ from: voter });
    // We should see the cumulative staked amount go up by the amount of the rewards. We had advanced time one phase and
    // one voting round. This should result in an expected reward of the emission rate times the delta in time as this
    // was the only staker they get the full reward amount.
    const retrievalTime = await voting.methods.getCurrentTime().call();

    const expectedReward = toBN(await voting.methods.emissionRate().call()).mul(toBN(retrievalTime - stakeTime));

    assert.equal(
      (await voting.methods.voterStakes(designatedVoting.options.address).call()).activeStake,
      expectedReward.add(toBN(tokenBalance))
    );
  });

  it("Batch commit and reveal", async function () {
    await votingToken.methods.transfer(designatedVoting.options.address, tokenBalance).send({ from: tokenOwner });
    await designatedVoting.methods.stake(tokenBalance, voting.options.address).send({ from: tokenOwner });

    // Request a price.
    const identifier = padRight(utf8ToHex("batch"), 64);
    const time1 = "1000";
    const ancillaryData1 = "0x11111111";
    const time2 = "2000";
    const ancillaryData2 = "0x2222";
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });
    await voting.methods.requestPrice(identifier, time1, ancillaryData1).send({ from: registeredContract });
    await voting.methods.requestPrice(identifier, time2, ancillaryData2).send({ from: registeredContract });
    await moveToNextRound(voting, accounts[0]);

    const roundId = await voting.methods.getCurrentRoundId().call();

    const price1 = getRandomSignedInt();
    const salt1 = getRandomSignedInt();
    const hash1 = computeVoteHashAncillary({
      price: price1,
      salt: salt1,
      account: designatedVoting.options.address,
      time: time1,
      ancillaryData: ancillaryData1,
      roundId,
      identifier,
    });
    const message1 = web3.utils.randomHex(4);

    const price2 = getRandomSignedInt();
    const salt2 = getRandomSignedInt();
    const hash2 = computeVoteHashAncillary({
      price: price2,
      salt: salt2,
      account: designatedVoting.options.address,
      time: time2,
      ancillaryData: ancillaryData2,
      roundId,
      identifier,
    });
    const message2 = web3.utils.randomHex(4);

    // Batch commit.
    const commitData = [
      designatedVoting.methods
        .commitAndEmitEncryptedVote(identifier, time1, ancillaryData1, hash1, message1)
        .encodeABI(),
      designatedVoting.methods
        .commitAndEmitEncryptedVote(identifier, time2, ancillaryData2, hash2, message2)
        .encodeABI(),
    ];
    assert(await didContractThrow(designatedVoting.methods.multicall(commitData).send({ from: tokenOwner })));
    await designatedVoting.methods.multicall(commitData).send({ from: voter });

    // Move to the reveal phase.
    await moveToNextPhase(voting, accounts[0]);

    // Check messages in emitted events.
    let events = await voting.getPastEvents("EncryptedVote", { fromBlock: 0, filter: { identifier } });
    assert.equal(events[events.length - 2].returnValues.encryptedVote, message1);
    assert.equal(events[events.length - 1].returnValues.encryptedVote, message2);

    // Batch reveal.
    const revealData = [
      designatedVoting.methods.revealVote(identifier, time1, price1, ancillaryData1, salt1).encodeABI(),
      designatedVoting.methods.revealVote(identifier, time2, price2, ancillaryData2, salt2).encodeABI(),
    ];

    assert(await didContractThrow(designatedVoting.methods.multicall(revealData).send({ from: tokenOwner })));
    await designatedVoting.methods.multicall(revealData).send({ from: voter });

    // Check the resolved price.
    await moveToNextRound(voting, accounts[0]);
    assert.equal(
      (await voting.methods.getPrice(identifier, time1, ancillaryData1).call({ from: registeredContract })).toString(),
      price1
    );
    assert.equal(
      (await voting.methods.getPrice(identifier, time2, ancillaryData2).call({ from: registeredContract })).toString(),
      price2
    );
  });
});

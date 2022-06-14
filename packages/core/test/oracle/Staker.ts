const hre = require("hardhat");
const { web3 } = hre;
const { runDefaultFixture } = require("@uma/common");
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
const { toBN, utf8ToHex, padRight } = web3.utils;

const Finder = getContract("Finder");
const Registry = getContract("Registry");
const Staker = getContract("Staker");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const VotingToken = getContract("VotingToken");
const VotingTest = getContract("VotingTest");
const Timer = getContract("Timer");

const snapshotMessage = "Sign For Snapshot";
const identifier1 = padRight(utf8ToHex("request-retrieval1"), 64);
const identifier2 = padRight(utf8ToHex("request-retrieval2"), 64);

const toWei = (value) => toBN(web3.utils.toWei(value, "ether"));

describe("Staker", function () {
  let staker, votingToken, registry, supportedIdentifiers, registeredContract, unregisteredContract, migratedVoting;
  let accounts, account1, account2, account3, account4, signature;

  const advanceTime = async (time) => {
    await staker.methods
      .setCurrentTime(Number(await staker.methods.getCurrentTime().call()) + time)
      .send({ from: account1 });
  };

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [account1, account2, account3, account4, registeredContract, unregisteredContract, migratedVoting] = accounts;
    await runDefaultFixture(hre);
    staker = await await Staker.deployed();
    votingToken = await VotingToken.deployed();
    registry = await Registry.deployed();
    supportedIdentifiers = await IdentifierWhitelist.deployed();

    // Allow account1 to mint tokens.
    const minterRole = 1;
    await votingToken.methods.addMember(minterRole, account1).send({ from: accounts[0] });
    await votingToken.methods.addMember(minterRole, staker.options.address).send({ from: accounts[0] });

    // account1 starts with 100MM tokens, so divide up the tokens accordingly:
    // 1: 32MM
    // 2: 32MM
    // 3: 32MM
    // 4: 4MM (can't reach the 5% GAT alone)
    await votingToken.methods.transfer(account2, toWei("32000000")).send({ from: account1 });
    await votingToken.methods.approve(staker.options.address, toWei("32000000")).send({ from: account2 });
    await votingToken.methods.transfer(account3, toWei("32000000")).send({ from: account1 });
    await votingToken.methods.approve(staker.options.address, toWei("32000000")).send({ from: account3 });
    await votingToken.methods.transfer(account4, toWei("4000000")).send({ from: account1 });
    await votingToken.methods.approve(staker.options.address, toWei("32000000")).send({ from: account4 });

    // Register contract with Registry.
    await registry.methods.addMember(RegistryRolesEnum.CONTRACT_CREATOR, account1).send({ from: account1 });
    await registry.methods.registerContract([], registeredContract).send({ from: account1 });
    signature = await signMessage(web3, snapshotMessage, account1);
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier1).send({ from: accounts[0] });
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier2).send({ from: accounts[0] });

    // Reset the rounds.
    await moveToNextRound(staker, accounts[0]);
  });
  describe("Staking: rewards accumulation", function () {
    it("Staking accumulates prorata rewards over time", async function () {
      const amountToStake = toWei("100");
      await staker.methods.stake(amountToStake).send({ from: account2 });
      const stakingBalance = await staker.methods.stakingBalances(account2).call();
      assert.equal(stakingBalance.cumulativeStaked, amountToStake);

      // Advance time forward 1000 seconds. At an emission rate of 0.64 per second we should see the accumulation of
      // all rewards equal to the amount staked * 1000 * 0.64 = 640.
      await advanceTime(1000);
      assert.equal(await staker.methods.outstandingRewards(account2).call(), toWei("640"));

      // Claim the rewards and ensure balances update accordingly.
      const balanceBefore = await votingToken.methods.balanceOf(account2).call();
      await staker.methods.withdrawRewards().send({ from: account2 });
      const balanceAfter = await votingToken.methods.balanceOf(account2).call();
      assert.equal(balanceAfter, toWei("640").add(toBN(balanceBefore)));

      // Now have account3 stake 3x the amount of account2. Ensure a prorata split of future rewards as 1/4 3/4ths.
      await staker.methods.stake(amountToStake.muln(3)).send({ from: account3 });

      // Advance time forward 1000 seconds. At an emission rate of 0.64 per second we should see the accumulation of
      // 1/4*640=160 to account1 and 2/3*640=480 to account3.
      await advanceTime(1000);
      assert.equal(await staker.methods.outstandingRewards(account2).call(), toWei("160"));
      assert.equal(await staker.methods.outstandingRewards(account3).call(), toWei("480"));

      // Next, stake 2x the original amount of tokens from another account. This should result in a prorata split of
      // rewards with account2 staking 1/6th, account3 staking 3/6 and account4 staking 2/6. Subsequent rewards should
      // correctly factor in the 160 & 480 rewards split between account2 and account3 that have not yet been claimed.
      // This shows the correct "memory" of the staking system with subsequent stakes.
      await staker.methods.stake(amountToStake.muln(2)).send({ from: account4 });

      // Over 1500 seconds we should emit a total of 1500 * 0.64 = 960 rewards.
      //    Account2: 160 + 1/6 * 960 = 320
      //    Account3: 480 + 3/6 * 960 = 960
      //    Account4: 0   + 2/6 * 960 = 320
      await advanceTime(1500);
      assert.equal(await staker.methods.outstandingRewards(account2).call(), toWei("320"));
      assert.equal(await staker.methods.outstandingRewards(account3).call(), toWei("960"));
      assert.equal(await staker.methods.outstandingRewards(account4).call(), toWei("320"));
    });

    it("Unstaking is correctly blocked for unlock time", async function () {
      const amountToStake = toWei("100");
      await staker.methods.stake(amountToStake).send({ from: account2 });

      // Attempting to unstake without requesting.
      assert(await didContractThrow(staker.methods.executeUnstake().send({ from: account2 })));

      // Request unstake but dont wait long enough should also revert.
      await staker.methods.requestUnstake(amountToStake).send({ from: account2 });
      assert(await didContractThrow(staker.methods.executeUnstake().send({ from: account2 })));
      await advanceTime(1000);
      assert(await didContractThrow(staker.methods.executeUnstake().send({ from: account2 })));

      // Now advance the 1 month required to unstake.
      await advanceTime(60 * 60 * 24 * 30);
      const balanceBefore = await votingToken.methods.balanceOf(account2).call();
      await staker.methods.executeUnstake().send({ from: account2 });
      const balanceAfter = await votingToken.methods.balanceOf(account2).call();
      assert.equal(balanceAfter, toWei("100").add(toBN(balanceBefore))); // Should get back the original amount staked.

      // Accumulated rewards over the interval should be the full 0.64 percent, grown over 30 days + 1000 seconds.
      // This should be 0.64 * (60 * 60 * 24 * 30 + 1000) = 1659520.
      assert.equal(await staker.methods.outstandingRewards(account2).call(), toWei("1659520"));
      await staker.methods.withdrawRewards().send({ from: account2 });
      assert.equal(await votingToken.methods.balanceOf(account2).call(), toBN(balanceAfter).add(toWei("1659520")));

      // No further rewards should accumulate to the staker as they have claimed and unstked the full amount.
      assert.equal(await staker.methods.outstandingRewards(account2).call(), toWei("0"));
      await advanceTime(1000);
      assert.equal(await staker.methods.outstandingRewards(account2).call(), toWei("0"));
    });
    describe("Slashing: reward removal", function () {
      it.only("Slashing: no vote", async function () {
        // Stake the full balance of account2 and account3. they both have 32mm tokens.
        const amountToStake = await votingToken.methods.balanceOf(account2).call();
        await staker.methods.stake(amountToStake).send({ from: account2 });
        await staker.methods.stake(amountToStake).send({ from: account3 });

        // Advance time forward 1000 seconds. At an emission rate of 0.64 per second we should see the accumulation of
        // half of all rewards equal to the amount staked * 1000 * 0.64 * 1/2 = 320 to each account.
        await advanceTime(1000);
        assert.equal(await staker.methods.outstandingRewards(account2).call(), toWei("320"));
        assert.equal(await staker.methods.outstandingRewards(account3).call(), toWei("320"));

        // Now have a price request but only have one participate in the vote.
        const price = "42069";
        const time = "1000";
        await staker.methods.requestPrice(identifier1, time).send({ from: registeredContract });

        // Make the Oracle support these two identifiers.
        await supportedIdentifiers.methods.addSupportedIdentifier(identifier1).send({ from: accounts[0] });

        // Move to the voting round.
        await moveToNextRound(staker, accounts[0]);
        const roundId = (await staker.methods.getCurrentRoundId().call()).toString();

        // Commit vote ONLY from account3.
        const salt = getRandomSignedInt();
        const hash = computeVoteHash({ price, salt, account: account3, time, roundId, identifier: identifier1 });

        await staker.methods.commitVote(identifier1, time, hash).send({ from: account3 });

        // Move to the reveal phase of the voting period.
        await moveToNextPhase(staker, accounts[0]);

        await staker.methods.snapshotCurrentRound(signature).send({ from: account1 });
        await staker.methods.revealVote(identifier1, time, price, salt).send({ from: account3 });

        // Move past the voting round.
        await moveToNextRound(staker, accounts[0]);

        assert.isTrue(await staker.methods.hasPrice(identifier1, time).call({ from: registeredContract }));

        assert.equal(
          (await staker.methods.getPrice(identifier1, time).call({ from: registeredContract })).toString(),
          price.toString()
        );
      });
    });
  });
});

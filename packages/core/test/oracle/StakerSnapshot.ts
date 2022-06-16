const hre = require("hardhat");
const { web3 } = hre;
const { runDefaultFixture } = require("@uma/common");
const { getContract, assertEventEmitted, assertEventNotEmitted } = hre;
const { RegistryRolesEnum, didContractThrow, computeVoteHash, computeVoteHashAncillary } = require("@uma/common");

const { assert } = require("chai");
const { toBN, utf8ToHex, padRight } = web3.utils;

const StakerSnapshotTest = getContract("StakerSnapshotTest");
const VotingToken = getContract("VotingToken");
const VotingTest = getContract("VotingTest");
const Timer = getContract("Timer");

const identifier1 = padRight(utf8ToHex("request-retrieval1"), 64);
const identifier2 = padRight(utf8ToHex("request-retrieval2"), 64);

const toWei = (value) => toBN(web3.utils.toWei(value, "ether"));

const emissionRate = "640000000000000000"; // Approximately 20% APY with a total supply of 100mm tokens.
const unstakeCoolDown = 60 * 60 * 30; // 1 month.

const amountToStake = toWei("1000");

describe("StakerSnapshot", function () {
  let staker, votingToken, timer, accounts, account1, account2, account3;

  const advanceTime = async (time) => {
    await staker.methods
      .setCurrentTime(Number(await staker.methods.getCurrentTime().call()) + time)
      .send({ from: account1 });
  };

  beforeEach(async function () {
    accounts = await web3.eth.getAccounts();
    [account1, account2, account3] = accounts;
    await runDefaultFixture(hre);
    votingToken = await VotingToken.deployed();
    timer = await Timer.deployed();

    staker = await StakerSnapshotTest.new(
      emissionRate,
      unstakeCoolDown,
      votingToken.options.address,
      timer.options.address
    ).send({
      from: account1,
    });

    // Allow account1 to mint tokens.
    const minterRole = 1;
    await votingToken.methods.addMember(minterRole, account1).send({ from: account1 });
    await votingToken.methods.addMember(minterRole, staker.options.address).send({ from: account1 });

    // Account1 starts with 100MM tokens. Send 32mm to the other three accounts.
    await votingToken.methods.approve(staker.options.address, toWei("32000000")).send({ from: account1 });
    await votingToken.methods.transfer(account2, toWei("32000000")).send({ from: account1 });
    await votingToken.methods.approve(staker.options.address, toWei("32000000")).send({ from: account2 });
    await votingToken.methods.transfer(account3, toWei("32000000")).send({ from: account1 });
    await votingToken.methods.approve(staker.options.address, toWei("32000000")).send({ from: account3 });
  });
  describe("Input validation and ownership", function () {
    it("Request Unstake rejects bad inputs", async function () {});
    it("Cant unstake early", async function () {});
    it("Only owner can change params", async function () {});
  });
  describe("Staking: rewards accumulation", function () {
    it("Staking accumulates prorata rewards over time", async function () {
      await staker.methods.stake(amountToStake).send({ from: account1 });
      const stakingBalance = await staker.methods.stakingBalances(account1).call();
      assert.equal(stakingBalance.cumulativeStaked, amountToStake);

      // Advance time forward 1000 seconds. At an emission rate of 0.64 per second we should see the accumulation of
      // all rewards equal to the amount staked * 1000 * 0.64 = 640.
      await advanceTime(1000);
      assert.equal(await staker.methods.outstandingRewardsWithoutSlashing(account1).call(), toWei("640"));

      // Claim the rewards and ensure balances update accordingly.
      const balanceBefore = await votingToken.methods.balanceOf(account1).call();
      await staker.methods.withdrawRewards().send({ from: account1 });
      const balanceAfter = await votingToken.methods.balanceOf(account1).call();
      assert.equal(balanceAfter, toWei("640").add(toBN(balanceBefore)));

      // Now have account2 stake 3x the amount of account1. Ensure a prorata split of future rewards as 1/4 3/4ths.
      await staker.methods.stake(amountToStake.muln(3)).send({ from: account2 });

      // Advance time forward 1000 seconds. At an emission rate of 0.64 per second we should see the accumulation of
      // 1/4*640=160 to account1 and 2/3*640=480 to account2.
      await advanceTime(1000);
      assert.equal(await staker.methods.outstandingRewardsWithoutSlashing(account1).call(), toWei("160"));
      assert.equal(await staker.methods.outstandingRewardsWithoutSlashing(account2).call(), toWei("480"));

      // Next, stake 2x the original amount of tokens from another account. This should result in a prorata split of
      // rewards with account1 staking 1/6th, account2 staking 3/6 and account3 staking 2/6. Subsequent rewards should
      // correctly factor in the 160 & 480 rewards split between account1 and account2 that have not yet been claimed.
      // This shows the correct "memory" of the staking system with subsequent stakes.
      await staker.methods.stake(amountToStake.muln(2)).send({ from: account3 });

      // Over 1500 seconds we should emit a total of 1500 * 0.64 = 960 rewards.
      //    Account1: 160 + 1/6 * 960 = 320
      //    Account2: 480 + 3/6 * 960 = 960
      //    Account3: 0   + 2/6 * 960 = 320
      await advanceTime(1500);
      assert.equal(await staker.methods.outstandingRewardsWithoutSlashing(account1).call(), toWei("320"));
      assert.equal(await staker.methods.outstandingRewardsWithoutSlashing(account2).call(), toWei("960"));
      assert.equal(await staker.methods.outstandingRewardsWithoutSlashing(account3).call(), toWei("320"));
    });

    it("Unstaking is correctly blocked for unlock time", async function () {
      // todo: verify cant re-request unstake
      await staker.methods.stake(amountToStake).send({ from: account1 });

      // Attempting to unstake without requesting.
      assert(await didContractThrow(staker.methods.executeUnstake().send({ from: account1 })));

      // Request unstake but dont wait long enough should also revert.
      await staker.methods.requestUnstake(amountToStake).send({ from: account1 });
      assert(await didContractThrow(staker.methods.executeUnstake().send({ from: account1 })));
      await advanceTime(1000);
      assert(await didContractThrow(staker.methods.executeUnstake().send({ from: account1 })));

      // Now advance the 1 month required to unstake.
      await advanceTime(60 * 60 * 24 * 30);
      const balanceBefore = await votingToken.methods.balanceOf(account1).call();
      await staker.methods.executeUnstake().send({ from: account1 });
      const balanceAfter = await votingToken.methods.balanceOf(account1).call();
      assert.equal(balanceAfter, amountToStake.add(toBN(balanceBefore))); // Should get back the original amount staked.

      // Accumulated rewards over the interval should be the full 0.64 percent, grown over 30 days + 1000 seconds.
      // This should be 0.64 * (60 * 60 * 24 * 30 + 1000) = 1659520.
      assert.equal(await staker.methods.outstandingRewardsWithoutSlashing(account1).call(), toWei("1659520"));
      await staker.methods.withdrawRewards().send({ from: account1 });
      assert.equal(await votingToken.methods.balanceOf(account1).call(), toBN(balanceAfter).add(toWei("1659520")));

      // No further rewards should accumulate to the staker as they have claimed and unstked the full amount.
      assert.equal(await staker.methods.outstandingRewardsWithoutSlashing(account1).call(), toWei("0"));
      await advanceTime(1000);
      assert.equal(await staker.methods.outstandingRewardsWithoutSlashing(account1).call(), toWei("0"));
    });
  });
  describe("Slashing: unrealizedSlash consideration", function () {
    it("Reward retrieval correctly factors in unrealizedSlash", async function () {
      // Stake some amount, advance time and check that there is an unclaimed reward.
      await staker.methods.stake(amountToStake).send({ from: account1 }); // stake 1/4th
      await staker.methods.stake(amountToStake.muln(3)).send({ from: account2 }); // stake 3/4ths
      await advanceTime(1000);
      assert.equal(await staker.methods.outstandingRewardsWithoutSlashing(account1).call(), toWei("160")); // 1000 * 0.64 * 1/4 = 160
      assert.equal(await staker.methods.claimableOutstandingRewards(account1).call(), toWei("160")); // 160 + 0
      assert.equal(await staker.methods.outstandingRewardsWithoutSlashing(account2).call(), toWei("480")); // 1000 * 0.64 * 3/4 = 480
      assert.equal(await staker.methods.claimableOutstandingRewards(account2).call(), toWei("480")); // 480 + 0

      // Now assume that voter2 votes wrong. Assume for the case of this test the slashing amount is 69 Wei. they should
      // now have a total outstanding reward amount of 480 - 69 = 411. voter1 should now have should receive the slashed
      // amount taken from voter2. Note that the logic for attributing slashing to accounts is not implemented in this
      // contract; it is implemented(and tested) in the Voting contract. Here we mock this.
      await staker.methods.setStakerUnrealizedSlash(account1, toWei("69")).send({ from: account1 });
      await staker.methods.setStakerUnrealizedSlash(account2, toWei("-69")).send({ from: account1 });
      assert.equal(await staker.methods.outstandingRewardsWithoutSlashing(account1).call(), toWei("160")); // 160
      assert.equal(await staker.methods.claimableOutstandingRewards(account1).call(), toWei("229")); // 160 + 69 = 229.
      assert.equal(await staker.methods.outstandingRewardsWithoutSlashing(account2).call(), toWei("480")); // 480
      assert.equal(await staker.methods.claimableOutstandingRewards(account2).call(), toWei("411")); // 480 - 69 = 411.

      // Now, accumulate more rewards. Check that accumulation behaves as expected. Advance time forward another 1500
      // seconds. Now we should accumulate a total of 0.64 * 1500 = 960 rewards, split 1/4 3/4ths.
      await advanceTime(1500);
      assert.equal(await staker.methods.outstandingRewardsWithoutSlashing(account1).call(), toWei("400")); // 160 + 960 * 1/4 = 400
      assert.equal(await staker.methods.claimableOutstandingRewards(account1).call(), toWei("469")); // 400 + 69 = 469
      assert.equal(await staker.methods.outstandingRewardsWithoutSlashing(account2).call(), toWei("1200")); // 480  + 960 * 3/4 = 1200
      assert.equal(await staker.methods.claimableOutstandingRewards(account2).call(), toWei("1131")); // 1200 - 69 = 1131

      // Now, claim the rewards. Check that the claims are correctly attributed to the correct accounts.
      const account1BalBefore = await votingToken.methods.balanceOf(account1).call();
      const account2BalBefore = await votingToken.methods.balanceOf(account2).call();
      await staker.methods.withdrawRewards().send({ from: account1 });
      await staker.methods.withdrawRewards().send({ from: account2 });
      assert.equal(await votingToken.methods.balanceOf(account1).call(), toBN(account1BalBefore).add(toWei("469")));
      assert.equal(await votingToken.methods.balanceOf(account2).call(), toBN(account2BalBefore).add(toWei("1131")));
    });

    it("Can correctly slash into staked balance of user", async function () {
      // Stake some amount, advance time and check that there is an unclaimed reward.
      await staker.methods.stake(amountToStake).send({ from: account1 }); // stake 1/4th
      await staker.methods.stake(amountToStake.muln(3)).send({ from: account2 }); // stake 3/4ths
      await advanceTime(1000); // After 1000 seconds expect 160 for account1 and 480 for account2 (same a previous test)

      // Now assume the slashing penalties are much higher, such that account2 actually slash away all rewards they are
      // entitled to. We should see the user's outstanding rewards go to 0 for the slashed user and the other user reive
      // these rewards in turn.
      await staker.methods.setStakerUnrealizedSlash(account1, toWei("500")).send({ from: account1 });
      await staker.methods.setStakerUnrealizedSlash(account2, toWei("-500")).send({ from: account1 });
      assert.equal(await staker.methods.outstandingRewardsWithoutSlashing(account1).call(), toWei("160")); // 1000 * 0.64 * 1/4 = 160
      assert.equal(await staker.methods.claimableOutstandingRewards(account1).call(), toWei("660")); // 160 + 500 = 660
      assert.equal(await staker.methods.outstandingRewardsWithoutSlashing(account2).call(), toWei("480")); // 1000 * 0.64 * 3/4 = 480
      assert.equal(await staker.methods.claimableOutstandingRewards(account2).call(), toWei("0")); // min(0, 480-500) = 0

      // Now request to unstake tokens and unstake them. We'll also set the unstakeCoolDown to 0 to let the user instantly
      // unstake (just to make the math a bit easier to so we dont need to consider the accumulation of more rewards).
      await staker.methods.setUnstakeCoolDown(0).send({ from: account1 });
      await staker.methods.requestUnstake(amountToStake).send({ from: account1 });
      await staker.methods.requestUnstake(amountToStake.muln(3)).send({ from: account2 });
      const account1BalBefore = await votingToken.methods.balanceOf(account1).call();
      const account2BalBefore = await votingToken.methods.balanceOf(account2).call();
      await staker.methods.executeUnstake().send({ from: account1 });
      await staker.methods.executeUnstake().send({ from: account2 });

      // Account 1 should receive the exact amount they staked (they have not claimed their rewards and have not been
      // slashed at all into their balance).
      assert.equal(await votingToken.methods.balanceOf(account1).call(), toBN(account1BalBefore).add(amountToStake));

      // Account 2 should receive their stake amount minus the full slashed amount. They should still have the unclaimed
      // rewards available to be claimed. The total they should get back, considering the original stake, accumulated
      // rewards and slashed amount should be 3000 + 480 - 500 =  2980.
      assert.equal(
        await votingToken.methods.balanceOf(account2).call(),
        toBN(account2BalBefore).add(amountToStake.muln(3).sub(toWei("500")))
      );
      assert.equal(await staker.methods.claimableOutstandingRewards(account2).call(), toWei("480"));
      await staker.methods.withdrawRewards().send({ from: account2 });
      assert.equal(
        await votingToken.methods.balanceOf(account2).call(),
        toBN(account2BalBefore).add(amountToStake.muln(3).sub(toWei("20")))
      );
    });
  });

  describe("Snapshotting: Correctly snapshots staked and unrealized slashing amounts", function () {
    it("Reward retrieval correctly factors in unrealizedSlash", async function () {});
  });
});

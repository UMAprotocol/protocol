const hre = require("hardhat");
const { web3, assertEventEmitted } = hre;
const { runDefaultFixture, didContractRevertWith, didContractThrow } = require("@uma/common");
const { getContract } = hre;

const { assert } = require("chai");
const { toBN } = web3.utils;

const StakerTest = getContract("StakerTest");
const VotingToken = getContract("VotingToken");
const Timer = getContract("Timer");

const toWei = (value) => toBN(web3.utils.toWei(value, "ether"));

const emissionRate = "640000000000000000"; // Approximately 20% APY with a total supply of 100mm tokens.
const unstakeCoolDown = 60 * 60 * 30; // 1 month.

const amountToStake = toWei("1000");

describe("Staker", function () {
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

    staker = await StakerTest.new(
      emissionRate,
      unstakeCoolDown,
      votingToken.options.address,
      timer.options.address
    ).send({ from: account1 });

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
  describe("Staking: rewards accumulation", function () {
    it("Staking accumulates prorata rewards over time", async function () {
      await staker.methods.stake(amountToStake).send({ from: account1 });
      const stakingBalance = await staker.methods.voterStakes(account1).call();
      assert.equal(stakingBalance.stake, amountToStake);

      // Advance time forward 1000 seconds. At an emission rate of 0.64 per second we should see the accumulation of
      // all rewards equal to the amount staked * 1000 * 0.64 = 640.
      await advanceTime(1000);
      assert.equal(await staker.methods.outstandingRewards(account1).call(), toWei("640"));

      // Claim the rewards and ensure balances update accordingly.
      const balanceBefore = await votingToken.methods.balanceOf(account1).call();
      await staker.methods.withdrawRewards().send({ from: account1 });
      assert.equal(
        await votingToken.methods.balanceOf(account1).call(),
        toWei("640").add(toBN(balanceBefore)).toString()
      );

      // Now have account2 stake 3x the amount of account1. Ensure a prorata split of future rewards as 1/4 3/4ths.
      await staker.methods.stake(amountToStake.muln(3)).send({ from: account2 });

      // Advance time forward 1000 seconds. At an emission rate of 0.64 per second we should see the accumulation of
      // 1/4*640=160 to account1 and 2/3*640=480 to account2.
      await advanceTime(1000);
      assert.equal(await staker.methods.outstandingRewards(account1).call(), toWei("160"));
      assert.equal(await staker.methods.outstandingRewards(account2).call(), toWei("480"));

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
      assert.equal(await staker.methods.outstandingRewards(account1).call(), toWei("320"));
      assert.equal(await staker.methods.outstandingRewards(account2).call(), toWei("960"));
      assert.equal(await staker.methods.outstandingRewards(account3).call(), toWei("320"));
    });

    it("Withdraw and restake", async function () {
      await staker.methods.stake(amountToStake).send({ from: account1 });

      // Advance time forward 1000 seconds. At an emission rate of 0.64 per second we should see the accumulation of
      // all rewards equal to the amount staked * 1000 * 0.64 = 640.
      await advanceTime(1000);

      await staker.methods.withdrawAndRestake().send({ from: account1 });
      const stakingBalance = await staker.methods.voterStakes(account1).call();
      assert.equal(stakingBalance.stake, amountToStake.add(toWei("640")));
    });

    it("Stake to", async function () {
      const initialBalanceAccount1 = await staker.methods.voterStakes(account1).call();
      const initialBalanceAccount2 = await staker.methods.voterStakes(account2).call();

      await staker.methods.stakeTo(account2, amountToStake).send({ from: account1 });

      const stakingBalanceAccount1 = await staker.methods.voterStakes(account1).call();
      const stakingBalanceAccount2 = await staker.methods.voterStakes(account2).call();

      assert.equal(stakingBalanceAccount1.stake, initialBalanceAccount1.stake);
      // assert.equal(stakingBalanceAccount1.pendingStake, initialBalanceAccount1.pendingStake);
      assert.equal(stakingBalanceAccount2.stake, amountToStake.add(toBN(initialBalanceAccount2.stake)));
      // assert.equal(stakingBalanceAccount2.pendingStake, initialBalanceAccount2.pendingStake);

      // Advance time forward 1000 seconds. At an emission rate of 0.64 per second we should see the accumulation of
      // all rewards equal to the amount staked * 1000 * 0.64 = 640.
      await advanceTime(1000);

      await staker.methods.withdrawAndRestake().send({ from: account2 });
      const stakingBalance = await staker.methods.voterStakes(account2).call();
      assert.equal(stakingBalance.stake, amountToStake.add(toWei("640")));
    });

    it("Withdraw and restake delegate", async function () {
      await staker.methods.stake(amountToStake).send({ from: account1 });
      await staker.methods.setDelegate(account2).send({ from: account1 });
      await staker.methods.setDelegator(account1).send({ from: account2 });

      const stakingBalanceInitial = await staker.methods.voterStakes(account1).call();

      // Advance time forward 1000 seconds.
      await advanceTime(1000);

      const delegateVotingTokenBalance = await votingToken.methods.balanceOf(account2).call();
      const outstandingRewards = await staker.methods.outstandingRewards(account1).call();

      // Check the outstanding rewards are more than 0.
      assert(toBN(outstandingRewards) > 0);

      // Check that delegate cannot withdraw rewards.
      await staker.methods.withdrawRewards().send({ from: account2 });
      assert.equal(await votingToken.methods.balanceOf(account2).call(), delegateVotingTokenBalance);

      // But delegate can withdraw rewards and restake.
      const tx = await staker.methods.withdrawAndRestake().send({ from: account2 });

      assert.equal(tx.events.WithdrawnRewards.returnValues.voter, accounts[0]);
      assert.equal(tx.events.WithdrawnRewards.returnValues.delegate, account2);
      assert.equal(tx.events.WithdrawnRewards.returnValues.tokensWithdrawn, outstandingRewards);

      const stakingBalance = await staker.methods.voterStakes(account1).call();

      // Voter active stake should have increased by the outstanding rewards and the delegate votingToken balance should be the same.
      assert.equal(stakingBalance.stake, toBN(stakingBalanceInitial.stake).add(toBN(outstandingRewards)));
      assert.equal(delegateVotingTokenBalance, await votingToken.methods.balanceOf(account2).call());
    });

    it("Blocks bad unstake attempt", async function () {
      await staker.methods.stake(amountToStake).send({ from: account1 });

      // Try to request to unstake more than staked amount.
      assert(await didContractThrow(staker.methods.requestUnstake(amountToStake.addn(1)).send({ from: account1 })));
    });
    it("Unstaking is correctly blocked for unlock time", async function () {
      await staker.methods.stake(amountToStake).send({ from: account1 });

      // Attempting to unstake without requesting.
      assert(await didContractThrow(staker.methods.executeUnstake().send({ from: account1 })));
      await staker.methods.requestUnstake(amountToStake).send({ from: account1 });
      // Not waiting long enough should also revert.
      assert(await didContractThrow(staker.methods.executeUnstake().send({ from: account1 })));
      await advanceTime(1000);
      assert(await didContractThrow(staker.methods.executeUnstake().send({ from: account1 })));

      // Now advance the 1 month required to unstake.
      await advanceTime(60 * 60 * 24 * 30);
      const balanceBefore = await votingToken.methods.balanceOf(account1).call();
      await staker.methods.executeUnstake().send({ from: account1 });
      const balanceAfter = await votingToken.methods.balanceOf(account1).call();
      assert.equal(balanceAfter, amountToStake.add(toBN(balanceBefore))); // Should get back the original amount staked.

      // The account should have 0 outstanding rewards as they requested to unstake right at the beginning of the test.
      assert.equal(await staker.methods.outstandingRewards(account1).call(), toWei("0"));
    });
    it("Unstaking time can be shortcut if unstakeCooldown is set to zero", async function () {
      await staker.methods.stake(amountToStake).send({ from: account1 });

      // Attempting to unstake without requesting.
      assert(await didContractThrow(staker.methods.executeUnstake().send({ from: account1 })));

      await staker.methods.requestUnstake(amountToStake).send({ from: account1 });

      // Set the unstake cooldown to 0.
      await staker.methods.setUnstakeCoolDown(0).send({ from: account1 });

      const balanceBefore = await votingToken.methods.balanceOf(account1).call();
      await staker.methods.executeUnstake().send({ from: account1 });
      const balanceAfter = await votingToken.methods.balanceOf(account1).call();
      assert.equal(balanceAfter, amountToStake.add(toBN(balanceBefore))); // Should get back the original amount staked.
    });
    it("Unstaking time is not retroactive", async function () {
      await staker.methods.stake(amountToStake).send({ from: account1 });

      // Attempting to unstake without requesting.
      assert(await didContractThrow(staker.methods.executeUnstake().send({ from: account1 })));
      await staker.methods.requestUnstake(amountToStake).send({ from: account1 });
      // Not waiting long enough should also revert.
      assert(await didContractThrow(staker.methods.executeUnstake().send({ from: account1 })));
      await advanceTime(1000);
      assert(await didContractThrow(staker.methods.executeUnstake().send({ from: account1 })));

      // Set the unstake cooldown to 0.
      await staker.methods.setUnstakeCoolDown(1).send({ from: account1 });
      assert(await didContractThrow(staker.methods.executeUnstake().send({ from: account1 })));

      const currentTime = toBN(await staker.methods.getCurrentTime().call());
      const unstakeTime = toBN((await staker.methods.voterStakes(account1).call()).unstakeTime);

      await advanceTime(unstakeTime.sub(currentTime).toString());

      const balanceBefore = await votingToken.methods.balanceOf(account1).call();
      await staker.methods.executeUnstake().send({ from: account1 });
      const balanceAfter = await votingToken.methods.balanceOf(account1).call();
      assert.equal(balanceAfter, amountToStake.add(toBN(balanceBefore))); // Should get back the original amount staked.

      // The account should have 0 outstanding rewards as they requested to unstake right at the beginning of the test.
      assert.equal(await staker.methods.outstandingRewards(account1).call(), toWei("0"));
    });
    it("Can not re-request to unstake", async function () {
      await staker.methods.stake(amountToStake).send({ from: account1 });

      const currentTime = toBN(await staker.methods.getCurrentTime().call());
      const unstakeTime = currentTime.add(toBN(await staker.methods.unstakeCoolDown().call()));
      await staker.methods.requestUnstake(amountToStake).send({ from: account1 });
      assert((await staker.methods.voterStakes(account1).call()).unstakeTime, unstakeTime.toString());
      assert((await staker.methods.voterStakes(account1).call()).pendingUnstake, amountToStake);
      assert(await didContractThrow(staker.methods.requestUnstake(420).send({ from: account1 })));
    });
  });
  describe("Slashing: unrealizedSlash consideration", function () {
    it("Applied slashing correctly impacts staked users future rewards", async function () {
      // Stake some amount, advance time and check that there is an unclaimed reward.
      await staker.methods.stake(amountToStake).send({ from: account1 }); // stake 1/4th
      await staker.methods.stake(amountToStake.muln(3)).send({ from: account2 }); // stake 3/4ths
      await advanceTime(1000);
      assert.equal(await staker.methods.outstandingRewards(account1).call(), toWei("160")); // 1000 * 0.64 * 1/4 = 160
      assert.equal(await staker.methods.outstandingRewards(account2).call(), toWei("480")); // 1000 * 0.64 * 3/4 = 480

      // Now assume that voter2 votes wrong. Assume for the case of this test the slashing amount is 200 Wei. This should
      // not impact any of their claimable rewards but it should impact their cumlativeStaked and therefore impact their
      // share of rewards going forward. Note that here we are ignoring how slashing is computed. This just assumes that
      // the slashing amount flows totally from account1 to account2.
      await staker.methods.applySlashingToCumulativeStaked(account1, toWei("200")).send({ from: account1 });
      await staker.methods.applySlashingToCumulativeStaked(account2, toWei("-200")).send({ from: account1 });
      // Cumulative staked should have been shifted accordingly.
      assert.equal((await staker.methods.voterStakes(account1).call()).stake, toWei("1200"));
      assert.equal((await staker.methods.voterStakes(account2).call()).stake, toWei("2800"));

      // Outstanding rewards should be the same as before (not effected by slashing)
      assert.equal(await staker.methods.outstandingRewards(account1).call(), toWei("160")); // 160
      assert.equal(await staker.methods.outstandingRewards(account2).call(), toWei("480")); // 480

      // Now, accumulate more rewards. Check that accumulation behaves as expected. Advance time forward another 1500
      // seconds. Now we should accumulate a total of 0.64 * 1500 = 960 rewards. This should now be split between the
      // two accounts with account1 getting 1200/4000 * 960 = 288 and account2 getting 2800/4000 * 960 = 672.
      await advanceTime(1500);
      assert.equal(await staker.methods.outstandingRewards(account1).call(), toWei("448")); // 160 + 288 = 448

      assert.equal(await staker.methods.outstandingRewards(account2).call(), toWei("1152")); // 480  + 672 = 1152

      // Now, claim the rewards. Check that the claims are correctly attributed to the correct accounts.
      const account1BalBefore = await votingToken.methods.balanceOf(account1).call();
      const account2BalBefore = await votingToken.methods.balanceOf(account2).call();
      await staker.methods.withdrawRewards().send({ from: account1 });
      await staker.methods.withdrawRewards().send({ from: account2 });
      assert.equal(await votingToken.methods.balanceOf(account1).call(), toBN(account1BalBefore).add(toWei("448")));
      assert.equal(await votingToken.methods.balanceOf(account2).call(), toBN(account2BalBefore).add(toWei("1152")));
    });

    it("Slashing a users whole balance totally attenuates their rewards over time", async function () {
      await staker.methods.stake(amountToStake).send({ from: account1 }); // stake 1/4th
      await staker.methods.stake(amountToStake.muln(3)).send({ from: account2 }); // stake 3/4ths
      await advanceTime(1000);
      assert.equal(await staker.methods.outstandingRewards(account1).call(), toWei("160")); // 1000 * 0.64 * 1/4 = 160
      assert.equal(await staker.methods.outstandingRewards(account2).call(), toWei("480")); // 1000 * 0.64 * 3/4 = 480

      // Now slash half the balance of account1.
      await staker.methods.applySlashingToCumulativeStaked(account1, amountToStake.divn(-2)).send({ from: account1 });
      await staker.methods.applySlashingToCumulativeStaked(account2, amountToStake.divn(2)).send({ from: account1 });

      // Now advance another 1000 seconds. This will accrue another 640 rewards. Now, though, the allocation will be
      // 500/4000 * 640 = 80 to account1 and 3500/4000 * 640 = 560 to account2.
      await advanceTime(1000);
      assert.equal(await staker.methods.outstandingRewards(account1).call(), toWei("240")); // 160 + 80 = 240
      assert.equal(await staker.methods.outstandingRewards(account2).call(), toWei("1040")); // 480 + 560 = 1040

      // Slash the remaining account1's balance. They should accumulate no more rewards and everything goes to account2.
      await staker.methods.applySlashingToCumulativeStaked(account1, amountToStake.divn(-2)).send({ from: account1 });
      await staker.methods.applySlashingToCumulativeStaked(account2, amountToStake.divn(2)).send({ from: account1 });

      await advanceTime(1000);
      assert.equal(await staker.methods.outstandingRewards(account1).call(), toWei("240")); // 240 + 0 = 240
      assert.equal(await staker.methods.outstandingRewards(account2).call(), toWei("1680")); // 1040 + 640 = 1680
    });

    it("Update emission rate works as expected", async function () {
      // Start with a 0 emission rate.
      staker = await StakerTest.new("0", unstakeCoolDown, votingToken.options.address, timer.options.address).send({
        from: account1,
      });

      // Allow account1 to mint tokens.
      const minterRole = 1;
      await votingToken.methods.addMember(minterRole, account1).send({ from: account1 });
      await votingToken.methods.addMember(minterRole, staker.options.address).send({ from: account1 });

      // Mint and send tokens to account1 and account2.
      await votingToken.methods.mint(account1, amountToStake.muln(4)).send({ from: accounts[0] });
      await votingToken.methods.approve(staker.options.address, amountToStake).send({ from: account1 });
      await votingToken.methods.transfer(account2, amountToStake.muln(3)).send({ from: account1 });
      await votingToken.methods.approve(staker.options.address, amountToStake.muln(3)).send({ from: account2 });

      // Stake 1/4th of the tokens in account1 and 3/4ths in account2.
      await staker.methods.stake(amountToStake).send({ from: account1 }); // stake 1/4th
      await staker.methods.stake(amountToStake.muln(3)).send({ from: account2 }); // stake 3/4ths
      await advanceTime(1000);

      // Check that the rewards are correctly allocated.
      assert.equal(await staker.methods.outstandingRewards(account1).call(), 0);
      assert.equal(await staker.methods.outstandingRewards(account2).call(), 0);

      // Set the emission rate to 0.1 and check that the rewards are correctly allocated.
      await staker.methods.setEmissionRate(toWei("0.1")).send({ from: accounts[0] });

      // Rewards should be 0 because no time has passed.
      assert.equal(await staker.methods.outstandingRewards(account1).call(), 0);
      assert.equal(await staker.methods.outstandingRewards(account2).call(), 0);

      await advanceTime(1000);

      // Check that the rewards are correctly allocated.
      assert.equal(await staker.methods.outstandingRewards(account1).call(), toWei("25")); // 1000 * 0.1 * 1/4 = 25
      assert.equal(await staker.methods.outstandingRewards(account2).call(), toWei("75")); // 1000 * 0.1 * 3/4 = 75

      // Set the emission rate to 0 and check that the rewards are correctly allocated.
      await staker.methods.setEmissionRate(toWei("0")).send({ from: accounts[0] });

      await advanceTime(1000);

      // The rewards should not have changed.
      assert.equal(await staker.methods.outstandingRewards(account1).call(), toWei("25"));
      assert.equal(await staker.methods.outstandingRewards(account2).call(), toWei("75"));

      // Set the emission rate to 0.2 and check that the rewards are correctly allocated.
      await staker.methods.setEmissionRate(toWei("0.2")).send({ from: accounts[0] });

      await advanceTime(1000);

      // Check that emission rate updates are not retroactive.
      assert.equal(await staker.methods.outstandingRewards(account1).call(), toWei("75")); // 25 + 1000 * 0.2 * 1/4 = 75
      assert.equal(await staker.methods.outstandingRewards(account2).call(), toWei("225")); // 75 + 1000 * 0.2 * 3/4 = 225
    });

    it("Events", async function () {
      let result;
      result = await staker.methods.stake(amountToStake).send({ from: account1 }); // stake 1/4th
      await advanceTime(1000);

      await assertEventEmitted(result, staker, "Staked");
      await assertEventEmitted(result, staker, "UpdatedReward");

      result = await staker.methods.setEmissionRate(toWei("0.1")).send({ from: accounts[0] });
      await assertEventEmitted(result, staker, "SetNewEmissionRate", (ev) => ev.newEmissionRate == toWei("0.1"));

      result = await staker.methods.setUnstakeCoolDown(0).send({ from: account1 });
      await assertEventEmitted(result, staker, "SetNewUnstakeCoolDown");

      result = await staker.methods.withdrawRewards().send({ from: account1 });
      await assertEventEmitted(result, staker, "WithdrawnRewards");

      result = await staker.methods.requestUnstake(amountToStake).send({ from: account1 });
      await assertEventEmitted(result, staker, "RequestedUnstake");

      result = await staker.methods.executeUnstake().send({ from: account1 });
      await assertEventEmitted(result, staker, "ExecutedUnstake");
    });
  });
  describe("Staker: input validation", function () {
    it("Cannot stake 0 UMA", async function () {
      assert(await didContractRevertWith(staker.methods.stake("0").send({ from: account1 }), "Cannot stake 0"));
    });

    it("Cannot unstake 0 UMA", async function () {
      await staker.methods.stake(amountToStake).send({ from: account1 });

      assert(
        await didContractRevertWith(staker.methods.requestUnstake("0").send({ from: account1 }), "Cannot unstake 0")
      );
    });
  });
});

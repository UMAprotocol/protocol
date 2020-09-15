const { toWei, toBN } = web3.utils;

const { advanceBlockAndSetTime } = require("@uma/common");

const { _updatePayoutAtBlock, _calculatePayoutsBetweenBlocks } = require("../CalculateBalancerLPRewards");

const Token = artifacts.require("ExpandedERC20"); // Helper contracts to mock balancer pool.

let bpToken; // balancerPoolToken. Used to mock liquidity provision.

contract("CalculateBalancerLPProviders.js", function(accounts) {
  const contractCreator = accounts[0];
  const shareHolders = accounts.slice(1, 6); // Array of accounts 1 -> 5 to represent shareholders(liquidity providers).

  describe("Correctly calculates payout at a given block number (_updatePayoutAtBlock)", function() {
    beforeEach(async function() {
      bpToken = await Token.new("BPT", "BPT", 18, {
        from: contractCreator
      });
      await bpToken.addMember(1, contractCreator, {
        from: contractCreator
      });
    });

    it("Correctly splits payout over all liquidity providers (balanced case)", async function() {
      // Create 10e18 tokens to distribute, sending 2e18 to each liquidity provider.
      for (shareHolder of shareHolders) {
        await bpToken.mint(shareHolder, toWei("2"), { from: contractCreator });
      }
      // Create an object to store the payouts for a given block. This should be an object with key being the
      // shareholder address and value being their respective payout.
      let shareHolderPayout = {};
      for (shareHolder of shareHolders) {
        shareHolderPayout[shareHolder] = toBN("0");
      }

      const blockNumber = await web3.eth.getBlockNumber();
      // Distribute 5 tokens per snapshot. As there are 5 shareholders, each holding 2e18 tokens, we should expect that
      // each shareholder should be attributed 1/5 of the total rewards, equalling 1e18 each.
      const tokensPerSnapShot = toWei("5");

      // Call the `_updatePayoutAtBlock` to get the distribution at a given `blockNumber`.
      const payoutAtBlock = await _updatePayoutAtBlock(
        bpToken.contract,
        blockNumber,
        shareHolderPayout,
        tokensPerSnapShot
      );

      // Validate that each shareholder got the right number of tokens for the given block. Expecting 1/5 of all rewards
      // per shareholder as equal token distribution.
      const expectedPayoutPerShareholder = toBN(tokensPerSnapShot).divn(shareHolders.length);
      for (shareholder of shareHolders) {
        assert.equal(payoutAtBlock[shareHolder].toString(), expectedPayoutPerShareholder.toString());
      }
    });
    it("Correctly splits payout over all liquidity providers (unbalanced case)", async function() {
      // Create 10e18 tokens to distribute, sending all to one liquidity provider.
      await bpToken.mint(shareHolders[0], toWei("10"), { from: contractCreator });

      // Create an object to store the payouts for a given block. This should be an object with key being the
      // shareholder address and value being their respective payout.
      let shareHolderPayout = {};
      for (shareHolder of shareHolders) {
        shareHolderPayout[shareHolder] = toBN("0");
      }

      const blockNumber = await web3.eth.getBlockNumber();
      // Distribute 5 tokens per snapshot. There is only one shareholder who holds tokens at the given block number. They
      // should exclusively receive all token payouts.
      const tokensPerSnapShot = toWei("5");

      // Call the `_updatePayoutAtBlock` to get the distribution at a given `blockNumber`.
      const payoutAtBlock = await _updatePayoutAtBlock(
        bpToken.contract,
        blockNumber,
        shareHolderPayout,
        tokensPerSnapShot
      );

      // Validate that the single shareholder got all rewards and all other shareholders got none at the given block.
      assert.equal(payoutAtBlock[shareHolders[0]].toString(), tokensPerSnapShot);
      const expectedPayoutPerOtherShareholder = toWei("0");
      for (shareholder of shareHolders.slice(1, 6)) {
        assert.equal(payoutAtBlock[shareHolder].toString(), expectedPayoutPerOtherShareholder.toString());
      }
    });
    it("Correctly splits payout over all liquidity providers (extreme fractional case)", async function() {
      // Create 10e18 tokens to distribute, sending all to one LP and send 100 wei of tokens to another provider.
      await bpToken.mint(shareHolders[0], toWei("10"), {
        from: contractCreator
      }); // shareholder0 gets 10e18 tokens
      await bpToken.mint(shareHolders[1], "100", {
        from: contractCreator
      }); // Shareholder1 gets 100 tokens. (100 wei)

      // Create an object to store the payouts for a given block. This should be an object with key being the
      // shareholder address and value being their respective payout.
      let shareHolderPayout = {};
      for (shareHolder of shareHolders) {
        shareHolderPayout[shareHolder] = toBN("0");
      }

      const blockNumber = await web3.eth.getBlockNumber();
      // Distribute 10e18 $UMA tokens per snapshot.
      const tokensPerSnapShot = toWei("10");

      // Call the `_updatePayoutAtBlock` to get the distribution at a given `blockNumber`.
      const payoutAtBlock = await _updatePayoutAtBlock(
        bpToken.contract,
        blockNumber,
        shareHolderPayout,
        tokensPerSnapShot
      );

      // Validate the two shareholders got the correct proportion of token rewards.
      // shareHolder0 expected payout is their pool tokens (10e18) divided by the total pool provision(10e18+100).
      const shareHolder0Frac = toBN(toWei("10")) // fraction of the pool is their contribution/total pool
        .mul(toBN(toWei("1")))
        .div(toBN(toWei("10")).addn(100));

      const expectedShareHolder0Payout = toBN(tokensPerSnapShot) // The total tokens per snapshot * by their pool ratio.
        .mul(shareHolder0Frac)
        .div(toBN(toWei("1")));

      assert.equal(payoutAtBlock[shareHolders[0]].toString(), expectedShareHolder0Payout.toString());

      // shareHolder1 expected payout is their pool tokens (100) divided by the total pool prevision(10e18+100).
      const shareHolder1Frac = toBN("100") // fraction of the pool is their contribution/total pool
        .mul(toBN(toWei("1")))
        .div(toBN(toWei("10")).addn(100));
      const expectedShareHolder1Payout = toBN(tokensPerSnapShot) // The total tokens per snapshot * by their pool ratio.
        .mul(shareHolder1Frac)
        .div(toBN(toWei("1")));

      assert.equal(payoutAtBlock[shareHolders[1]].toString(), expectedShareHolder1Payout.toString());

      // Validate the other shareholders got no rewards.
      const expectedPayoutPerOtherShareholder = toWei("0");
      for (shareholder of shareHolders.slice(2, 6)) {
        assert.equal(payoutAtBlock[shareHolder].toString(), expectedPayoutPerOtherShareholder.toString());
      }
    });
  });
  describe("Correctly calculates payouts over a range of block numbers (_calculatePayoutsBetweenBlocks)", function() {
    beforeEach(async function() {
      bpToken = await Token.new("BPT", "BPT", 18, {
        from: contractCreator
      });
      await bpToken.addMember(1, contractCreator, {
        from: contractCreator
      });
    });

    it("Correctly splits rewards over n blocks (simple case)", async function() {
      // Create 10e18 tokens to distribute, sending 2e18 to each liquidity provider.
      for (shareHolder of shareHolders) {
        await bpToken.mint(shareHolder, toWei("2"), { from: contractCreator });
      }
      // Capture the starting block number.
      const startingBlockNumber = await web3.eth.getBlockNumber();
      const startingBlockTimestamp = await web3.eth.getBlock(startingBlockNumber).timestamp;

      // Advance the chain 10 blocks into the future while setting the average block time to be 15 seconds.
      const snapshotsToTake = 10;
      const blocksPerSnapshot = 1; // Set to 1 to capture a snapshot at every block.
      const blocksToAdvance = snapshotsToTake * blocksPerSnapshot;
      for (i = 0; i < blocksToAdvance; i++) {
        await advanceBlockAndSetTime(web3, startingBlockTimestamp + 15 * (1 + i));
      }
      const endingBlockNumber = await web3.eth.getBlockNumber();
      assert.equal(endingBlockNumber, startingBlockNumber + blocksToAdvance); // Should have advanced 10 blocks.

      const rewardsPerSnapshot = toWei("10"); // For each snapshot in time, payout 10e18 tokens

      const intervalPayout = await _calculatePayoutsBetweenBlocks(
        bpToken.contract,
        shareHolders,
        startingBlockNumber,
        endingBlockNumber,
        blocksPerSnapshot,
        rewardsPerSnapshot
      );

      // Validate that:
      // 1) Returned object should contain all shareholder keys.
      // 2) Total rewards distributed should match expected.
      // 3) Individual rewards distributed mach expected
      const expectedTotalRewardsDistributed = toBN(rewardsPerSnapshot).muln(snapshotsToTake);
      const expectedIndividualRewardsDistributed = expectedTotalRewardsDistributed.divn(shareHolders.length);
      let totalRewardsDistributed = toBN("0");
      for (shareHolder of shareHolders) {
        assert.isTrue(Object.keys(intervalPayout).includes(shareHolder));
        assert.equal(intervalPayout[shareHolder].toString(), expectedIndividualRewardsDistributed.toString());
        totalRewardsDistributed = totalRewardsDistributed.add(intervalPayout[shareHolder]);
      }
      assert.equal(expectedTotalRewardsDistributed.toString(), totalRewardsDistributed.toString());
    });
    it("Correctly splits rewards over n blocks (multiple block per snapshot and non-equal distribution)", async function() {
      // Create 31e18 tokens to distribute, sending 2^n*110^18 tokens to each liquidity provider. this works out to:
      //      shareholder0 2^0=1e18
      //      shareholder1 2^1=2e18
      //      shareholder2 2^2=4e18 ... and so on for the 5 shareholders.

      let index = 0;
      for (shareHolder of shareHolders) {
        await bpToken.mint(shareHolder, toWei(Math.pow(2, index).toString()), { from: contractCreator });
        index += 1;
      }

      // Capture the starting block number.
      const startingBlockNumber = await web3.eth.getBlockNumber();
      const startingBlockTimestamp = await web3.eth.getBlock(startingBlockNumber).timestamp;

      // generate 15 snapshots with each covering 8 blocks. This is equivalent to 120 blocks traversed.
      const snapshotsToTake = 15;
      const blocksPerSnapshot = 8;
      const blocksToAdvance = snapshotsToTake * blocksPerSnapshot;
      for (i = 0; i < blocksToAdvance; i++) {
        await advanceBlockAndSetTime(web3, startingBlockTimestamp + 15 * (1 + i));
      }
      const endingBlockNumber = await web3.eth.getBlockNumber();
      assert.equal(endingBlockNumber, startingBlockNumber + blocksToAdvance);

      const rewardsPerSnapshot = toWei("10"); // For each snapshot in time, payout 10e18 tokens

      const intervalPayout = await _calculatePayoutsBetweenBlocks(
        bpToken.contract,
        shareHolders,
        startingBlockNumber,
        endingBlockNumber,
        blocksPerSnapshot,
        rewardsPerSnapshot
      );

      // Validate that the individual rewards distributed mach expected for each shareholder.
      let expectedTotalRewardsDistributed = toBN(rewardsPerSnapshot).muln(snapshotsToTake);
      index = 0;
      for (shareHolder of shareHolders) {
        const shareHolderFrac = toBN(toWei(Math.pow(2, index).toString()))
          .mul(toBN(toWei("1")))
          .div(toBN(toWei("31")));
        const expectedIndividualRewardsDistributed = expectedTotalRewardsDistributed
          .mul(shareHolderFrac)
          .div(toBN(toWei("1")));

        assert.equal(intervalPayout[shareHolder].toString(), expectedIndividualRewardsDistributed.toString());
        index += 1;
      }
    });
    it("Correctly splits rewards over blocks including inter-snapshot transfers", async function() {
      // Create 10e18 tokens. Start with all LPs owning 1/5 of the supply (2e18 each). For this test we will move tokens
      // around over a number of blocks and validate that the LPs get paid the correct output. This test will update a
      // "local" expectoration of the payouts as blocks progress and then compare it to what the script returns.
      for (shareHolder of shareHolders) {
        await bpToken.mint(shareHolder, toWei("2"), { from: contractCreator });
      }
      const rewardsPerSnapshot = toWei("10"); // For each snapshot in time, payout 10e18 tokens

      // Create a data structure to store expected payouts as we move token balances over time.
      let shareHolderPayout = {};
      for (shareHolder of shareHolders) {
        shareHolderPayout[shareHolder] = toBN("0");
      }

      // Capture the starting block number.
      const startingBlockNumber = await web3.eth.getBlockNumber();
      const startingBlockTimestamp = await web3.eth.getBlock(startingBlockNumber).timestamp;
      // We will generate 10 snapshots with each covering 10 blocks. This is equivalent to 100 blocks traversed.
      // Each time ganache accepts a transaction it will advance by 1 block.
      const snapshotsToTake = 10;
      const blocksPerSnapshot = 10;
      const totalBlocksToAdvance = snapshotsToTake * blocksPerSnapshot; // Used at the end to validate traversal.

      // Advance over 2.5 snapshot windows. This is equivalent to 25 blocks. Block count: 0 -> 24
      const blocksToAdvance = 2.5 * blocksPerSnapshot;
      for (i = 0; i < blocksToAdvance; i++) {
        await advanceBlockAndSetTime(web3, startingBlockTimestamp + 15 * (1 + i));
      }

      // At this point each shareholder has earned 1/5 of all rewards for 3 snapshot periods (0, 1 & 2). As the time was
      // advanced 2.5 blocks, the last 5 blocks are not counted at this point as it is between snapshots (for snapshot 3).
      for (shareHolder of shareHolders) {
        shareHolderPayout[shareHolder] = toBN(rewardsPerSnapshot)
          .muln(3) // 3 periods captured,
          .divn(5); // 1/5 of the rewards.
      }

      // Next, let's assume that all shareholders transfer all of their tokens to one LP (shareHolder0). This will
      // create another 5 transactions bringing the block count: 25 -> 30
      for (shareHolder of shareHolders.slice(1, shareHolders.length)) {
        await bpToken.transfer(shareHolders[0], (await bpToken.balanceOf(shareHolder)).toString(), {
          from: shareHolder
        });
      }

      // Advance over another 2.5 snapshot windows. This takes the block cound from 30 -> 55
      let recentBlockTimestamp = await web3.eth.getBlock(await web3.eth.getBlockNumber()).timestamp;
      for (i = 0; i < blocksToAdvance; i++) {
        await advanceBlockAndSetTime(web3, recentBlockTimestamp + 15 * (1 + i));
      }

      // From the last shareholder payout update snapshots 3,4 and 5 have elapsed. Over this duration shareholder[0]
      // held all LP tokens.
      shareHolderPayout[shareHolders[0]] = toBN(shareHolderPayout[shareHolders[0]]).add(
        toBN(rewardsPerSnapshot).muln(3)
      );

      // Then, all token holders transfer their tokens to a new wallet. This will advance the block count from 55 -> 60
      const newShareHolder = accounts[9];
      for (shareHolder of shareHolders) {
        await bpToken.transfer(newShareHolder, (await bpToken.balanceOf(shareHolder)).toString(), {
          from: shareHolder
        });
      }

      // Finally, advance the timestamp until the end of the period. This will advance blocks from 60 -> 100
      recentBlockTimestamp = await web3.eth.getBlock(await web3.eth.getBlockNumber()).timestamp;
      const finalBlocksToAdvance = startingBlockNumber + totalBlocksToAdvance - (await web3.eth.getBlockNumber());
      for (i = 0; i < finalBlocksToAdvance; i++) {
        await advanceBlockAndSetTime(web3, recentBlockTimestamp + 15 * (1 + i));
      }

      // Update this new newShareHolder's balance in the mapping. He held all tokens from snapshots 7 -> 10.
      shareHolderPayout[newShareHolder] = toBN(rewardsPerSnapshot).muln(4);
      const endingBlockNumber = await web3.eth.getBlockNumber();

      // Check that we have traversed the right number of blocks.
      assert.equal(endingBlockNumber, startingBlockNumber + totalBlocksToAdvance);

      const intervalPayout = await _calculatePayoutsBetweenBlocks(
        bpToken.contract,
        [...shareHolders, newShareHolder],
        startingBlockNumber,
        endingBlockNumber,
        blocksPerSnapshot,
        rewardsPerSnapshot
      );

      // Validate that the individual rewards distributed mach expected for each shareholder.
      for (shareHolder of Object.keys(shareHolderPayout)) {
        assert.equal(shareHolderPayout[shareHolder].toString(), intervalPayout[shareHolder].toString());
      }
    });
  });
});

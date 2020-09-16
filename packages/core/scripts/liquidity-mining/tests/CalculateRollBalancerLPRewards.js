const { toWei, toBN } = web3.utils;

const { advanceBlockAndSetTime } = require("@uma/common");

const { _updatePayoutAtBlock, _calculatePayoutsBetweenBlocks } = require("../CalculateRollBalancerLPRewards");

const Token = artifacts.require("ExpandedERC20"); // Helper contracts to mock balancer pool.

let bpToken1; // balancerPoolToken1. Used to mock liquidity provision in the first pool.
let bpToken2; // balancerPoolToken2. Used to mock liquidity provision in the second pool.

let synth1; // synthetic token from before the roll.
let synth2; // synthetic token for after the roll.

contract("CalculateBalancerLPProviders.js", function(accounts) {
  const contractCreator = accounts[0];
  const shareHolders = accounts.slice(1, 6); // Array of accounts 1 -> 5 to represent shareholders(liquidity providers).

  describe("Correctly calculates payout at a given block number (_updatePayoutAtBlock)", function() {
    beforeEach(async function() {
      // Create two pool tokens during the roll.
      bpToken1 = await Token.new("BPT1", "BPT1", 18, {
        from: contractCreator
      });
      await bpToken1.addMember(1, contractCreator, {
        from: contractCreator
      });

      bpToken2 = await Token.new("BPT2", "BPT2", 18, {
        from: contractCreator
      });
      await bpToken2.addMember(1, contractCreator, {
        from: contractCreator
      });

      synth1 = await Token.new("SYNTH1", "SYNTH1", 18, {
        from: contractCreator
      });
      await synth1.addMember(1, contractCreator, {
        from: contractCreator
      });

      synth2 = await Token.new("SYNTH2", "SYNTH2", 18, {
        from: contractCreator
      });
      await synth2.addMember(1, contractCreator, {
        from: contractCreator
      });
    });

    it("Correctly splits payout over all liquidity providers (balanced case)", async function() {
      // Create 10e18 tokens to distribute, sending 2e18 to each liquidity provider. Put equal amounts in both pools.
      // In this case the rewards should be split equal as all contributes are equally divided between the pools.
      for (shareHolder of shareHolders) {
        await bpToken1.mint(shareHolder, toWei("2"), {
          from: contractCreator
        });
      }
      for (shareHolder of shareHolders) {
        await bpToken2.mint(shareHolder, toWei("2"), {
          from: contractCreator
        });
      }

      // Put equal number of synths in the balancer pools. This will make the BPT tokens equally valued in synth terms.
      await synth1.mint(bpToken1.address, toWei("100"), {
        from: contractCreator
      });

      await synth2.mint(bpToken2.address, toWei("100"), {
        from: contractCreator
      });

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
        bpToken1.contract,
        bpToken2.contract,
        synth1.contract,
        synth2.contract,
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
    it("Correctly splits payout over all liquidity providers (1 unbalanced pool case)", async function() {
      // Create 10e18 tokens to distribute, sending all to one liquidity provider in one of the two pools. this is
      // equivalent to only having one LP that does not roll their position.
      await bpToken1.mint(shareHolders[0], toWei("10"), {
        from: contractCreator
      });

      // Create an object to store the payouts for a given block. This should be an object with key being the
      // shareholder address and value being their respective payout.
      let shareHolderPayout = {};
      for (shareHolder of shareHolders) {
        shareHolderPayout[shareHolder] = toBN("0");
      }

      // Put synths only in the first pool as there are none minted in the second pool.
      await synth1.mint(bpToken1.address, toWei("100"), {
        from: contractCreator
      });

      const blockNumber = await web3.eth.getBlockNumber();
      // Distribute 5 tokens per snapshot. There is only one shareholder who holds tokens at the given block number. They
      // should exclusively receive all token payouts.
      const tokensPerSnapShot = toWei("5");

      // Call the `_updatePayoutAtBlock` to get the distribution at a given `blockNumber`.
      const payoutAtBlock = await _updatePayoutAtBlock(
        bpToken1.contract,
        bpToken2.contract,
        synth1.contract,
        synth2.contract,
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
    it("Correctly splits payout over all liquidity providers (2 unbalanced pools case)", async function() {
      // Create 10e18 tokens to distribute, sending 1/5 to shareHolders[0] in pool 1 and 4/5 to shareHolders[1] in pool 2.
      await bpToken1.mint(shareHolders[0], toWei("2"), {
        from: contractCreator
      });
      await bpToken2.mint(shareHolders[1], toWei("8"), {
        from: contractCreator
      });

      // Put a proportion number of synths in the balancer pools. This will make the BPT tokens equally valued in synth terms.
      await synth1.mint(bpToken1.address, toWei("200"), {
        from: contractCreator
      });

      await synth2.mint(bpToken2.address, toWei("800"), {
        from: contractCreator
      });

      // Create an object to store the payouts for a given block. This should be an object with key being the
      // shareholder address and value being their respective payout.
      let shareHolderPayout = {};
      for (shareHolder of shareHolders) {
        shareHolderPayout[shareHolder] = toBN("0");
      }

      const blockNumber = await web3.eth.getBlockNumber();
      // Distribute 5 tokens per snapshot. There is only one shareholder who holds tokens at the given block number. They
      // should exclusively receive all token payouts.
      const tokensPerSnapShot = toBN(toWei("5"));

      // Call the `_updatePayoutAtBlock` to get the distribution at a given `blockNumber`.
      const payoutAtBlock = await _updatePayoutAtBlock(
        bpToken1.contract,
        bpToken2.contract,
        synth1.contract,
        synth2.contract,
        blockNumber,
        shareHolderPayout,
        tokensPerSnapShot
      );

      // Validate that the two shareholders got the right payouts. shareholder[0] should have 1/5 and shareholder[1]
      // should have 4/5 of the total payouts. Everyone else should get nothing.
      assert.equal(
        payoutAtBlock[shareHolders[0]].toString(),
        tokensPerSnapShot
          .muln(1)
          .divn(5)
          .toString()
      );
      assert.equal(
        payoutAtBlock[shareHolders[1]].toString(),
        tokensPerSnapShot
          .muln(4)
          .divn(5)
          .toString()
      );
      const expectedPayoutPerOtherShareholder = toWei("0");
      for (shareholder of shareHolders.slice(2, 6)) {
        assert.equal(payoutAtBlock[shareHolder].toString(), expectedPayoutPerOtherShareholder.toString());
      }
    });
    it("Correctly splits payout over all liquidity providers (extreme fractional case in two pools)", async function() {
      // Create 10e18 tokens to distribute, sending all to shareHolders[0] in one pool and send 100 wei of tokens to shareHolders[1] in the other pool.
      await bpToken1.mint(shareHolders[0], toWei("10"), {
        from: contractCreator
      }); // shareholder0 gets 10e18 tokens
      await bpToken1.mint(shareHolders[1], "100", {
        from: contractCreator
      }); // Shareholder1 gets 100 tokens. (100 wei)

      // Put a proportion number of synths in the balancer pools. This will make the BPT tokens equally valued in synth terms.
      await synth1.mint(bpToken1.address, toWei("10"), {
        from: contractCreator
      });

      await synth2.mint(bpToken2.address, "100", {
        from: contractCreator
      });

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
        bpToken1.contract,
        bpToken2.contract,
        synth1.contract,
        synth2.contract,
        blockNumber,
        shareHolderPayout,
        tokensPerSnapShot
      );

      // Validate the two shareholders got the correct proportion of token rewards.
      // shareHolder0 expected payout is their pool tokens (10e18) divided by the total pool provision(10e18+100).
      const shareHolder0Frac = toBN(toWei("10")) // fraction of the pool is their contribution/total pool
        .mul(toBN(toWei("1")))
        .div(toBN(toWei("10")).addn(200));

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
    it("Correctly splits payout over all liquidity providers (unbalanced pool case)", async function() {
      // Create 10e18 tokens to distribute, sending 2e18 to each liquidity provider. Put equal amounts in both pools
      // but make half the LPs in the first pool and the other half in the second pool, using the first 4 shareholders.
      for (shareHolder of shareHolders.slice(0, 2)) {
        await bpToken1.mint(shareHolder, toWei("2"), {
          from: contractCreator
        });
      }
      for (shareHolder of shareHolders.slice(2, 4)) {
        await bpToken2.mint(shareHolder, toWei("2"), {
          from: contractCreator
        });
      }

      // Put unequal number of synths in the balancer pools. This will make the bpt worth different amounts, even
      // though the sponsors all have equal number of bpt. This simulates seeding the balancer pools at different
      // prices resulting in each bpt being redeemable for different numbers of yUSD. There are a total of 4 bpt
      // minted in each pool. With 60 Synths redeemable in the pool 1 this makes each bpt redeemable for 60/4=15 synths.
      // With 40 synths in pool 2 this makes each bpt redeemable for 40/4=10

      await synth1.mint(bpToken1.address, toWei("60"), {
        from: contractCreator
      });

      await synth2.mint(bpToken2.address, toWei("40"), {
        from: contractCreator
      });

      // Create an object to store the payouts for a given block. This should be an object with key being the
      // shareholder address and value being their respective payout.
      let shareHolderPayout = {};
      for (shareHolder of shareHolders) {
        shareHolderPayout[shareHolder] = toBN("0");
      }

      const blockNumber = await web3.eth.getBlockNumber();
      // Distribute 5 tokens per snapshot.
      const tokensPerSnapShot = toWei("5");

      // Call the `_updatePayoutAtBlock` to get the distribution at a given `blockNumber`.
      const payoutAtBlock = await _updatePayoutAtBlock(
        bpToken1.contract,
        bpToken2.contract,
        synth1.contract,
        synth2.contract,
        blockNumber,
        shareHolderPayout,
        tokensPerSnapShot
      );

      // Validate that each shareholder got the right number of tokens for the given block. Each sponsors reward should
      // be: myReward = (totalUMAPayout * (myyUSDinBP1 + myyUSDinBP2)) / (totalyUSDinBP1 + totalyUSDinBP2);
      // sponsor 1 & 2 have 2 bpt worth 15 yUSD each = 30 yUSD. sponsor 3 & 4 have 2 bpt worth 10 yUSD each = 20 yUSD.
      // Expecting sponsor 1 & 2 to get 5 * (30 + 0) / (60 + 40) = 1.5
      // Expecting sponsor 3 & 4 to get 5 * (0 + 20) / (60 + 40) = 1.0
      for (shareHolder of shareHolders.slice(0, 2)) {
        assert.equal(payoutAtBlock[shareHolder].toString(), toWei("1.5"));
      }

      for (shareHolder of shareHolders.slice(2, 4)) {
        assert.equal(payoutAtBlock[shareHolder].toString(), toWei("1.0"));
      }
    });
  });
  describe("Correctly calculates payouts over a range of block numbers (_calculatePayoutsBetweenBlocks)", function() {
    beforeEach(async function() {
      // Create two pool tokens during the roll.
      bpToken1 = await Token.new("BPT1", "BPT1", 18, {
        from: contractCreator
      });
      await bpToken1.addMember(1, contractCreator, {
        from: contractCreator
      });

      bpToken2 = await Token.new("BPT2", "BPT2", 18, {
        from: contractCreator
      });
      await bpToken2.addMember(1, contractCreator, {
        from: contractCreator
      });
    });

    it("Correctly splits rewards over n blocks (simple case)", async function() {
      // Create 10e18 tokens to distribute, sending 1e18 to each liquidity provider in pool 1 and 1e18 in pool 2.
      for (shareHolder of shareHolders) {
        await bpToken1.mint(shareHolder, toWei("1"), { from: contractCreator });
        await bpToken2.mint(shareHolder, toWei("1"), { from: contractCreator });
      }

      // Put equal number of synths in the balancer pools. This will make the BPT tokens equally valued in synth terms.
      await synth1.mint(bpToken1.address, toWei("100"), {
        from: contractCreator
      });

      await synth2.mint(bpToken2.address, toWei("100"), {
        from: contractCreator
      });

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
        bpToken1.contract,
        bpToken2.contract,
        synth1.contract,
        synth2.contract,
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
    it("Correctly splits rewards over n blocks (multiple block per snapshot and non-equal distribution between pools)", async function() {
      // Create 31e18 tokens to distribute, sending 2^n*110^18 tokens to each liquidity provider. this works out to:
      //      shareholder0 2 ^ 0=1e18
      //      shareholder1 2^1=2e18
      //      shareholder2 2^2=4e18 ... and so on for the 5 shareholders.
      // For each shareholder alternate between the pools that they are part of. Mint a proportional number of synths
      // and send them to the pools.

      let index = 0;
      for (shareHolder of shareHolders) {
        if (index % 2) {
          const tokensToMint = toWei(Math.pow(2, index).toString());
          await bpToken1.mint(shareHolder, tokensToMint, {
            from: contractCreator
          });
          await synth1.mint(bpToken1.address, tokensToMint, {
            from: contractCreator
          });
        }
        if (!(index % 2)) {
          const tokensToMint = toWei(Math.pow(2, index).toString());
          await bpToken2.mint(shareHolder, tokensToMint, {
            from: contractCreator
          });
          await synth2.mint(bpToken2.address, tokensToMint, {
            from: contractCreator
          });
        }
        index += 1;
      }

      // Put equal number of synths in the balancer pools. This will make the BPT tokens equally valued in synth terms.

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
        bpToken1.contract,
        bpToken2.contract,
        synth1.contract,
        synth2.contract,
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
  });
});

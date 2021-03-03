// TODO: Import `merkle-distributor` modules via package.json
const { MerkleTree } = require("../../../merkle-distributor/src/merkleTree");

const SamplePayouts = require("./SamplePayout.json");
const truffleAssert = require("truffle-assertions");
const { toBN, toWei, utf8ToHex } = web3.utils;
const { MAX_UINT_VAL, didContractThrow } = require("@uma/common");
const { assert } = require("chai");

// Tested Contract
const MerkleDistributor = artifacts.require("MerkleDistributor");
const Timer = artifacts.require("Timer");
const Token = artifacts.require("ExpandedERC20");

// Contract instances
let merkleDistributor;
let timer;
let rewardToken;

// Test variables
let rewardRecipients;
let merkleTree;
let rewardLeafs;
let leaf;
let claimerProof;
let windowIndex;
let windowStart;

// For a recipient object, create the leaf to be part of the merkle tree. The leaf is simply a hash of the packed
// account and the amount.
const createLeaf = recipient => {
  assert.isTrue(
    Object.keys(recipient).every(val => ["account", "amount"].includes(val)),
    "recipient does not contain required keys"
  );
  return web3.utils.soliditySha3({ t: "address", v: recipient.account }, { t: "uint256", v: recipient.amount });
};

// Generate payouts to be used in tests using the SamplePayouts file. SamplePayouts is read in from a JsonFile.
const createRewardRecipientsFromSampleData = SamplePayouts => {
  return Object.keys(SamplePayouts.exampleRecipients).map(recipientAddress => {
    return { account: recipientAddress, amount: SamplePayouts.exampleRecipients[recipientAddress] };
  });
};

contract("MerkleDistributor.js", function(accounts) {
  let contractCreator = accounts[0];
  let rando = accounts[1];

  beforeEach(async () => {
    timer = await Timer.deployed();
    merkleDistributor = await MerkleDistributor.new(timer.address);

    rewardToken = await Token.new("UMA KPI Options July 2021", "uKIP-JUL", 18, { from: contractCreator });
    await rewardToken.addMember(1, contractCreator, { from: contractCreator });
    await rewardToken.mint(contractCreator, toWei("10000000"), { from: contractCreator });
    await rewardToken.approve(merkleDistributor.address, MAX_UINT_VAL, { from: contractCreator });
  });
  describe("Basic lifecycle", function() {
    it("Can create a single, simple tree, seed the distributor and claim rewards", async function() {
      const currentTime = await timer.getCurrentTime();
      const _rewardRecipients = [
        // [ recipient, rewardAmount ]
        [accounts[3], toBN(toWei("100"))],
        [accounts[4], toBN(toWei("200"))],
        [accounts[5], toBN(toWei("300"))]
      ];
      let totalRewardAmount = toBN(0);
      rewardRecipients = _rewardRecipients.map(_rewardObj => {
        totalRewardAmount = totalRewardAmount.add(_rewardObj[1]);
        return { account: _rewardObj[0], amount: _rewardObj[1].toString() };
      });

      // Generate leafs for each recipient. This is simply the hash of each component of the payout from above.
      rewardLeafs = rewardRecipients.map(item => ({ ...item, leaf: createLeaf(item) }));

      // Build the merkle tree from an array of hashes from each recipient.
      merkleTree = new MerkleTree(rewardLeafs.map(item => item.leaf));

      windowStart = currentTime;
      // Expect this merkle root to be at the first index.
      windowIndex = 0;

      // Seed the merkleDistributor with the root of the tree and additional information.
      const seedTxn = await merkleDistributor.setWindow(
        totalRewardAmount,
        windowStart,
        rewardToken.address,
        merkleTree.getRoot(),
        { from: contractCreator }
      );

      // Check event logs.
      truffleAssert.eventEmitted(seedTxn, "SetWindow", ev => {
        return (
          ev.windowIndex.toString() === windowIndex.toString() &&
          ev.amount.toString() === totalRewardAmount.toString() &&
          ev.windowStart.toString() === windowStart.toString() &&
          ev.rewardToken === rewardToken.address &&
          ev.owner === contractCreator
        );
      });

      // Check on chain Window state:
      const windowState = await merkleDistributor.merkleWindows(windowIndex);
      assert.equal(windowState.start.toString(), windowStart.toString());
      assert.equal(windowState.merkleRoot, merkleTree.getRoot());
      assert.equal(windowState.rewardToken, rewardToken.address);

      // Check that latest seed index has incremented.
      assert.equal((await merkleDistributor.lastSeededIndex()).toString(), (windowIndex + 1).toString());

      // Claim for all accounts:
      for (let i = 0; i < rewardLeafs.length; i++) {
        leaf = rewardLeafs[i];
        claimerProof = merkleTree.getProof(leaf.leaf);
        const claimerBalanceBefore = await rewardToken.balanceOf(leaf.account);
        const contractBalanceBefore = await rewardToken.balanceOf(merkleDistributor.address);

        // Claim the rewards, providing the information needed to re-build the tree & verify the proof.
        // Note: Anyone can claim on behalf of anyone else.
        const claimTxn = await merkleDistributor.claimWindow(
          { windowIndex: windowIndex, account: leaf.account, amount: leaf.amount, merkleProof: claimerProof },
          { from: contractCreator }
        );
        // Check event logs.
        truffleAssert.eventEmitted(claimTxn, "Claimed", ev => {
          return (
            ev.caller === contractCreator &&
            ev.account === leaf.account &&
            ev.windowIndex.toString() === windowIndex.toString() &&
            ev.amount.toString() === leaf.amount.toString() &&
            ev.rewardToken == rewardToken.address
          );
        });
        // Claimer balance should have increased by the amount of the reward.
        assert.equal(
          (await rewardToken.balanceOf(leaf.account)).toString(),
          claimerBalanceBefore.add(toBN(leaf.amount)).toString()
        );
        // Contract balance should have decreased by reward amount.
        assert.equal(
          (await rewardToken.balanceOf(merkleDistributor.address)).toString(),
          contractBalanceBefore.sub(toBN(leaf.amount)).toString()
        );
        // User should be marked as claimed and cannot claim again.
        assert.isTrue(await merkleDistributor.claimed(windowIndex, leaf.account));
        assert(
          await didContractThrow(
            merkleDistributor.claimWindow(
              { windowIndex: windowIndex, account: leaf.account, amount: leaf.amount, merkleProof: claimerProof },
              // Should fail for same account and window index, even if caller is another account.
              { from: rando }
            )
          )
        );
      }
    });
  });
  describe("(claimWindow)", function() {
    // For each test in the single window, load in the SampleMerklePayouts, generate a tree and set it in the distributor.
    beforeEach(async function() {
      // Window should be the first in the contract.
      windowIndex = 0;
      const currentTime = await timer.getCurrentTime();
      // Start window at T+1.
      windowStart = Number(currentTime.toString()) + 1;

      rewardRecipients = createRewardRecipientsFromSampleData(SamplePayouts);

      // Generate leafs for each recipient. This is simply the hash of each component of the payout from above.
      rewardLeafs = rewardRecipients.map(item => ({ ...item, leaf: createLeaf(item) }));
      merkleTree = new MerkleTree(rewardLeafs.map(item => item.leaf));

      // Seed the merkleDistributor with the root of the tree and additional information.
      await merkleDistributor.setWindow(
        SamplePayouts.totalRewardsDistributed,
        windowStart,
        rewardToken.address,
        merkleTree.getRoot()
      );

      leaf = rewardLeafs[0];
      claimerProof = merkleTree.getProof(leaf.leaf);
    });
    it("Cannot claim until window start", async function() {
      assert(
        await didContractThrow(
          merkleDistributor.claimWindow({
            windowIndex: windowIndex,
            account: leaf.account,
            amount: leaf.amount,
            merkleProof: claimerProof
          })
        )
      );

      // Advance time to window start and claim successfully.
      await merkleDistributor.setCurrentTime(windowStart.toString());
      await merkleDistributor.claimWindow({
        windowIndex: windowIndex,
        account: leaf.account,
        amount: leaf.amount,
        merkleProof: claimerProof
      });
    });
    describe("Current time > window start", function() {
      beforeEach(async function() {
        await merkleDistributor.setCurrentTime(windowStart.toString());
      });
      it("Cannot claim for invalid window index", async function() {
        assert(
          await didContractThrow(
            merkleDistributor.claimWindow({
              windowIndex: windowIndex + 1,
              account: leaf.account,
              amount: leaf.amount,
              merkleProof: claimerProof
            })
          )
        );
      });
      it("Can claim on another account's behalf", async function() {
        const claimerBalanceBefore = await rewardToken.balanceOf(leaf.account);
        const claimTx = await merkleDistributor.claimWindow(
          { windowIndex: windowIndex, account: leaf.account, amount: leaf.amount, merkleProof: claimerProof },
          { from: rando }
        );
        assert.equal(
          (await rewardToken.balanceOf(leaf.account)).toString(),
          claimerBalanceBefore.add(toBN(leaf.amount)).toString()
        );

        truffleAssert.eventEmitted(claimTx, "Claimed", ev => {
          return (
            ev.caller.toLowerCase() == rando.toLowerCase() &&
            ev.account.toLowerCase() == leaf.account.toLowerCase() &&
            ev.windowIndex.toString() === windowIndex.toString() &&
            ev.amount.toString() == leaf.amount.toString() &&
            ev.rewardToken.toLowerCase() == rewardToken.address.toLowerCase()
          );
        });

        assert.isTrue(await merkleDistributor.claimed(windowIndex, leaf.account));
      });
      it("Cannot double claim rewards", async function() {
        await merkleDistributor.claimWindow({
          windowIndex: windowIndex,
          account: leaf.account,
          amount: leaf.amount,
          merkleProof: claimerProof
        });
        assert(
          await didContractThrow(
            merkleDistributor.claimWindow({
              windowIndex: windowIndex,
              account: leaf.account,
              amount: leaf.amount,
              merkleProof: claimerProof
            })
          )
        );
      });
      it("Claim for 0 tokens does not revert", async function() {
        // Payout #9 is for 0 tokens.
        leaf = rewardLeafs[9];
        claimerProof = merkleTree.getProof(leaf.leaf);
        const claimerBalanceBefore = await rewardToken.balanceOf(leaf.account);
        await merkleDistributor.claimWindow(
          { windowIndex: windowIndex, account: leaf.account, amount: leaf.amount, merkleProof: claimerProof },
          { from: rando }
        );
        assert.equal((await rewardToken.balanceOf(leaf.account)).toString(), claimerBalanceBefore.toString());
        assert.isTrue(await merkleDistributor.claimed(windowIndex, leaf.account));
      });
      it("Claim for one window does not affect other windows", async function() {
        // Create another duplicate Merkle root. `setWindowMerkleRoot` will dynamically
        // increment the index for this new root.
        rewardRecipients = createRewardRecipientsFromSampleData(SamplePayouts);
        let otherRewardLeafs = rewardRecipients.map(item => ({ ...item, leaf: createLeaf(item) }));
        let otherMerkleTree = new MerkleTree(rewardLeafs.map(item => item.leaf));
        await merkleDistributor.setWindow(
          SamplePayouts.totalRewardsDistributed,
          windowStart,
          rewardToken.address,
          merkleTree.getRoot()
        );

        // Assumption: otherLeaf and leaf are claims for the same account.
        let otherLeaf = otherRewardLeafs[0];
        let otherClaimerProof = otherMerkleTree.getProof(leaf.leaf);
        const startingBalance = await rewardToken.balanceOf(otherLeaf.account);

        // Create a claim for original tree and show that it does not affect the claim for the same
        // proof for this tree. This effectively tests that the `claimed` mapping correctly
        // tracks claims across window indices.
        await merkleDistributor.claimWindow({
          windowIndex: windowIndex,
          account: leaf.account,
          amount: leaf.amount,
          merkleProof: claimerProof
        });

        // Can claim for other window index.
        await merkleDistributor.claimWindow({
          windowIndex: windowIndex + 1,
          account: otherLeaf.account,
          amount: otherLeaf.amount,
          merkleProof: otherClaimerProof
        });

        // Balance should have increased by both claimed amounts:
        assert.equal(
          (await rewardToken.balanceOf(otherLeaf.account)).toString(),
          startingBalance.add(toBN(leaf.amount).add(toBN(otherLeaf.amount))).toString()
        );
      });
      it("gas", async function() {
        const claimTx = await merkleDistributor.claimWindow({
          windowIndex: windowIndex,
          account: leaf.account,
          amount: leaf.amount,
          merkleProof: claimerProof
        });
        // Compare gas used against benchmark implementation: Uniswap's "single window" Merkle distributor,
        // that uses a Bitmap instead of mapping between addresses and booleans to track claims.
        console.log(`Gas used: ${claimTx.receipt.gasUsed}`);
      });
      it("invalid proof", async function() {
        // Incorrect account:
        assert(
          await didContractThrow(
            merkleDistributor.claimWindow({
              windowIndex: windowIndex,
              account: rando,
              amount: leaf.amount,
              merkleProof: claimerProof
            })
          )
        );

        // Incorrect amount:
        const invalidAmount = "1";
        assert(
          await didContractThrow(
            merkleDistributor.claimWindow({
              windowIndex: windowIndex,
              account: leaf.account,
              amount: invalidAmount,
              merkleProof: claimerProof
            })
          )
        );

        // Invalid merkle proof:
        const invalidProof = [utf8ToHex("0x")];
        assert(
          await didContractThrow(
            merkleDistributor.claimWindow({
              windowIndex: windowIndex,
              account: leaf.account,
              amount: leaf.amount,
              merkleProof: invalidProof
            })
          )
        );
      });
    });
  });
  describe("(claimWindows)", function() {
    let rewardRecipients1, rewardRecipients2;
    let rewardLeafs1, rewardLeafs2;
    let merkleTree1, merkleTree2;
    beforeEach(async function() {
      // Assume we start at first windowIndex. Disable vesting.
      windowIndex = 0;
      const currentTime = await timer.getCurrentTime();
      windowStart = currentTime;

      rewardRecipients1 = createRewardRecipientsFromSampleData(SamplePayouts);

      // Generate another set of reward recipients, as the same set as number 1 but double the rewards.
      rewardRecipients2 = rewardRecipients1.map(recipient => {
        return {
          account: recipient.account,
          amount: toBN(recipient.amount)
            .muln(2)
            .toString()
        };
      });

      // Generate leafs for each recipient. This is simply the hash of each component of the payout from above.
      rewardLeafs1 = rewardRecipients1.map(item => ({ ...item, leaf: createLeaf(item) }));
      rewardLeafs2 = rewardRecipients2.map(item => ({ ...item, leaf: createLeaf(item) }));

      merkleTree1 = new MerkleTree(rewardLeafs1.map(item => item.leaf));
      merkleTree2 = new MerkleTree(rewardLeafs2.map(item => item.leaf));

      // Seed the merkleDistributor with the root of the tree and additional information.
      await merkleDistributor.setWindow(
        SamplePayouts.totalRewardsDistributed,
        windowStart,
        rewardToken.address,
        merkleTree1.getRoot() // Distributes to rewardLeafs1
      );

      await merkleDistributor.setWindow(
        SamplePayouts.totalRewardsDistributed,
        windowStart,
        rewardToken.address,
        merkleTree2.getRoot() // Distributes to rewardLeafs2
      );
    });
    it("Can make multiple claims in one transaction", async function() {
      // Batch claim for account[0].
      const leaf1 = rewardLeafs1[0];
      const leaf2 = rewardLeafs2[0];

      const accountBalanceBefore = await rewardToken.balanceOf(leaf1.account);

      const claims = [
        {
          windowIndex: windowIndex,
          account: leaf1.account,
          amount: leaf1.amount,
          merkleProof: merkleTree1.getProof(leaf1.leaf)
        },
        {
          windowIndex: windowIndex + 1,
          account: leaf2.account,
          amount: leaf2.amount,
          merkleProof: merkleTree2.getProof(leaf2.leaf)
        }
      ];
      const claimTx = await merkleDistributor.claimWindows(claims, rewardToken.address, leaf1.account, { from: rando });
      console.log(`Gas used: ${claimTx.receipt.gasUsed}`);

      // Account 0 should have gained claimed amount from both leaves.
      const batchedClaimAmount = toBN(leaf1.amount).add(toBN(leaf2.amount));
      assert.equal(
        (await rewardToken.balanceOf(leaf1.account)).toString(),
        accountBalanceBefore.add(batchedClaimAmount).toString()
      );

      // One Claimed event should have been emitted for each batched claim.
      const claimedEvents = await merkleDistributor.getPastEvents("Claimed");
      assert.equal(claimedEvents.length, claims.length);
    });
    it("Can only batch claim for one account", async function() {
      // Leaf 2 is for account[1], can't batch claim for two different accounts.
      const leaf1 = rewardLeafs1[0];
      const leaf2 = rewardLeafs1[1];

      const invalidClaims = [
        {
          windowIndex: windowIndex,
          account: leaf1.account,
          amount: leaf1.amount,
          merkleProof: merkleTree1.getProof(leaf1.leaf)
        },
        {
          windowIndex: windowIndex,
          account: leaf2.account,
          amount: leaf2.amount,
          merkleProof: merkleTree1.getProof(leaf2.leaf)
        }
      ];

      assert(await didContractThrow(merkleDistributor.claimWindows(invalidClaims, rewardToken.address, leaf1.account)));
    });
  });
  describe("(setWindow)", function() {
    beforeEach(async function() {
      const currentTime = await timer.getCurrentTime();
      // Start window at current time, disable vesting
      windowStart = currentTime;

      rewardRecipients = createRewardRecipientsFromSampleData(SamplePayouts);

      // Generate leafs for each recipient. This is simply the hash of each component of the payout from above.
      rewardLeafs = rewardRecipients.map(item => ({ ...item, leaf: createLeaf(item) }));
      merkleTree = new MerkleTree(rewardLeafs.map(item => item.leaf));
    });
    it("Only owner can call", async function() {
      assert(
        await didContractThrow(
          merkleDistributor.setWindow(
            SamplePayouts.totalRewardsDistributed,
            windowStart,
            rewardToken.address,
            merkleTree.getRoot(),
            { from: rando }
          )
        )
      );
    });
    it("Owner's balance is transferred to contract", async function() {
      let ownerBalanceBefore = await rewardToken.balanceOf(contractCreator);

      await merkleDistributor.setWindow(
        SamplePayouts.totalRewardsDistributed,
        windowStart,
        rewardToken.address,
        merkleTree.getRoot(),
        { from: contractCreator }
      );

      assert.equal(
        ownerBalanceBefore.sub(toBN(SamplePayouts.totalRewardsDistributed)).toString(),
        (await rewardToken.balanceOf(contractCreator)).toString()
      );
    });
    it("(lastSeededIndex): starts at 1 and increments on each seed", async function() {
      assert.equal((await merkleDistributor.lastSeededIndex()).toString(), "0");

      await merkleDistributor.setWindow(
        SamplePayouts.totalRewardsDistributed,
        windowStart,
        rewardToken.address,
        merkleTree.getRoot(),
        { from: contractCreator }
      );

      assert.equal((await merkleDistributor.lastSeededIndex()).toString(), "1");
    });
  });
  describe("Emergency admin functions", function() {
    beforeEach(async function() {
      // Assume we start at first windowIndex.
      windowIndex = 0;
      const currentTime = await timer.getCurrentTime();
      windowStart = currentTime;

      rewardRecipients = createRewardRecipientsFromSampleData(SamplePayouts);
      rewardLeafs = rewardRecipients.map(item => ({ ...item, leaf: createLeaf(item) }));

      merkleTree = new MerkleTree(rewardLeafs.map(item => item.leaf));

      await merkleDistributor.setWindow(
        SamplePayouts.totalRewardsDistributed,
        windowStart,
        rewardToken.address,
        merkleTree.getRoot()
      );

      leaf = rewardLeafs[0];
      claimerProof = merkleTree.getProof(leaf.leaf);
    });
    describe("(withdrawRewards)", function() {
      it("Only owner can call", async function() {
        assert(
          await didContractThrow(merkleDistributor.withdrawRewards(rewardToken.address, toWei("1"), { from: rando }))
        );
      });
      it("Sends rewards to owner", async function() {
        let ownerBalanceBefore = await rewardToken.balanceOf(contractCreator);
        let contractBalanceBefore = await rewardToken.balanceOf(merkleDistributor.address);

        const withdrawAmount = toWei("1");
        const txn = await merkleDistributor.withdrawRewards(rewardToken.address, withdrawAmount, {
          from: contractCreator
        });
        truffleAssert.eventEmitted(txn, "WithdrawRewards", ev => {
          return ev.owner === contractCreator && ev.amount.toString() === withdrawAmount;
        });

        assert.equal(
          ownerBalanceBefore.add(toBN(withdrawAmount)).toString(),
          (await rewardToken.balanceOf(contractCreator)).toString()
        );
        assert.equal(
          contractBalanceBefore.sub(toBN(withdrawAmount)).toString(),
          (await rewardToken.balanceOf(merkleDistributor.address)).toString()
        );
      });
    });
    describe("(deleteWindow)", function() {
      it("Only owner can call", async function() {
        assert(await didContractThrow(merkleDistributor.deleteWindow(windowIndex, { from: rando })));
      });
      it("Deletes merkle root and all claims for the window index revert", async function() {
        const txn = await merkleDistributor.deleteWindow(windowIndex, { from: contractCreator });

        truffleAssert.eventEmitted(txn, "DeleteWindow", ev => {
          return ev.windowIndex.toString() === windowIndex.toString() && ev.owner === contractCreator;
        });

        // All claims on this window revert
        assert(
          await didContractThrow(
            merkleDistributor.claimWindow({
              windowIndex: windowIndex,
              account: leaf.account,
              amount: leaf.amount,
              merkleProof: claimerProof
            })
          )
        );
      });
    });
  });
});

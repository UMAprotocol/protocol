const { MerkleTree } = require("@uma/merkle-distributor");
const SamplePayouts = require("./SamplePayout.json");
const truffleAssert = require("truffle-assertions");
const { toBN, toWei, utf8ToHex, padRight } = web3.utils;
const { MAX_UINT_VAL, didContractThrow } = require("@uma/common");
const { assert } = require("chai");
const Promise = require("bluebird");

// Tested Contract
const MerkleDistributor = artifacts.require("MerkleDistributor");
const Token = artifacts.require("ExpandedERC20");

// Contract instances
let merkleDistributor;
let rewardToken;

// Test variables
let rewardRecipients;
let merkleTree;
let rewardLeafs;
let leaf;
let claimerProof;
let windowIndex;

const sampleIpfsHash = "QmfVMHgoWpTSZqovo7vhM7Wcmz6EeX4QBYbCk4DZTNM8u3";

// For a recipient object, create the leaf to be part of the merkle tree. The leaf is simply a hash of the packed
// account and the amount.
const createLeaf = recipient => {
  assert.isTrue(
    Object.keys(recipient).every(val => ["account", "amount", "accountIndex"].includes(val)),
    "recipient does not contain required keys"
  );

  return Buffer.from(
    web3.utils
      .soliditySha3(
        { t: "address", v: recipient.account },
        { t: "uint256", v: recipient.amount },
        { t: "uint256", v: recipient.accountIndex }
      )
      .slice(2),
    "hex"
  );
};

// Generate payouts to be used in tests using the SamplePayouts file. SamplePayouts is read in from a JsonFile.
const createRewardRecipientsFromSampleData = SamplePayouts => {
  return Object.keys(SamplePayouts.exampleRecipients).map((recipientAddress, i) => {
    return {
      account: recipientAddress,
      amount: SamplePayouts.exampleRecipients[recipientAddress],
      accountIndex: i
    };
  });
};

const assertApproximate = (expectedVal, testVal, errorPercent = 0.01) => {
  // Asserts `testVal` is within some error bounds of `expectedVal`
  assert.isTrue(testVal <= expectedVal * (1 + errorPercent) && testVal >= expectedVal * (1 - errorPercent));
};

contract("MerkleDistributor.js", function(accounts) {
  let contractCreator = accounts[0];
  let rando = accounts[1];

  beforeEach(async () => {
    merkleDistributor = await MerkleDistributor.new();

    rewardToken = await Token.new("UMA KPI Options July 2021", "uKIP-JUL", 18, { from: contractCreator });
    await rewardToken.addMember(1, contractCreator, { from: contractCreator });
    await rewardToken.mint(contractCreator, MAX_UINT_VAL, { from: contractCreator });
    await rewardToken.approve(merkleDistributor.address, MAX_UINT_VAL, { from: contractCreator });
  });
  describe("Basic lifecycle", function() {
    it("Can create a single, simple tree, seed the distributor and claim rewards", async function() {
      const _rewardRecipients = [
        // [ recipient, rewardAmount, accountIndex]
        [accounts[3], toBN(toWei("100")), 3],
        [accounts[4], toBN(toWei("200")), 4],
        [accounts[5], toBN(toWei("300")), 5]
      ];
      let totalRewardAmount = toBN(0);
      rewardRecipients = _rewardRecipients.map(_rewardObj => {
        totalRewardAmount = totalRewardAmount.add(_rewardObj[1]);
        return {
          account: _rewardObj[0],
          amount: _rewardObj[1].toString(),
          accountIndex: _rewardObj[2]
        };
      });

      // Generate leafs for each recipient. This is simply the hash of each component of the payout from above.
      rewardLeafs = rewardRecipients.map(item => ({ ...item, leaf: createLeaf(item) }));

      // Build the merkle tree from an array of hashes from each recipient.
      merkleTree = new MerkleTree(rewardLeafs.map(item => item.leaf));

      // Expect this merkle root to be at the first index.
      windowIndex = 0;

      // Seed the merkleDistributor with the root of the tree and additional information.

      const seedTxn = await merkleDistributor.setWindow(
        totalRewardAmount,
        rewardToken.address,
        merkleTree.getRoot(),
        sampleIpfsHash,
        {
          from: contractCreator
        }
      );

      // Check event logs.
      truffleAssert.eventEmitted(seedTxn, "CreatedWindow", ev => {
        return (
          ev.windowIndex.toString() === windowIndex.toString() &&
          ev.rewardsDeposited.toString() === totalRewardAmount.toString() &&
          ev.rewardToken === rewardToken.address &&
          ev.owner === contractCreator
        );
      });

      // Check on chain Window state:
      const windowState = await merkleDistributor.merkleWindows(windowIndex);

      assert.equal(windowState.merkleRoot, "0x" + merkleTree.getRoot().toString("hex"));
      assert.equal(windowState.rewardToken, rewardToken.address);
      assert.equal(windowState.ipfsHash, sampleIpfsHash);

      // Check that next created index has incremented.
      assert.equal((await merkleDistributor.nextCreatedIndex()).toString(), (windowIndex + 1).toString());

      // Claim for all accounts:
      for (let i = 0; i < rewardLeafs.length; i++) {
        leaf = rewardLeafs[i];
        claimerProof = merkleTree.getProof(leaf.leaf);
        const claimerBalanceBefore = await rewardToken.balanceOf(leaf.account);
        const contractBalanceBefore = await rewardToken.balanceOf(merkleDistributor.address);

        // Claim the rewards, providing the information needed to re-build the tree & verify the proof.
        // Note: Anyone can claim on behalf of anyone else.
        const claimTxn = await merkleDistributor.claim(
          {
            windowIndex: windowIndex,
            account: leaf.account,
            accountIndex: leaf.accountIndex,
            amount: leaf.amount,
            merkleProof: claimerProof
          },
          { from: contractCreator }
        );
        // Check event logs.
        truffleAssert.eventEmitted(claimTxn, "Claimed", ev => {
          return (
            ev.caller === contractCreator &&
            ev.account === leaf.account &&
            ev.accountIndex.toString() === leaf.accountIndex.toString() &&
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
        assert.isTrue(await merkleDistributor.isClaimed(windowIndex, leaf.accountIndex));
        assert(
          await didContractThrow(
            merkleDistributor.claim(
              { windowIndex: windowIndex, account: leaf.account, amount: leaf.amount, merkleProof: claimerProof },
              // Should fail for same account and window index, even if caller is another account.
              { from: rando }
            )
          )
        );
      }
    });
  });
  describe("Trivial 2 Leaf Tree", function() {
    describe("(claim)", function() {
      // For each test in the single window, load in the SampleMerklePayouts, generate a tree and set it in the distributor.
      beforeEach(async function() {
        // Window should be the first in the contract.
        windowIndex = 0;

        rewardRecipients = createRewardRecipientsFromSampleData(SamplePayouts);

        // Generate leafs for each recipient. This is simply the hash of each component of the payout from above.
        rewardLeafs = rewardRecipients.map(item => ({ ...item, leaf: createLeaf(item) }));
        merkleTree = new MerkleTree(rewardLeafs.map(item => item.leaf));

        // Seed the merkleDistributor with the root of the tree and additional information.
        await merkleDistributor.setWindow(
          SamplePayouts.totalRewardsDistributed,
          rewardToken.address,
          merkleTree.getRoot(),
          sampleIpfsHash
        );

        leaf = rewardLeafs[0];
        claimerProof = merkleTree.getProof(leaf.leaf);
      });
      it("Claim reverts when no rewards to transfer", async function() {
        // First withdraw rewards out of the contract.
        await merkleDistributor.withdrawRewards(rewardToken.address, SamplePayouts.totalRewardsDistributed, {
          from: contractCreator
        });
        // Claim should fail:
        assert(
          await didContractThrow(
            merkleDistributor.claim({
              windowIndex,
              account: leaf.account,
              accountIndex: leaf.accountIndex,
              amount: leaf.amount,
              merkleProof: claimerProof
            })
          )
        );
      });
      it("Cannot claim for invalid window index", async function() {
        assert(
          await didContractThrow(
            merkleDistributor.claim({
              windowIndex: windowIndex + 1,
              account: leaf.account,
              accountIndex: leaf.accountIndex,
              amount: leaf.amount,
              merkleProof: claimerProof
            })
          )
        );
      });
      it("gas", async function() {
        const claimTx = await merkleDistributor.claim(
          {
            windowIndex: windowIndex,
            account: leaf.account,
            accountIndex: leaf.accountIndex,
            amount: leaf.amount,
            merkleProof: claimerProof
          },
          { from: rando }
        );
        assertApproximate(87259, claimTx.receipt.gasUsed);
      });
      it("Can claim on another account's behalf", async function() {
        const claimerBalanceBefore = await rewardToken.balanceOf(leaf.account);
        const claimTx = await merkleDistributor.claim(
          {
            windowIndex: windowIndex,
            account: leaf.account,
            accountIndex: leaf.accountIndex,
            amount: leaf.amount,
            merkleProof: claimerProof
          },
          { from: rando }
        );
        assert.equal(
          (await rewardToken.balanceOf(leaf.account)).toString(),
          claimerBalanceBefore.add(toBN(leaf.amount)).toString()
        );

        truffleAssert.eventEmitted(claimTx, "Claimed", ev => {
          return (
            ev.caller.toLowerCase() === rando.toLowerCase() &&
            ev.account.toLowerCase() === leaf.account.toLowerCase() &&
            ev.accountIndex.toString() === leaf.accountIndex.toString() &&
            ev.windowIndex.toString() === windowIndex.toString() &&
            ev.amount.toString() === leaf.amount.toString() &&
            ev.rewardToken.toLowerCase() === rewardToken.address.toLowerCase()
          );
        });
      });
      it("Cannot double claim rewards", async function() {
        await merkleDistributor.claim({
          windowIndex: windowIndex,
          account: leaf.account,
          accountIndex: leaf.accountIndex,
          amount: leaf.amount,
          merkleProof: claimerProof
        });
        assert(
          await didContractThrow(
            merkleDistributor.claim({
              windowIndex: windowIndex,
              account: leaf.account,
              accountIndex: leaf.accountIndex,
              amount: leaf.amount,
              merkleProof: claimerProof
            })
          )
        );
      });
      it("Claim for one window does not affect other windows", async function() {
        // Create another duplicate Merkle root. `setWindowMerkleRoot` will dynamically
        // increment the index for this new root.
        rewardRecipients = createRewardRecipientsFromSampleData(SamplePayouts);
        let otherRewardLeafs = rewardRecipients.map(item => ({ ...item, leaf: createLeaf(item) }));
        let otherMerkleTree = new MerkleTree(rewardLeafs.map(item => item.leaf));
        await merkleDistributor.setWindow(
          SamplePayouts.totalRewardsDistributed,
          rewardToken.address,
          merkleTree.getRoot(),
          sampleIpfsHash
        );

        // Assumption: otherLeaf and leaf are claims for the same account.
        let otherLeaf = otherRewardLeafs[0];
        let otherClaimerProof = otherMerkleTree.getProof(leaf.leaf);
        const startingBalance = await rewardToken.balanceOf(otherLeaf.account);

        // Create a claim for original tree and show that it does not affect the claim for the same
        // proof for this tree. This effectively tests that the `claimed` mapping correctly
        // tracks claims across window indices.
        await merkleDistributor.claim({
          windowIndex: windowIndex,
          account: leaf.account,
          accountIndex: leaf.accountIndex,
          amount: leaf.amount,
          merkleProof: claimerProof
        });

        // Can claim for other window index.
        await merkleDistributor.claim({
          windowIndex: windowIndex + 1,
          account: otherLeaf.account,
          accountIndex: otherLeaf.accountIndex,
          amount: otherLeaf.amount,
          merkleProof: otherClaimerProof
        });

        // Balance should have increased by both claimed amounts:
        assert.equal(
          (await rewardToken.balanceOf(otherLeaf.account)).toString(),
          startingBalance.add(toBN(leaf.amount).add(toBN(otherLeaf.amount))).toString()
        );
      });
      it("invalid proof", async function() {
        // Reverts unless `claim` is valid.
        const isInvalidProof = async claim => {
          // 1) Claim should revert
          // 2) verifyClaim should return false
          await didContractThrow(merkleDistributor.claim(claim));
          assert.isFalse(await merkleDistributor.verifyClaim(claim));
        };
        // Incorrect account:
        await isInvalidProof({
          windowIndex: windowIndex,
          account: rando,
          accountIndex: leaf.accountIndex,
          amount: leaf.amount,
          merkleProof: claimerProof
        });

        // Incorrect amount:
        const invalidAmount = "1";
        await isInvalidProof({
          windowIndex: windowIndex,
          account: leaf.account,
          accountIndex: leaf.accountIndex,
          amount: invalidAmount,
          merkleProof: claimerProof
        });

        // Incorrect account index:
        const invalidAccountIndex = "99";
        await isInvalidProof({
          windowIndex: windowIndex,
          account: leaf.account,
          accountIndex: invalidAccountIndex,
          amount: leaf.amount,
          merkleProof: claimerProof
        });

        // Invalid merkle proof:
        const invalidProof = [padRight(utf8ToHex("0x"), 64)];
        await isInvalidProof({
          windowIndex: windowIndex,
          account: leaf.account,
          accountIndex: leaf.accountIndex,
          amount: leaf.amount,
          merkleProof: invalidProof
        });
      });
    });
    describe("(claimMulti)", function() {
      // 3 Total Trees to test multiple combinations of (1) receiver accounts and (2) reward currencies.
      let rewardRecipients;
      let rewardLeafs;
      let merkleTrees;
      let alternateRewardToken;
      let batchedClaims;
      let lastUsedWindowIndex;
      beforeEach(async function() {
        // Reset arrays between tests:
        batchedClaims = [];
        rewardLeafs = [];
        rewardRecipients = [];
        merkleTrees = [];
        lastUsedWindowIndex = 0;

        // First tree reward recipients are same as other tests
        rewardRecipients.push(createRewardRecipientsFromSampleData(SamplePayouts));

        // Second set of reward recipients gets double the rewards of first set. Note:
        // we make reward amounts different so that tester doesn't get a false positive
        // when accidentally re-using proofs between trees. I.e. a claim proof for leaf 1 tree 2
        // should never work for leaf 1 tree 1 or leaf 1 tree 3.
        rewardRecipients.push(
          rewardRecipients[0].map(recipient => {
            return {
              ...recipient,
              amount: toBN(recipient.amount)
                .muln(2)
                .toString()
            };
          })
        );

        // Third set of reward recipients has double the amount as second, and different currency.
        rewardRecipients.push(
          rewardRecipients[1].map(recipient => {
            return {
              ...recipient,
              amount: toBN(recipient.amount)
                .muln(2)
                .toString()
            };
          })
        );

        // Generate leafs for each recipient. This is simply the hash of each component of the payout from above.
        rewardRecipients.forEach(_rewardRecipients => {
          rewardLeafs.push(_rewardRecipients.map(item => ({ ...item, leaf: createLeaf(item) })));
        });
        rewardLeafs.forEach(_rewardLeafs => {
          merkleTrees.push(new MerkleTree(_rewardLeafs.map(item => item.leaf)));
        });

        // Seed the merkleDistributor with the root of the tree and additional information.
        await merkleDistributor.setWindow(
          SamplePayouts.totalRewardsDistributed,
          rewardToken.address,
          merkleTrees[0].getRoot(),
          sampleIpfsHash
        );
        await merkleDistributor.setWindow(
          String(Number(SamplePayouts.totalRewardsDistributed) * 2),
          rewardToken.address,
          merkleTrees[1].getRoot(),
          sampleIpfsHash
        );

        // Third Merkle tree uses different currency:
        alternateRewardToken = await Token.new("UMA KPI Options October 2021", "uKIP-OCT", 18, {
          from: contractCreator
        });
        await alternateRewardToken.addMember(1, contractCreator, { from: contractCreator });
        await alternateRewardToken.mint(contractCreator, MAX_UINT_VAL, { from: contractCreator });
        await alternateRewardToken.approve(merkleDistributor.address, MAX_UINT_VAL, { from: contractCreator });
        await merkleDistributor.setWindow(
          String(Number(SamplePayouts.totalRewardsDistributed) * 4),
          alternateRewardToken.address,
          merkleTrees[2].getRoot(),
          sampleIpfsHash
        );

        // Construct claims for all trees assuming that each tree index is equal to its window index.
        for (let i = 0; i < rewardLeafs.length; i++) {
          rewardLeafs[i].forEach(leaf => {
            batchedClaims.push({
              windowIndex: lastUsedWindowIndex + i,
              account: leaf.account,
              accountIndex: leaf.accountIndex,
              amount: leaf.amount,
              merkleProof: merkleTrees[i].getProof(leaf.leaf)
            });
          });
        }
      });
      it("Can make multiple claims in one transaction", async function() {
        // The same accounts make claims on all three trees, we will track their balances. This allows
        // us to query the recipients from the first window (index 0) to track all of the recipients.
        const allRecipients = rewardRecipients[0];
        const balancesRewardToken = [];
        const balancesAltRewardToken = [];
        for (let recipient of allRecipients) {
          const account = recipient.account;
          balancesRewardToken.push(await rewardToken.balanceOf(account));
          balancesAltRewardToken.push(await alternateRewardToken.balanceOf(account));
        }

        // Batch claim and check balances.
        await merkleDistributor.claimMulti(batchedClaims);
        for (let i = 0; i < allRecipients.length; i++) {
          // Trees 0 and 1 payout in rewardToken.
          const expectedPayoutRewardToken = toBN(rewardLeafs[0][i].amount).add(toBN(rewardLeafs[1][i].amount));
          // Trees 2 payout in altRewardToken
          const expectedPayoutAltRewardToken = toBN(rewardLeafs[2][i].amount);

          const account = allRecipients[i].account;
          assert.equal(
            balancesRewardToken[i].add(expectedPayoutRewardToken).toString(),
            (await rewardToken.balanceOf(account)).toString()
          );
          assert.equal(
            balancesAltRewardToken[i].add(expectedPayoutAltRewardToken).toString(),
            (await alternateRewardToken.balanceOf(account)).toString()
          );
        }

        // One Claimed event should have been emitted for each batched claim.
        const claimedEvents = await merkleDistributor.getPastEvents("Claimed");
        assert.equal(claimedEvents.length, allRecipients.length * 3);
      });
      it("gas", async function() {
        const txn = await merkleDistributor.claimMulti(batchedClaims);
        assertApproximate(
          37146,
          Math.floor(txn.receipt.gasUsed / (rewardLeafs.length * Object.keys(SamplePayouts.exampleRecipients).length))
        );
      });
      it("gas for making each claim individually", async function() {
        let totalGas = toBN(0);
        for (let claim of batchedClaims) {
          const txn = await merkleDistributor.claim(claim);
          totalGas = totalGas.addn(txn.receipt.gasUsed);
        }
        assertApproximate(
          65559,
          Math.floor(totalGas.divn(rewardLeafs.length * Object.keys(SamplePayouts.exampleRecipients).length).toNumber())
        );
      });
      it("Fails if any individual claim fails", async function() {
        // Push an invalid claim with an incorrect window index.
        batchedClaims.push({
          windowIndex: 9,
          account: rewardLeafs[0][0].account,
          accountIndex: rewardLeafs[0][0].accountIndex,
          amount: rewardLeafs[0][0].amount,
          merkleProof: merkleTrees[0].getProof(rewardLeafs[0][0].leaf)
        });
        assert(await didContractThrow(merkleDistributor.claimMulti(batchedClaims)));
      });
    });
  });
  describe("Real tree size", function() {
    // The following tests are based on Uniswap's tests to measure gas optimizations
    // stemming from bitmap claims tracking.

    // # of leaves in Merkle tree
    const NUM_LEAVES = 100000;
    // # of leaves we will claim and fetch gas costs for.
    const SAMPLE_SIZE = 25;
    let batchedClaims;
    const possibleRecipients = Object.keys(SamplePayouts.exampleRecipients);
    // Use same claim amount for each recipient since this won't affect gas.
    const claimData = { amount: 100 };
    const totalRewardsDistributed = claimData.amount * NUM_LEAVES;

    beforeEach(async function() {
      batchedClaims = [];
      windowIndex = 0;

      // Construct leaves and give each a unique accountIndex:
      rewardLeafs = [];
      for (let i = 0; i < NUM_LEAVES; i++) {
        // Claimant is one of the recipients in SampleJson. We use different recipients
        // to test how `claimMulti` performs when paying different accounts.
        const _claimAccount = possibleRecipients[i % possibleRecipients.length];
        const _claimData = { ...claimData, accountIndex: i, account: _claimAccount };
        rewardLeafs.push({
          ..._claimData,
          leaf: createLeaf(_claimData)
        });
      }
      merkleTree = new MerkleTree(rewardLeafs.map(item => item.leaf));

      // Seed the merkleDistributor with the root of the tree and additional information.
      await merkleDistributor.setWindow(
        totalRewardsDistributed,
        rewardToken.address,
        merkleTree.getRoot(),
        sampleIpfsHash
      );
    });
    describe("(claim)", function() {
      it("gas middle node", async function() {
        const leafIndex = 50000;
        const leaf = rewardLeafs[leafIndex];
        const proof = merkleTree.getProof(leaf.leaf);
        const tx = await merkleDistributor.claim({
          windowIndex: windowIndex,
          account: leaf.account,
          accountIndex: leaf.accountIndex,
          amount: leaf.amount,
          merkleProof: proof
        });
        assertApproximate(99220, tx.receipt.gasUsed);
      });
      it("gas deeper node", async function() {
        const leafIndex = 90000;
        const leaf = rewardLeafs[leafIndex];
        const proof = merkleTree.getProof(leaf.leaf);
        const tx = await merkleDistributor.claim({
          windowIndex: windowIndex,
          account: leaf.account,
          accountIndex: leaf.accountIndex,
          amount: leaf.amount,
          merkleProof: proof
        });
        assertApproximate(99222, tx.receipt.gasUsed);
      });
      it("gas average random distribution", async function() {
        let total = toBN(0);
        let count = 0;
        for (let i = 0; i < NUM_LEAVES; i += NUM_LEAVES / SAMPLE_SIZE) {
          const leaf = rewardLeafs[i];
          const proof = merkleTree.getProof(leaf.leaf);
          const tx = await merkleDistributor.claim({
            windowIndex: windowIndex,
            account: leaf.account,
            accountIndex: leaf.accountIndex,
            amount: leaf.amount,
            merkleProof: proof
          });
          total = total.addn(tx.receipt.gasUsed);
          count++;
        }
        const average = total.divn(count);
        assertApproximate(84832, Math.floor(average.toNumber()));
      });
      // Claiming consecutive leaves should result in average gas savings
      // because of using single bits in the bitmap to track claims instead
      // of bools.
      it("gas average first 25", async function() {
        let total = toBN(0);
        let count = 0;
        for (let i = 0; i < 25; i++) {
          const leaf = rewardLeafs[i];
          const proof = merkleTree.getProof(leaf.leaf);
          const tx = await merkleDistributor.claim({
            windowIndex: windowIndex,
            account: leaf.account,
            accountIndex: leaf.accountIndex,
            amount: leaf.amount,
            merkleProof: proof
          });
          total = total.addn(tx.receipt.gasUsed);
          count++;
        }
        const average = total.divn(count);
        assertApproximate(75069, Math.floor(average.toNumber()));
      });
      it("no double claims in random distribution", async () => {
        for (let i = 0; i < 25; i += Math.floor(Math.random() * (NUM_LEAVES / SAMPLE_SIZE))) {
          const leaf = rewardLeafs[i];
          const proof = merkleTree.getProof(leaf.leaf);
          await merkleDistributor.claim({
            windowIndex: windowIndex,
            account: leaf.account,
            accountIndex: leaf.accountIndex,
            amount: leaf.amount,
            merkleProof: proof
          });
          assert(
            await didContractThrow(
              merkleDistributor.claim({
                windowIndex: windowIndex,
                account: leaf.account,
                accountIndex: leaf.accountIndex,
                amount: leaf.amount,
                merkleProof: proof
              })
            )
          );
        }
      });
    });
    describe("(claimMulti)", function() {
      // Reorders the claimsArray array so that claims for the same
      // account and same token are next to each other.
      const sortClaimsByAccountAndToken = async claimsArray => {
        // Since .sort() comparison function must be synchrous, preload
        // all reward tokens into the claim data before sorting:
        return (
          await Promise.map(claimsArray, _claim => {
            // Returns window data for each claim:
            return merkleDistributor.merkleWindows(_claim.windowIndex);
          })
        )
          .map((windowData, i) => {
            // Gets the reward token for the window data for this claim
            // and injects it into the claim object.
            return {
              ...claimsArray[i],
              rewardToken: windowData.rewardToken
            };
          })
          .sort((a, b) => {
            // If a.account == b.account, then sorts by rewardToken
            return a.account.localeCompare(b.account) || a.rewardToken.localeCompare(b.rewardToken);
          });
      };

      it("one tree: gas amortized random distribution", async function() {
        for (let i = 0; i < NUM_LEAVES; i += NUM_LEAVES / SAMPLE_SIZE) {
          const leaf = rewardLeafs[i];
          const proof = merkleTree.getProof(leaf.leaf);
          batchedClaims.push({
            windowIndex: windowIndex,
            account: leaf.account,
            accountIndex: leaf.accountIndex,
            amount: leaf.amount,
            merkleProof: proof
          });
        }
        const sortedClaims = await sortClaimsByAccountAndToken(batchedClaims);
        const tx = await merkleDistributor.claimMulti(sortedClaims);
        assertApproximate(49866, Math.floor(tx.receipt.gasUsed / sortedClaims.length));
      });
      it("one tree: gas amortized first 25", async function() {
        for (let i = 0; i < 25; i++) {
          const leaf = rewardLeafs[i];
          const proof = merkleTree.getProof(leaf.leaf);
          batchedClaims.push({
            windowIndex: windowIndex,
            account: leaf.account,
            accountIndex: leaf.accountIndex,
            amount: leaf.amount,
            merkleProof: proof
          });
        }
        const sortedClaims = await sortClaimsByAccountAndToken(batchedClaims);
        const tx = await merkleDistributor.claimMulti(sortedClaims);
        assertApproximate(40381, Math.floor(tx.receipt.gasUsed / sortedClaims.length));
      });
      it("many trees, many reward tokens, many accounts: gas amortized", async function() {
        // This is a realistic scenario where the caller is making their claims for various
        // reward currencies across several windows.

        // Create new windows with different reward tokens. We'll cycle through a fixed
        // set of reward tokens, which means that consecutive windows will use different
        // reward tokens. This will test how the `claimMulti` handles unsorted versus
        // sorted claim arrays.
        const NUM_REWARD_TOKENS = 6;
        const rewardTokens = [];
        rewardTokens.push(rewardToken.address);
        // Note: we start index `i=1` because we've already created a merkle tree window.
        for (let i = 1; i < NUM_REWARD_TOKENS; i++) {
          const newRewardToken = await Token.new(`UMA KPI Option #${i}`, `uKPI${i}`, 18);
          await newRewardToken.addMember(1, contractCreator);
          await newRewardToken.mint(contractCreator, MAX_UINT_VAL);
          await newRewardToken.approve(merkleDistributor.address, MAX_UINT_VAL);
          rewardTokens.push(newRewardToken.address);
        }

        // Now create and upload new merkle trees to the distributor contract:
        const NUM_WINDOWS = 10;
        // Note: we start index `i=1` because we've already created a merkle tree window.
        for (let i = 1; i < NUM_WINDOWS; i++) {
          await merkleDistributor.setWindow(
            totalRewardsDistributed,
            rewardTokens[i % NUM_REWARD_TOKENS],
            merkleTree.getRoot(),
            sampleIpfsHash
            // Note re-use the same merkle tree since the claim amounts and recipients are the same
          );
        }

        // Construct batched claims across windows for the specified number of accounts.
        const ACCOUNT_INDICES_TO_CLAIM_FOR = [1, 2, 3];
        for (let i = 0; i < NUM_WINDOWS; i++) {
          ACCOUNT_INDICES_TO_CLAIM_FOR.forEach(accountIndex => {
            const leaf = rewardLeafs[accountIndex];
            const proof = merkleTree.getProof(leaf.leaf);
            batchedClaims.push({
              windowIndex: windowIndex + i,
              account: leaf.account,
              accountIndex: leaf.accountIndex,
              amount: leaf.amount,
              merkleProof: proof
            });
          });
        }

        // Check estimated gas for batch claiming unsorted array of claims:
        const gasUnsorted = await merkleDistributor.claimMulti.estimateGas(batchedClaims);
        assertApproximate(55883, Math.floor(gasUnsorted / batchedClaims.length));

        // Sort the claims such that windows with the same reward currency end up next to each other.
        const sortedClaims = await sortClaimsByAccountAndToken(batchedClaims);
        const tx = await merkleDistributor.claimMulti(sortedClaims);
        assertApproximate(53266, Math.floor(tx.receipt.gasUsed / sortedClaims.length));
      });
      it("batch cannot include double claims", async function() {
        for (let i = 0; i < NUM_LEAVES; i += NUM_LEAVES / SAMPLE_SIZE) {
          const leaf = rewardLeafs[i];
          const proof = merkleTree.getProof(leaf.leaf);
          batchedClaims.push({
            windowIndex: windowIndex,
            account: leaf.account,
            accountIndex: leaf.accountIndex,
            amount: leaf.amount,
            merkleProof: proof
          });
        }
        await merkleDistributor.claimMulti(batchedClaims);

        // Making batch claims that include ANY of the already executed claims will fail:
        for (let i = 0; i < batchedClaims.length; i++) {
          console.log(batchedClaims.slice(0, batchedClaims.length - i).length);
          assert(
            await didContractThrow(merkleDistributor.claimMulti(batchedClaims.slice(0, batchedClaims.length - i)))
          );
        }
      });
    });
  });
  describe("(setWindow)", function() {
    beforeEach(async function() {
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
            rewardToken.address,
            merkleTree.getRoot(),
            sampleIpfsHash,
            { from: rando }
          )
        )
      );
    });
    it("Owner's balance is transferred to contract", async function() {
      let ownerBalanceBefore = await rewardToken.balanceOf(contractCreator);

      await merkleDistributor.setWindow(
        SamplePayouts.totalRewardsDistributed,
        rewardToken.address,
        merkleTree.getRoot(),
        sampleIpfsHash,
        { from: contractCreator }
      );

      assert.equal(
        ownerBalanceBefore.sub(toBN(SamplePayouts.totalRewardsDistributed)).toString(),
        (await rewardToken.balanceOf(contractCreator)).toString()
      );
    });
    it("(nextCreatedIndex): starts at 0 and increments on each seed", async function() {
      assert.equal((await merkleDistributor.nextCreatedIndex()).toString(), "0");

      await merkleDistributor.setWindow(
        SamplePayouts.totalRewardsDistributed,
        rewardToken.address,
        merkleTree.getRoot(),
        sampleIpfsHash,
        { from: contractCreator }
      );

      assert.equal((await merkleDistributor.nextCreatedIndex()).toString(), "1");
    });
  });
  describe("Emergency admin functions", function() {
    beforeEach(async function() {
      // Assume we start at first windowIndex.
      windowIndex = 0;

      rewardRecipients = createRewardRecipientsFromSampleData(SamplePayouts);
      rewardLeafs = rewardRecipients.map(item => ({ ...item, leaf: createLeaf(item) }));

      merkleTree = new MerkleTree(rewardLeafs.map(item => item.leaf));

      await merkleDistributor.setWindow(
        SamplePayouts.totalRewardsDistributed,
        rewardToken.address,
        merkleTree.getRoot(),
        sampleIpfsHash
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
          return (
            ev.owner === contractCreator &&
            ev.amount.toString() === withdrawAmount &&
            ev.currency === rewardToken.address
          );
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
            merkleDistributor.claim({
              windowIndex: windowIndex,
              account: leaf.account,
              accountIndex: leaf.accountIndex,
              amount: leaf.amount,
              merkleProof: claimerProof
            })
          )
        );
      });
    });
  });
});

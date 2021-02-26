const { MerkleTree } = require("../../../merkle-distributor/src/merkleTree");

const SamplePayouts = require("./SamplePayout.json");
const truffleAssert = require("truffle-assertions");
const { toBN, toWei, utf8ToHex } = web3.utils;
const { MAX_UINT_VAL, didContractThrow } = require("@uma/common");

// Tested Contract
const MerkleDistributor = artifacts.require("MerkleDistributor");
const Timer = artifacts.require("Timer");
const Token = artifacts.require("ExpandedERC20");

let merkleDistributor, timer, rewardToken, rewardRecipients, merkleTree, rewardLeafs, leaf, claimerProof, windowIndex;

// For a recipient object, create the leaf to be part of the merkle tree. The leaf is simply a hash of the concatenation
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

contract("ExpiringMultiParty", function(accounts) {
  let contractCreator = accounts[0];
  let rando = accounts[1];

  beforeEach(async () => {
    timer = await Timer.deployed();
    merkleDistributor = await MerkleDistributor.new(timer.address);

    rewardToken = await Token.new("UMA KPI Options July 2021", "uKIP-JUL", 18, { from: contractCreator });
    await rewardToken.addMember(1, contractCreator, { from: contractCreator });
    await rewardToken.mint(contractCreator, toWei("10000000"), { from: contractCreator });
  });
  describe("Basic lifecycle", function() {
    it("Can create a simple tree, seed the distributor and claim rewards", async function() {
      const currentTime = await timer.getCurrentTime();
      const rewardAmount = toBN(toWei("100"));
      // Create a an array of reward recipients. Each object within the array represents the payout for one account. The
      // metaData is an arbitrary string that can be appended to each recipient to add additional information about the payouts.
      rewardRecipients = [
        { account: accounts[3], amount: rewardAmount.muln(1).toString() },
        { account: accounts[4], amount: rewardAmount.muln(2).toString() },
        { account: accounts[5], amount: rewardAmount.muln(3).toString() }
      ];

      // Generate leafs for each recipient. This is simply the hash of each component of the payout from above.
      rewardLeafs = rewardRecipients.map(item => ({ ...item, leaf: createLeaf(item) }));

      // Build the merkle tree from an array of hashes from each recipient.
      merkleTree = new MerkleTree(rewardLeafs.map(item => item.leaf));

      windowIndex = 0; // Using only 1 window.

      // Seed the merkleDistributor with the root of the tree and additional information.
      await rewardToken.approve(merkleDistributor.address, MAX_UINT_VAL, { from: contractCreator });
      await merkleDistributor.setWindowMerkleRoot(
        windowIndex,
        toWei("600"),
        currentTime,
        currentTime,
        rewardToken.address,
        merkleTree.getRoot()
      );

      // A member of the tree should now be able to claim rewards.
      leaf = rewardLeafs[0];
      const claimerBalanceBefore = await rewardToken.balanceOf(leaf.account);
      claimerProof = merkleTree.getProof(leaf.leaf);

      // Claim the rewards, providing the information needed to re-build the tree & verify the proof.
      await merkleDistributor.claimWindow(
        { windowIndex: windowIndex, account: leaf.account, amount: leaf.amount, merkleProof: claimerProof },
        { from: contractCreator }
      );
      // Their balance should have increased by the amount of the reward.
      assert.equal(
        (await rewardToken.balanceOf(leaf.account)).toString(),
        claimerBalanceBefore.add(toBN(leaf.amount)).toString()
      );
    });
  });
  describe("Single window with no vesting", function() {
    // For each test in the single window, load in the SampleMerlePayouts, generate a tree and set it in the distributor.
    beforeEach(async function() {
      windowIndex = 0;
      const currentTime = await timer.getCurrentTime();

      rewardRecipients = createRewardRecipientsFromSampleData(SamplePayouts);

      // Generate leafs for each recipient. This is simply the hash of each component of the payout from above.
      rewardLeafs = rewardRecipients.map(item => ({ ...item, leaf: createLeaf(item) }));
      merkleTree = new MerkleTree(rewardLeafs.map(item => item.leaf));

      // Seed the merkleDistributor with the root of the tree and additional information.
      await rewardToken.approve(merkleDistributor.address, MAX_UINT_VAL, { from: contractCreator });
      await merkleDistributor.setWindowMerkleRoot(
        windowIndex,
        SamplePayouts.totalRewardsDistributed,
        currentTime,
        currentTime,
        rewardToken.address,
        merkleTree.getRoot()
      );

      leaf = rewardLeafs[0];
      claimerProof = merkleTree.getProof(leaf.leaf);
    });
    it("Can claim rewards on another EOA's behalf", async function() {
      // Can correctly claim on the EOAs behalf.
      const claimerBalanceBefore = await rewardToken.balanceOf(leaf.account);
      const claimTx = await merkleDistributor.claimWindow(
        { windowIndex: windowIndex, account: leaf.account, amount: leaf.amount, merkleProof: claimerProof },
        { from: rando }
      );
      // The EOA balance should have increased by the amount of the reward.
      assert.equal(
        (await rewardToken.balanceOf(leaf.account)).toString(),
        claimerBalanceBefore.add(toBN(leaf.amount)).toString()
      );

      truffleAssert.eventEmitted(claimTx, "Claimed", ev => {
        return (
          ev.caller.toLowerCase() == rando.toLowerCase() &&
          ev.windowIndex == windowIndex.toString() &&
          ev.account.toLowerCase() == leaf.account.toLowerCase() &&
          ev.totalClaimAmount.toString() == leaf.amount.toString() &&
          ev.amountVestedNetPreviousClaims.toString() == leaf.amount.toString() &&
          ev.claimAmountRemaining.toString() == "0" &&
          ev.rewardToken.toLowerCase() == rewardToken.address.toLowerCase()
        );
      });
    });
    it("Can not double claim rewards", async function() {
      // Claim rewards for the EOA.
      await merkleDistributor.claimWindow(
        { windowIndex: windowIndex, account: leaf.account, amount: leaf.amount, merkleProof: claimerProof },
        { from: rando }
      );
      // Can not re-claim rewards for the EOA.
      assert(
        await didContractThrow(
          merkleDistributor.claimWindow(
            { windowIndex: windowIndex, account: leaf.account, amount: leaf.amount, merkleProof: claimerProof },
            { from: rando }
          )
        )
      );
    });
    it("Can not claim rewards if not part of the tree", async function() {
      // Can not claim the recipient rewards as your own. Set the account in the claim component to `rando`, using
      // the rest of the valid proof.
      assert(
        await didContractThrow(
          merkleDistributor.claimWindow(
            { windowIndex: windowIndex, account: rando, amount: leaf.amount, merkleProof: claimerProof },
            { from: rando }
          )
        )
      );
    });
    it("Can not claim rewards with invalid data", async function() {
      assert(
        await didContractThrow(
          merkleDistributor.claimWindow(
            { windowIndex: windowIndex, account: leaf.account, amount: toWei("1000000"), merkleProof: claimerProof },
            { from: rando }
          )
        )
      );
    });
    it("Can not claim rewards with invalid proof", async function() {
      const invalidProof = [utf8ToHex("0x")];
      assert(
        await didContractThrow(
          merkleDistributor.claimWindow(
            { windowIndex: windowIndex, account: leaf.account, amount: leaf.amount, merkleProof: invalidProof },
            { from: rando }
          )
        )
      );
    });
  });

  describe("Vesting over a window", function() {
    let vestingStartTime, vestingEndTime;
    beforeEach(async function() {
      windowIndex = 0;
      const currentTime = await timer.getCurrentTime();

      rewardRecipients = createRewardRecipientsFromSampleData(SamplePayouts);

      // Generate leafs for each recipient. This is simply the hash of each component of the payout from above.
      rewardLeafs = rewardRecipients.map(item => ({ ...item, leaf: createLeaf(item) }));
      merkleTree = new MerkleTree(rewardLeafs.map(item => item.leaf));

      // set the start time to 100 seconds into the future and the end time to 200 seconds in the future.
      vestingStartTime = currentTime.addn(100);
      vestingEndTime = currentTime.addn(200);

      await rewardToken.approve(merkleDistributor.address, MAX_UINT_VAL, {
        from: contractCreator
      });

      // Seed the merkleDistributor with the root of the tree and additional information.
      await merkleDistributor.setWindowMerkleRoot(
        windowIndex,
        SamplePayouts.totalRewardsDistributed,
        vestingStartTime,
        vestingEndTime,
        rewardToken.address,
        merkleTree.getRoot()
      );

      leaf = rewardLeafs[0];
      claimerProof = merkleTree.getProof(leaf.leaf);
    });
    it("Can not claim if before vesting starts", async function() {
      // the current time should be before the start of the window.
      assert.isTrue((await timer.getCurrentTime()).lt((await merkleDistributor.merkleWindows(0)).start));

      // claiming should revert as nothing has vested yet.
      assert(
        await didContractThrow(
          merkleDistributor.claimWindow(
            { windowIndex: windowIndex, account: leaf.account, amount: leaf.amount, merkleProof: claimerProof },
            { from: rando }
          )
        )
      );
    });
    it("Can claim correct number of rewards mid vesting", async function() {
      // The contract will vest rewards linearly over the vesting window. If we are 10 seconds into the vesting window
      // then we should get 10% of the rewards vested.
      const claimerBalanceBefore = await rewardToken.balanceOf(leaf.account);

      await timer.setCurrentTime(vestingStartTime.addn(10));
      const claimTx1 = await merkleDistributor.claimWindow(
        { windowIndex: windowIndex, account: leaf.account, amount: leaf.amount, merkleProof: claimerProof },
        { from: rando }
      );
      // The EOA balance should have increased by the 10% of the original reward amount.
      assert.equal(
        (await rewardToken.balanceOf(leaf.account)).toString(),
        claimerBalanceBefore
          .add(
            toBN(leaf.amount)
              .muln(10)
              .divn(100)
          )
          .toString()
      );

      truffleAssert.eventEmitted(claimTx1, "Claimed", ev => {
        return (
          ev.caller.toLowerCase() == rando.toLowerCase() &&
          ev.windowIndex == windowIndex.toString() &&
          ev.account.toLowerCase() == leaf.account.toLowerCase() &&
          ev.totalClaimAmount.toString() == toWei("1") &&
          ev.amountVestedNetPreviousClaims.toString() == toWei("0.1") &&
          ev.claimAmountRemaining.toString() == toWei("0.9") &&
          ev.rewardToken.toLowerCase() == rewardToken.address.toLowerCase()
        );
      });

      // No additional tokens should be release without more time traversed through vesting. Claim call should revert.
      assert(
        await didContractThrow(
          merkleDistributor.claimWindow(
            { windowIndex: windowIndex, account: leaf.account, amount: leaf.amount, merkleProof: claimerProof },
            { from: rando }
          )
        )
      );

      // Advance half way though the window and claim the vested tokens again.
      await timer.setCurrentTime(vestingStartTime.addn(50));
      const claimTx2 = await merkleDistributor.claimWindow(
        { windowIndex: windowIndex, account: leaf.account, amount: leaf.amount, merkleProof: claimerProof },
        { from: rando }
      );

      // The EOA balance should have increased by the amount of the rewards vested, equal to 50% of the claim reward.
      assert.equal(
        (await rewardToken.balanceOf(leaf.account)).toString(),
        claimerBalanceBefore
          .add(
            toBN(leaf.amount)
              .muln(50)
              .divn(100)
          )
          .toString()
      );

      truffleAssert.eventEmitted(claimTx2, "Claimed", ev => {
        return (
          ev.caller.toLowerCase() == rando.toLowerCase() &&
          ev.windowIndex == windowIndex.toString() &&
          ev.account.toLowerCase() == leaf.account.toLowerCase() &&
          ev.totalClaimAmount.toString() == toWei("1") && // Total of 1
          ev.amountVestedNetPreviousClaims.toString() == toWei("0.4") && // total of 0.5 vested up to now, with 0.1 already claimed.
          ev.claimAmountRemaining.toString() == toWei("0.5") && // 0.5 left still to claim.
          ev.rewardToken.toLowerCase() == rewardToken.address.toLowerCase()
        );
      });
    });
    it("Can claim all rewards post vesting", async function() {
      // Advance time to after the vesting window. Should be able to claim all rewards.
      const claimerBalanceBefore = await rewardToken.balanceOf(leaf.account);

      await timer.setCurrentTime(vestingStartTime.addn(110)); // window is 100 seconds long. 110 is after the end.
      const claimTx = await merkleDistributor.claimWindow(
        {
          windowIndex: windowIndex,
          account: leaf.account,
          amount: leaf.amount,
          merkleProof: claimerProof
        },
        { from: rando }
      );
      // The EOA balance should have increased by the full amount of the claim.
      assert.equal(
        (await rewardToken.balanceOf(leaf.account)).toString(),
        claimerBalanceBefore.add(toBN(leaf.amount)).toString()
      );

      truffleAssert.eventEmitted(claimTx, "Claimed", ev => {
        return (
          ev.caller.toLowerCase() == rando.toLowerCase() &&
          ev.windowIndex == windowIndex.toString() &&
          ev.account.toLowerCase() == leaf.account.toLowerCase() &&
          ev.totalClaimAmount.toString() == toWei("1") &&
          ev.amountVestedNetPreviousClaims.toString() == toWei("1") &&
          ev.claimAmountRemaining.toString() == toWei("0") &&
          ev.rewardToken.toLowerCase() == rewardToken.address.toLowerCase()
        );
      });

      // No additional tokens should be release post claim. Claim call should revert.
      assert(
        await didContractThrow(
          merkleDistributor.claimWindow(
            {
              windowIndex: windowIndex,
              account: leaf.account,
              amount: leaf.amount,
              merkleProof: claimerProof
            },
            { from: rando }
          )
        )
      );
    });
  });
  describe("Multiple window", function() {
    let rewardRecipients1, rewardRecipients2;
    let rewardLeafs1, rewardLeafs2;
    let merkleTree1, merkleTree2;
    let vesting1StartTime, vesting2StartTime, vesting1EndTime, vesting2EndTime;
    beforeEach(async function() {
      const currentTime = await timer.getCurrentTime();

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

      // set the start time to 100 seconds into the future and the end time to 200 seconds in the future.
      vesting1StartTime = currentTime.addn(100);
      vesting1EndTime = currentTime.addn(200);

      vesting2StartTime = currentTime.addn(250);
      vesting2EndTime = currentTime.addn(350);

      await rewardToken.approve(merkleDistributor.address, MAX_UINT_VAL, {
        from: contractCreator
      });
      // Seed the merkleDistributor with the root of the tree and additional information.
      await merkleDistributor.setWindowMerkleRoot(
        "0",
        SamplePayouts.totalRewardsDistributed,
        vesting1StartTime,
        vesting1EndTime,
        rewardToken.address,
        merkleTree1.getRoot()
      );

      await merkleDistributor.setWindowMerkleRoot(
        "1",
        SamplePayouts.totalRewardsDistributed,
        vesting2StartTime,
        vesting2EndTime,
        rewardToken.address,
        merkleTree2.getRoot()
      );
    });
    it("Can claim from multiple windows if one window has incomplete vesting", async function() {});
    it("Can claim from multiple windows in one transaction", async function() {
      await timer.setCurrentTime(vesting2EndTime.addn(10)); // Move time to past the end of the second vesting window.
      // try and claim all rewards at the same time for the 0th wallet.
      const leaf1 = rewardLeafs1[0];
      const leaf2 = rewardLeafs2[0];

      const accountBalanceBefore = await rewardToken.balanceOf(leaf1.account);
      await merkleDistributor.claimWindows(
        [
          {
            windowIndex: "0",
            account: leaf1.account,
            amount: leaf1.amount,
            merkleProof: merkleTree1.getProof(leaf1.leaf)
          },
          {
            windowIndex: "1",
            account: leaf2.account,
            amount: leaf2.amount,
            merkleProof: merkleTree2.getProof(leaf2.leaf)
          }
        ],
        { from: rando }
      );

      assert.equal(
        (await rewardToken.balanceOf(leaf1.account)).toString(),
        accountBalanceBefore
          .add(toBN(leaf1.amount))
          .add(toBN(leaf2.amount))
          .toString()
      );
    });
    it("Can not re-use window index", async function() {});
    it("can not claim from invalid window", async function() {});
    it("Can claim from multiple accounts in one transaction", async function() {});
  });

  describe("Admin functionality", function() {
    beforeEach(async function() {});
    it("Owner can pause distribution of a specific window", async function() {});
    it("Owner can update merkle root", async function() {});
    it("Owner can drain tokens", async function() {});
  });
});

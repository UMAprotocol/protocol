const { MerkleTree } = require("../../../merkle-distributor/src/merkleTree");

const { toBN, toWei } = web3.utils;
const { MAX_UINT_VAL } = require("@uma/common");

// Tested Contract
const MerkleDistributor = artifacts.require("MerkleDistributor");
const Timer = artifacts.require("Timer");
const Token = artifacts.require("ExpandedERC20");

contract("ExpiringMultiParty", function(accounts) {
  let contractCreator = accounts[0];
  let merkleDistributor, timer, rewardToken;

  beforeEach(async () => {
    timer = await Timer.deployed();
    merkleDistributor = await MerkleDistributor.new(timer.address);

    rewardToken = await Token.new("UMA KPI Options July 2021", "uKIP-JUL", 18, { from: contractCreator });
    await rewardToken.addMember(1, contractCreator, { from: contractCreator });
    await rewardToken.mint(contractCreator, toWei("10000000"), { from: contractCreator });
  });

  it("Basic claiming lifecycle", async function() {
    const currentTime = await timer.getCurrentTime();
    const rewardAmount = toBN(toWei("100"));
    // Create a an array of reward recipients. Each object within the array represents the payout for one account. The
    // metaData is an arbitrary string that can be appended to each recipient to add additional information about the payouts.

    let rewardRecipients = [
      {
        account: accounts[3],
        amount: rewardAmount.muln(1).toString(),
        metaData: "Liquidity mining, Developer mining, UMA governance"
      },
      {
        account: accounts[4],
        amount: rewardAmount.muln(2).toString(),
        metaData: "Liquidity mining, Developer mining"
      },
      {
        account: accounts[5],
        amount: rewardAmount.muln(3).toString(),
        metaData: "Liquidity mining"
      }
    ];

    const windowIndex = 0; // Each window has a unique index
    // In this example, each recipient will have their rewards vest instantly once. Each recipient will get the `amount`
    // of `rewardToken` when claiming their rewards.
    const commonFields = {
      windowIndex,
      rewardToken: rewardToken.address,
      windowStart: currentTime,
      windowEnd: currentTime
    };

    // Append the commonFields to each rewardRecipient
    rewardRecipients = rewardRecipients.map((r, index) => {
      return { ...rewardRecipients[index], ...commonFields };
    });

    // Generate leafs for each recipient. This is simply the hash of each component of the payout from above.
    const rewardLeafs = rewardRecipients.map(item => ({
      ...item,
      leaf: web3.utils.soliditySha3(
        { t: "uint256", v: item.windowIndex },
        { t: "address", v: item.account },
        { t: "uint256", v: item.amount },
        { t: "string", v: item.metaData },
        { t: "address", v: item.rewardToken },
        { t: "uint256", v: item.windowStart },
        { t: "uint256", v: item.windowEnd }
      )
    }));

    // Build the merkle tree from an array of hashes from each recipient.
    const vestingMerkleTree = new MerkleTree(rewardLeafs.map(item => item.leaf));

    // Seed the merkleDistributor with the root of the tree and additional information.
    await rewardToken.approve(merkleDistributor.address, MAX_UINT_VAL);
    await merkleDistributor.setWindowMerkleRoot(
      windowIndex,
      toWei("1000"),
      currentTime,
      currentTime,
      rewardToken.address,
      vestingMerkleTree.getRoot()
    );

    // A member of the tree should now be able to claim rewards.
    const leaf = rewardLeafs[0];
    const claimerBalanceBefore = await rewardToken.balanceOf(leaf.account);
    const claimerProof = vestingMerkleTree.getProof(leaf.leaf);

    // Claim the rewards, providing the information needed to re-build the tree & verify the proof.
    await merkleDistributor.claimWindow(leaf.windowIndex, leaf.account, leaf.amount, leaf.metaData, claimerProof);
    // Their balance should have increased by the amount of the reward.
    assert.equal(
      (await rewardToken.balanceOf(leaf.account)).toString(),
      claimerBalanceBefore.add(toBN(leaf.amount)).toString()
    );
  });
});

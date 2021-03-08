// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Inspired by:
 * - https://github.com/pie-dao/vested-token-migration-app
 * - https://github.com/Uniswap/merkle-distributor
 * - https://github.com/balancer-labs/erc20-redeemable
 *
 * @title MerkleDistributor contract.
 * @notice Allows an owner to distribute any reward ERC20 to claimants according to Merkle roots. The owner can specify
 *         multiple Merkle roots distributions with customized reward currencies.
 */

pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MerkleDistributor is Ownable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    // A Window maps a Merkle root to a reward token address.
    struct Window {
        // Merkle root describing the distribution.
        bytes32 merkleRoot;
        // Currency in which reward is processed.
        IERC20 rewardToken;
    }

    // Represents an account's claim for `amount` within the Merkle root located at the `windowIndex`.
    struct Claim {
        uint256 windowIndex;
        uint256 amount;
        uint256 accountIndex; // Used only for bitmap. Assumed to be unique for each claim.
        address account;
        bytes32[] merkleProof;
    }

    // Windows are mapped to arbitrary indices.
    mapping(uint256 => Window) public merkleWindows;

    // Track which accounts have claimed for each window index.
    // Note: uses a packed array of bools for gas optimization on tracking certain claims.
    //       Copied from Uniswap's contract.
    mapping(uint256 => mapping(uint256 => uint256)) private claimedBitMap;

    // Index of last created Merkle root. Next allocation to begin at `lastCreatedIndex + 1`.
    uint256 public lastCreatedIndex;

    // Events:
    event Claimed(
        address indexed caller,
        uint256 windowIndex,
        address indexed account,
        uint256 accountIndex,
        uint256 amount,
        address indexed rewardToken
    );
    event CreatedWindow(uint256 indexed windowIndex, uint256 amount, address indexed rewardToken, address owner);
    event WithdrawRewards(address indexed owner, uint256 amount);
    event DeleteWindow(uint256 indexed windowIndex, address owner);

    /****************************
     *
     * Admin functions
     *
     ****************************/

    // Set merkle root for the next available window index and seed allocations. Callable by owner of this
    // contract. Importantly, we assume that the owner of this contract
    // correctly chooses an amount `totalRewardsDistributed` that is sufficient
    // to cover all claims within the `merkleRoot`. Otherwise, a race condition
    // can be created. This situation can occur because we do not segregate reward balances by window,
    // for code simplicity purposes.
    //
    // Example race situation:
    //     - Window 1 Tree: Owner sets `totalRewardsDistributed=100` and insert proofs that give
    //                      claimant A 50 tokens and claimant B 51 tokens. The owner has made an error
    //                      by not setting the `totalRewardsDistributed` correctly to 101).
    //     - Window 2 Tree: Owner sets `totalRewardsDistributed=1` and insert proofs that give
    //                      claimant A 1 token. The owner correctly set `totalRewardsDistributed` this time.
    //     - At this point contract owns 100 + 1 = 101 tokens. Now, imagine the following sequence:
    //       (1) Claimant A claims 50 tokens for Window 1, contract now has 101 - 50 = 51 tokens.
    //       (2) Claimant B claims 51 tokens for Window 1, contract now has 51 - 51 = 0 tokens.
    //       (3) Claimant A tries to claim 1 token for Window 2 but fails because contract has 0 tokens.
    //     - In summary, the contract owner created a race for step(2) and step(3) in which the first
    //       claim would succeed and the second claim would fail, even though both claimants would expect
    //       their claims to suceed.
    function setWindow(
        uint256 totalRewardsDistributed,
        address rewardToken,
        bytes32 merkleRoot
    ) external onlyOwner {
        uint256 indexToSet = lastCreatedIndex;
        lastCreatedIndex = indexToSet.add(1);

        _setWindow(indexToSet, totalRewardsDistributed, rewardToken, merkleRoot);
    }

    // Delete merkle root at window index. Likely to be followed by a withdrawRewards call to clear contract state.
    function deleteWindow(uint256 windowIndex) external onlyOwner {
        delete merkleWindows[windowIndex];
        emit DeleteWindow(windowIndex, msg.sender);
    }

    // Emergency method used to transfer rewards out of the contract
    // incase the contract was configured improperly.
    function withdrawRewards(address rewardCurrency, uint256 amount) external onlyOwner {
        IERC20(rewardCurrency).safeTransfer(msg.sender, amount);
        emit WithdrawRewards(msg.sender, amount);
    }

    /****************************
     *
     * Public functions
     *
     ****************************/

    // Batch claims for a reward currency for an account to save gas. We only allow
    // batching the same reward token and the same account because this allows us to effect
    // the most gas optimizations for the user by precomputing the total amount of the
    // chosen reward currency to send to the user in a single transfer transaction.
    // If we allowed multiple accounts or multiple reward currencies,
    // then this function would still reduce to multiple ERC20.transfer calls.
    function claimMulti(
        Claim[] memory claims,
        address rewardToken,
        address account
    ) public {
        uint256 amountToClaim = 0;
        for (uint256 i = 0; i < claims.length; i++) {
            Claim memory claim = claims[i];
            require(claim.account == account, "Invalid account in batch claim");
            address _rewardToken = address(merkleWindows[claim.windowIndex].rewardToken);
            require(_rewardToken == rewardToken, "Invalid rewardToken in batch claim");
            _verifyAndMarkClaimed(claim);
            amountToClaim = amountToClaim.add(claim.amount);
        }
        IERC20(rewardToken).safeTransfer(account, amountToClaim);
    }

    // Claim `amount` of reward tokens for `account`. If `amount` and `account` do not exactly match the values stored
    // in the merkle proof for this `windowIndex` this method will revert.
    function claim(Claim memory claim) public {
        _verifyAndMarkClaimed(claim);
        merkleWindows[claim.windowIndex].rewardToken.safeTransfer(claim.account, claim.amount);
    }

    // Returns True if the claim for `accountIndex` has already been completed for the Merkle
    // root at `windowIndex`.
    function isClaimed(uint256 windowIndex, uint256 accountIndex) public view returns (bool) {
        uint256 claimedWordIndex = accountIndex / 256;
        uint256 claimedBitIndex = accountIndex % 256;
        uint256 claimedWord = claimedBitMap[windowIndex][claimedWordIndex];
        uint256 mask = (1 << claimedBitIndex);
        return claimedWord & mask == mask;
    }

    // Checks {account, amount} against Merkle root at given window index.
    function verifyClaim(Claim memory claim) public view returns (bool valid) {
        bytes32 leaf = keccak256(abi.encodePacked(claim.account, claim.amount, claim.accountIndex));
        return MerkleProof.verify(claim.merkleProof, merkleWindows[claim.windowIndex].merkleRoot, leaf);
    }

    /****************************
     *
     * Internal functions
     *
     ****************************/

    // Mark claim as completed for `accountIndex` for Merkle root at `windowIndex`.
    function _setClaimed(uint256 windowIndex, uint256 accountIndex) private {
        uint256 claimedWordIndex = accountIndex / 256;
        uint256 claimedBitIndex = accountIndex % 256;
        claimedBitMap[windowIndex][claimedWordIndex] =
            claimedBitMap[windowIndex][claimedWordIndex] |
            (1 << claimedBitIndex);
    }

    // Store new Merkle root at `windowindex`. Pull `totalRewardsDistributed` from caller
    // to seed distribution for this root.
    function _setWindow(
        uint256 windowIndex,
        uint256 totalRewardsDistributed,
        address rewardToken,
        bytes32 merkleRoot
    ) private {
        Window storage window = merkleWindows[windowIndex];
        window.merkleRoot = merkleRoot;
        window.rewardToken = IERC20(rewardToken);

        window.rewardToken.safeTransferFrom(msg.sender, address(this), totalRewardsDistributed);

        emit CreatedWindow(windowIndex, totalRewardsDistributed, rewardToken, msg.sender);
    }

    // Verify claim is valid and mark it as completed in this contract.
    function _verifyAndMarkClaimed(Claim memory claim) private {
        // Check claimed proof against merkle window at given index.
        require(verifyClaim(claim), "Incorrect merkle proof");
        // Check the account has not yet claimed for this window.
        require(!isClaimed(claim.windowIndex, claim.accountIndex), "Account has already claimed for this window");

        // Proof is correct and claim has not occurred yet, mark claimed complete.
        _setClaimed(claim.windowIndex, claim.accountIndex);
        emit Claimed(
            msg.sender,
            claim.windowIndex,
            claim.account,
            claim.accountIndex,
            claim.amount,
            address(merkleWindows[claim.windowIndex].rewardToken)
        );
    }
}

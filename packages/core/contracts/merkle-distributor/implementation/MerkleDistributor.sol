// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Inspired by:
 * - https://github.com/pie-dao/vested-token-migration-app
 * - https://github.com/Uniswap/merkle-distributor
 * - https://github.com/balancer-labs/erc20-redeemable
 *
 * @title MerkleDistributor contract.
 * @notice Allows an owner to distribute any reward ERC20 to claimants according to Merkle roots. The owner can specify
 *         multiple Merkle roots distributions, each of which has its own start time constraining when claims can be
 *         executed.
 */

pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../common/implementation/Lockable.sol";
import "../../common/implementation/Testable.sol";

contract MerkleDistributor is Ownable, Lockable, Testable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    // A Window maps a Merkle root to a reward token address and a claim window.
    // Claims for this window cannot take place before start time.
    struct Window {
        // Claims for this window can begin after `start`.
        uint256 start;
        // Merkle root describing the distribution.
        bytes32 merkleRoot;
        // Currency in which reward is processed.
        IERC20 rewardToken;
    }

    // Represents an account's claim for `amount` within the Merkle root located at the `windowIndex`.
    struct Claim {
        uint256 windowIndex;
        uint256 amount;
        address account;
        bytes32[] merkleProof;
    }

    // Windows are mapped to arbitrary indices.
    mapping(uint256 => Window) public merkleWindows;

    // Track which accounts have claimed for each window index.
    // TODO: Should we replace this mapping with a bitmap for each window? Upside is cheaper `claim` transactions,
    // downside is having to include an `accountIndex` in the merkle leaf.
    mapping(uint256 => mapping(address => bool)) public claimed;

    // Index of last seeded root. Next allocation to begin at `lastSeededIndex + 1`.
    uint256 public lastSeededIndex;

    // Events:
    event Claimed(
        address indexed caller,
        uint256 windowIndex,
        address indexed account,
        uint256 amount,
        address indexed rewardToken
    );
    event SeededWindow(
        uint256 indexed windowIndex,
        uint256 amount,
        uint256 indexed windowStart,
        address indexed rewardToken,
        address owner
    );
    event WithdrawRewards(address indexed owner, uint256 amount);
    event DestroyWindow(uint256 indexed windowIndex, address owner);

    constructor(address _timerAddress) public Testable(_timerAddress) {}

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
    function setWindowMerkleRoot(
        uint256 totalRewardsDistributed,
        uint256 windowStart,
        address rewardToken,
        bytes32 merkleRoot
    ) external nonReentrant() onlyOwner {
        uint256 indexToSeed = lastSeededIndex;
        lastSeededIndex = indexToSeed.add(1);

        _seedWindow(indexToSeed, totalRewardsDistributed, windowStart, rewardToken, merkleRoot);
    }

    // Delete merkle root at window index. Likely to be followed by a withdrawRewards call to clear contract state.
    function destroyMerkleRoot(uint256 windowIndex) external nonReentrant() onlyOwner {
        delete merkleWindows[windowIndex];
        emit DestroyWindow(windowIndex, msg.sender);
    }

    // Emergency method used to transfer rewards out of the contract
    // incase the contract was configured improperly.
    function withdrawRewards(address rewardCurrency, uint256 amount) external nonReentrant() onlyOwner {
        IERC20(rewardCurrency).safeTransfer(msg.sender, amount);
        emit WithdrawRewards(msg.sender, amount);
    }

    /****************************
     *
     * Public functions
     *
     ****************************/

    // Batch claims for a reward currency for an account to save gas.
    function claimWindows(
        Claim[] memory claims,
        address rewardToken,
        address account
    ) public nonReentrant() {
        uint256 amountToClaim = 0;
        for (uint256 i = 0; i < claims.length; i++) {
            Claim memory claim = claims[i];
            require(claim.account == account, "Invalid account in batch claim");
            _markClaimed(claim);
            amountToClaim = amountToClaim.add(claim.amount);
        }
        _disburse(IERC20(rewardToken), account, amountToClaim);
    }

    // Claim `amount` of reward tokens for `account`. If `amount` and `account` do not exactly match the values stored
    // in the merkle proof for this `windowIndex` this method will revert.
    function claimWindow(Claim memory claim) public nonReentrant() {
        _markClaimed(claim);
        _disburse(merkleWindows[claim.windowIndex].rewardToken, claim.account, claim.amount);
    }

    /****************************
     *
     * Internal functions
     *
     ****************************/

    function _seedWindow(
        uint256 windowIndex,
        uint256 totalRewardsDistributed,
        uint256 windowStart,
        address rewardToken,
        bytes32 merkleRoot
    ) private {
        Window storage window = merkleWindows[windowIndex];
        window.start = windowStart;
        window.merkleRoot = merkleRoot;
        window.rewardToken = IERC20(rewardToken);

        window.rewardToken.safeTransferFrom(msg.sender, address(this), totalRewardsDistributed);

        emit SeededWindow(windowIndex, totalRewardsDistributed, windowStart, rewardToken, msg.sender);
    }

    function _markClaimed(Claim memory claim) private {
        // Check claimed proof against merkle window at given index.
        require(_verifyClaim(claim), "Incorrect merkle proof");
        // Check the account has not yet claimed for this window.
        require(!claimed[claim.windowIndex][claim.account], "Account has already claimed for this window");

        // Proof is correct and claim has not occurred yet; check that claim window has begun.
        require(getCurrentTime() >= merkleWindows[claim.windowIndex].start, "Claim window has not begin");

        claimed[claim.windowIndex][claim.account] = true;
        emit Claimed(
            msg.sender,
            claim.windowIndex,
            claim.account,
            claim.amount,
            address(merkleWindows[claim.windowIndex].rewardToken)
        );
    }

    function _disburse(
        IERC20 token,
        address account,
        uint256 amount
    ) private {
        // TODO: Should we revert claims for 0 tokens?
        if (amount > 0) {
            token.safeTransfer(account, amount);
        }
    }

    // Checks {account, amount} against Merkle root at given window index.
    function _verifyClaim(Claim memory claim) private view returns (bool valid) {
        bytes32 leaf = keccak256(abi.encodePacked(claim.account, claim.amount));
        return MerkleProof.verify(claim.merkleProof, merkleWindows[claim.windowIndex].merkleRoot, leaf);
    }
}

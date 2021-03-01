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
        // Total amount of rewards distributed this window. This is not enforced
        // but might be useful to query.
        uint256 totalRewardsDistributed;
        // Owner can set this to true to block claims for this window.
        bool locked;
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
    event Claimed(address indexed caller, address indexed account, uint256 amount, address indexed rewardToken);
    event SeededWindow(
        uint256 indexed windowIndex,
        uint256 amount,
        uint256 indexed windowStart,
        address indexed rewardToken,
        address owner
    );
    event DepositRewards(address indexed owner, uint256 amount);
    event WithdrawRewards(address indexed owner, uint256 amount);
    event SetWindowLock(address indexed owner, uint256 indexed windowIndex, bool locked);

    modifier windowNotLocked(uint256 windowIndex) {
        require(!merkleWindows[windowIndex].locked, "Window distributions locked");
        _;
    }

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
    // can be created either within a window (last claimants within a window don't get their claim)
    // or across windows (claimants from window T take rewards from window T+1). This situation
    // can occur because we do not segregate reward balances by window, for code simplicity purposes.
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

    // When `window.locked` is true, claims are blocked for that window.
    function setWindowLock(uint256 windowIndex, bool lockValue) external nonReentrant() onlyOwner {
        merkleWindows[windowIndex].locked = lockValue;
        emit SetWindowLock(msg.sender, windowIndex, lockValue);
    }

    // Overwrite merkle root for specified window index. Owner must deposit `totalRewardsDistributed`
    // into contract.
    // TODO: Should we require that `windowIndex <= lastSeededIndex` or should this function just be
    // a generalized `setWindowMerkleRoot` whereby the owner can set a merkle root for any index?
    function resetWindowMerkleRoot(
        uint256 windowIndex,
        uint256 totalRewardsDistributed,
        uint256 windowStart,
        address rewardToken,
        bytes32 merkleRoot
    ) external nonReentrant() onlyOwner {
        _seedWindow(windowIndex, totalRewardsDistributed, windowStart, rewardToken, merkleRoot);
    }

    // Emergency methods to transfer rewards into and out of the contract
    // incase the contract was configured improperly.
    function withdrawRewards(address rewardCurrency, uint256 amount) external nonReentrant() onlyOwner {
        IERC20(rewardCurrency).safeTransfer(msg.sender, amount);
        emit WithdrawRewards(msg.sender, amount);
    }

    function depositRewards(address rewardCurrency, uint256 amount) external nonReentrant() onlyOwner {
        IERC20(rewardCurrency).safeTransferFrom(msg.sender, address(this), amount);
        emit DepositRewards(msg.sender, amount);
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

    // Checks {account, amount} against Merkle root at given window index.
    function verifyClaim(Claim memory claim) public view returns (bool valid) {
        bytes32 leaf = keccak256(abi.encodePacked(claim.account, claim.amount));
        return MerkleProof.verify(claim.merkleProof, merkleWindows[claim.windowIndex].merkleRoot, leaf);
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
        window.totalRewardsDistributed = totalRewardsDistributed;

        window.rewardToken.safeTransferFrom(msg.sender, address(this), totalRewardsDistributed);

        emit SeededWindow(windowIndex, totalRewardsDistributed, windowStart, rewardToken, msg.sender);
    }

    function _markClaimed(Claim memory claim) private windowNotLocked(claim.windowIndex) {
        // Check claimed proof against merkle window at given index.
        require(verifyClaim(claim), "Incorrect merkle proof");
        // Check the account has not yet claimed for this window.
        require(!claimed[claim.windowIndex][claim.account], "Account has already claimed for this window");

        // Proof is correct and claim has not occurred yet; check that claim window has begun.
        require(getCurrentTime() >= merkleWindows[claim.windowIndex].start, "Claim window has not begin");

        claimed[claim.windowIndex][claim.account] = true;
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
        emit Claimed(msg.sender, account, amount, address(token));
    }
}

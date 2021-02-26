// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Inspired by:
 * - https://github.com/pie-dao/vested-token-migration-app
 * - https://github.com/Uniswap/merkle-distributor
 * - https://github.com/balancer-labs/erc20-redeemable
 *
 * @title MerkleDistributor contract.
 * @notice Allows an owner to distribute any reward ERC20 to claimants according to Merkle roots. The owner can specify
 *         multiple Merkle roots distributions, each of which has its own start time, constraining when claims can be
 *         executed, and end time, controlling the rate at which a claim is vested.
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
        // Claims become fully vested after `end`.
        uint256 end;
        // Merkle root describing the distribution.
        bytes32 merkleRoot;
        // Currency in which reward is processed.
        IERC20 rewardToken;
        // Total amount of rewards distributed this window. This is not enforced
        // but might be useful to query.
        uint256 totalRewardsDistributed;
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

    // Keep track of the amount an account has claimed from a window.
    mapping(uint256 => mapping(address => uint256)) public amountClaimedFromWindow;

    // Events:
    event Claimed(
        uint256 indexed windowIndex,
        address indexed account,
        uint256 claimAmount,
        uint256 amountVested,
        uint256 amountRemaining,
        address indexed rewardToken
    );
    event SeededWindow(uint256 indexed windowIndex, uint256 amount, uint256 windowStart, address indexed rewardToken);

    constructor(address _timerAddress) public Testable(_timerAddress) {}

    // Set merkle root for a window and seed allocations. Callable by owner of this
    // contract.
    function setWindowMerkleRoot(
        uint256 windowIndex,
        uint256 totalRewardsDistributed,
        uint256 windowStart,
        uint256 windowEnd,
        address rewardToken,
        bytes32 merkleRoot
    ) external nonReentrant() onlyOwner {
        require(merkleWindows[windowIndex].merkleRoot == bytes32(0), "Root already set");

        Window storage window = merkleWindows[windowIndex];
        window.start = windowStart;
        window.end = windowEnd;
        window.merkleRoot = merkleRoot;
        window.rewardToken = IERC20(rewardToken);
        window.totalRewardsDistributed = totalRewardsDistributed;

        window.rewardToken.safeTransferFrom(msg.sender, address(this), totalRewardsDistributed);
    }

    // TODO: This method could get pretty gas intensive; is there a way we can reduce the amount
    // of external `transfer` calls if we precompute all the rewards for each account?
    // It's a bit tricky because there are multiple reward currencies possible.
    function claimWindows(Claim[] memory claims) public nonReentrant() {
        for (uint256 i = 0; i < claims.length; i++) {
            claimWindow(claims[i]);
        }
    }

    // Claim `amount` of reward tokens for `account`. If `amount` and `account` do not exactly match the values stored
    // in the merkle proof for this `windowIndex` this method will revert.
    function claimWindow(Claim memory claim) public nonReentrant() {
        // Check claimed proof against merkle window at given index.
        require(verifyClaim(claim), "Incorrect merkle proof");
        // Check the account has not yet claimed their full amount for this window.
        require(
            amountClaimedFromWindow[claim.windowIndex][claim.account] < claim.amount,
            "Account has already claimed the full amount for this window"
        );

        // Proof is correct; check that claimant has enough vested amount to disburse and decrease their balance.
        Window memory merkleWindow = merkleWindows[claim.windowIndex];
        (uint256 amountVestedNetPreviousClaims, uint256 amountRemaining) = _debitClaimedAmount(claim, merkleWindow);

        _disburse(claim, merkleWindow, amountVestedNetPreviousClaims);

        emit Claimed(
            claim.windowIndex,
            claim.account,
            claim.amount,
            amountVestedNetPreviousClaims,
            amountRemaining,
            address(merkleWindow.rewardToken)
        );
    }

    // Checks {account, amount} against Merkle root at given window index.
    function verifyClaim(Claim memory claim) public view returns (bool valid) {
        bytes32 leaf = keccak256(abi.encodePacked(claim.account, claim.amount));
        return MerkleProof.verify(claim.merkleProof, merkleWindows[claim.windowIndex].merkleRoot, leaf);
    }

    // Returns how many tokens can be dispersed from the claim window. The amount is vested fully between `windowStart`
    // and `windowEnd`, meaning that if `time < start`, then this returns 0, and if `time >= end`, then this returns `amount`.
    function calcVestedAmount(
        uint256 amount,
        uint256 time,
        uint256 windowStart,
        uint256 windowEnd
    ) public view returns (uint256) {
        if (time < windowStart) {
            return 0;
        }
        // If time is after window end or window end is not greater than start,then return all tokens.
        else if (time >= windowEnd || windowEnd <= windowStart) {
            return amount;
        } else {
            // Assumptions:
            // - `time - windowStart` > 0
            // - `windowEnd - windowStart` > 0
            // Calculate:
            // - [ amount * (time - start) ] / [ end - start ]
            // Description:
            // - Linearly interpolate amount based on time's location between start and end
            return amount.mul(time.sub(windowStart)) / windowEnd.sub(windowStart);
        }
    }

    function _debitClaimedAmount(Claim memory claim, Window memory merkleWindow)
        internal
        returns (uint256 amountVestedNetPreviousClaims, uint256 amountRemaining)
    {
        uint256 currentTime = getCurrentTime();

        // Calculate how much of the claimed amount has vested. This will return 0 if the contract time is less than or
        // equal to the window start, or return the full `amount` if the contract time is greater than or equal to the window end.
        uint256 amountVested = calcVestedAmount(claim.amount, currentTime, merkleWindow.start, merkleWindow.end);

        // Fetch how much the account has previously claimed for this window.
        uint256 amountPreviouslyClaimed = amountClaimedFromWindow[claim.windowIndex][claim.account];

        // Calculate how much the account has remaining to still withdraw from their vested amount for this window.
        amountVestedNetPreviousClaims = amountVested.sub(amountPreviouslyClaimed);

        // If the amount net previous claims is zero, then revert.
        require(amountVestedNetPreviousClaims > 0, "Zero vested amount");

        // Calculate how much the account has left to claim (unvested). Useful in logging.
        amountRemaining = claim.amount.sub(amountVestedNetPreviousClaims);

        // Finally, Update the total amount the user has claimed as the amountVested.
        amountClaimedFromWindow[claim.windowIndex][claim.account] = amountVested;
    }

    function _disburse(
        Claim memory claim,
        Window memory merkleWindow,
        uint256 amount
    ) internal {
        if (amount > 0) {
            merkleWindow.rewardToken.safeTransfer(claim.account, amount);
        }
    }
}

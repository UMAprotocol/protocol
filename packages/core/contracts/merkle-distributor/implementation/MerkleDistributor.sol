// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * Inspired by:
 * - https://github.com/pie-dao/vested-token-migration-app
 * - https://github.com/Uniswap/merkle-distributor
 * - https://github.com/balancer-labs/erc20-redeemable
 *
 * @title  MerkleDistributor contract.
 * @notice Allows an owner to distribute any reward ERC20 to claimants according to Merkle roots. The owner can specify
 *         multiple Merkle roots distributions with customized reward currencies.
 * @dev    The Merkle trees are not validated in any way, so the system assumes the contract owner behaves honestly.
 */
contract MerkleDistributor is Ownable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    // A Window maps a Merkle root to a reward token address.
    struct Window {
        // Merkle root describing the distribution.
        bytes32 merkleRoot;
        // Currency in which reward is processed.
        IERC20 rewardToken;
        // IPFS hash of the merkle tree. Can be used to independently fetch recipient proofs and tree. Note that the canonical
        // data type for storing an IPFS hash is a multihash which is the concatenation of  <varint hash function code>
        // <varint digest size in bytes><hash function output>. We opted to store this in a string type to make it easier
        // for users to query the ipfs data without needing to reconstruct the multihash. to view the IPFS data simply
        // go to https://cloudflare-ipfs.com/ipfs/<IPFS-HASH>.
        string ipfsHash;
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

    // Index of next created Merkle root.
    uint256 public nextCreatedIndex;

    // Track which accounts have claimed for each window index.
    // Note: uses a packed array of bools for gas optimization on tracking certain claims. Copied from Uniswap's contract.
    mapping(uint256 => mapping(uint256 => uint256)) private claimedBitMap;

    /****************************************
     *                EVENTS
     ****************************************/
    event Claimed(
        address indexed caller,
        uint256 windowIndex,
        address indexed account,
        uint256 accountIndex,
        uint256 amount,
        address indexed rewardToken
    );
    event CreatedWindow(
        uint256 indexed windowIndex,
        uint256 rewardsDeposited,
        address indexed rewardToken,
        address owner
    );
    event WithdrawRewards(address indexed owner, uint256 amount, address indexed currency);
    event DeleteWindow(uint256 indexed windowIndex, address owner);

    /****************************
     *      ADMIN FUNCTIONS
     ****************************/

    /**
     * @notice Set merkle root for the next available window index and seed allocations.
     * @notice Callable only by owner of this contract. Caller must have approved this contract to transfer
     *      `rewardsToDeposit` amount of `rewardToken` or this call will fail. Importantly, we assume that the
     *      owner of this contract correctly chooses an amount `rewardsToDeposit` that is sufficient to cover all
     *      claims within the `merkleRoot`. Otherwise, a race condition can be created. This situation can occur
     *      because we do not segregate reward balances by window, for code simplicity purposes.
     *      (If `rewardsToDeposit` is purposefully insufficient to payout all claims, then the admin must
     *      subsequently transfer in rewards or the following situation can occur).
     *      Example race situation:
     *          - Window 1 Tree: Owner sets `rewardsToDeposit=100` and insert proofs that give claimant A 50 tokens and
     *            claimant B 51 tokens. The owner has made an error by not setting the `rewardsToDeposit` correctly to 101.
     *          - Window 2 Tree: Owner sets `rewardsToDeposit=1` and insert proofs that give claimant A 1 token. The owner
     *            correctly set `rewardsToDeposit` this time.
     *          - At this point contract owns 100 + 1 = 101 tokens. Now, imagine the following sequence:
     *              (1) Claimant A claims 50 tokens for Window 1, contract now has 101 - 50 = 51 tokens.
     *              (2) Claimant B claims 51 tokens for Window 1, contract now has 51 - 51 = 0 tokens.
     *              (3) Claimant A tries to claim 1 token for Window 2 but fails because contract has 0 tokens.
     *          - In summary, the contract owner created a race for step(2) and step(3) in which the first claim would
     *            succeed and the second claim would fail, even though both claimants would expect their claims to succeed.
     * @param rewardsToDeposit amount of rewards to deposit to seed this allocation.
     * @param rewardToken ERC20 reward token.
     * @param merkleRoot merkle root describing allocation.
     * @param ipfsHash hash of IPFS object, conveniently stored for clients
     */
    function setWindow(
        uint256 rewardsToDeposit,
        address rewardToken,
        bytes32 merkleRoot,
        string memory ipfsHash
    ) external onlyOwner {
        uint256 indexToSet = nextCreatedIndex;
        nextCreatedIndex = indexToSet.add(1);

        _setWindow(indexToSet, rewardsToDeposit, rewardToken, merkleRoot, ipfsHash);
    }

    /**
     * @notice Delete merkle root at window index.
     * @dev Callable only by owner. Likely to be followed by a withdrawRewards call to clear contract state.
     * @param windowIndex merkle root index to delete.
     */
    function deleteWindow(uint256 windowIndex) external onlyOwner {
        delete merkleWindows[windowIndex];
        emit DeleteWindow(windowIndex, msg.sender);
    }

    /**
     * @notice Emergency method that transfers rewards out of the contract if the contract was configured improperly.
     * @dev Callable only by owner.
     * @param rewardCurrency rewards to withdraw from contract.
     * @param amount amount of rewards to withdraw.
     */
    function withdrawRewards(address rewardCurrency, uint256 amount) external onlyOwner {
        IERC20(rewardCurrency).safeTransfer(msg.sender, amount);
        emit WithdrawRewards(msg.sender, amount, rewardCurrency);
    }

    /****************************
     *    NON-ADMIN FUNCTIONS
     ****************************/

    /**
     * @notice Batch claims to reduce gas versus individual submitting all claims. Method will fail
     *         if any individual claims within the batch would fail.
     * @dev    Optimistically tries to batch together consecutive claims for the same account and same
     *         reward token to reduce gas. Therefore, the most gas-cost-optimal way to use this method
     *         is to pass in an array of claims sorted by account and reward currency.
     * @param claims array of claims to claim.
     */
    function claimMulti(Claim[] memory claims) external {
        uint256 batchedAmount = 0;
        uint256 claimCount = claims.length;
        for (uint256 i = 0; i < claimCount; i++) {
            Claim memory _claim = claims[i];
            _verifyAndMarkClaimed(_claim);
            batchedAmount = batchedAmount.add(_claim.amount);

            // If the next claim is NOT the same account or the same token (or this claim is the last one),
            // then disburse the `batchedAmount` to the current claim's account for the current claim's reward token.
            uint256 nextI = i + 1;
            address currentRewardToken = address(merkleWindows[_claim.windowIndex].rewardToken);
            if (
                nextI == claimCount ||
                // This claim is last claim.
                claims[nextI].account != _claim.account ||
                // Next claim account is different than current one.
                address(merkleWindows[claims[nextI].windowIndex].rewardToken) != currentRewardToken
                // Next claim reward token is different than current one.
            ) {
                IERC20(currentRewardToken).safeTransfer(_claim.account, batchedAmount);
                batchedAmount = 0;
            }
        }
    }

    /**
     * @notice Claim amount of reward tokens for account, as described by Claim input object.
     * @dev    If the `_claim`'s `amount`, `accountIndex`, and `account` do not exactly match the
     *         values stored in the merkle root for the `_claim`'s `windowIndex` this method
     *         will revert.
     * @param _claim claim object describing amount, accountIndex, account, window index, and merkle proof.
     */
    function claim(Claim memory _claim) public {
        _verifyAndMarkClaimed(_claim);
        merkleWindows[_claim.windowIndex].rewardToken.safeTransfer(_claim.account, _claim.amount);
    }

    /**
     * @notice Returns True if the claim for `accountIndex` has already been completed for the Merkle root at
     *         `windowIndex`.
     * @dev    This method will only work as intended if all `accountIndex`'s are unique for a given `windowIndex`.
     *         The onus is on the Owner of this contract to submit only valid Merkle roots.
     * @param windowIndex merkle root to check.
     * @param accountIndex account index to check within window index.
     * @return True if claim has been executed already, False otherwise.
     */
    function isClaimed(uint256 windowIndex, uint256 accountIndex) public view returns (bool) {
        uint256 claimedWordIndex = accountIndex / 256;
        uint256 claimedBitIndex = accountIndex % 256;
        uint256 claimedWord = claimedBitMap[windowIndex][claimedWordIndex];
        uint256 mask = (1 << claimedBitIndex);
        return claimedWord & mask == mask;
    }

    /**
     * @notice Returns True if leaf described by {account, amount, accountIndex} is stored in Merkle root at given
     *         window index.
     * @param _claim claim object describing amount, accountIndex, account, window index, and merkle proof.
     * @return valid True if leaf exists.
     */
    function verifyClaim(Claim memory _claim) public view returns (bool valid) {
        bytes32 leaf = keccak256(abi.encodePacked(_claim.account, _claim.amount, _claim.accountIndex));
        return MerkleProof.verify(_claim.merkleProof, merkleWindows[_claim.windowIndex].merkleRoot, leaf);
    }

    /****************************
     *     PRIVATE FUNCTIONS
     ****************************/

    // Mark claim as completed for `accountIndex` for Merkle root at `windowIndex`.
    function _setClaimed(uint256 windowIndex, uint256 accountIndex) private {
        uint256 claimedWordIndex = accountIndex / 256;
        uint256 claimedBitIndex = accountIndex % 256;
        claimedBitMap[windowIndex][claimedWordIndex] =
            claimedBitMap[windowIndex][claimedWordIndex] |
            (1 << claimedBitIndex);
    }

    // Store new Merkle root at `windowindex`. Pull `rewardsDeposited` from caller to seed distribution for this root.
    function _setWindow(
        uint256 windowIndex,
        uint256 rewardsDeposited,
        address rewardToken,
        bytes32 merkleRoot,
        string memory ipfsHash
    ) private {
        Window storage window = merkleWindows[windowIndex];
        window.merkleRoot = merkleRoot;
        window.rewardToken = IERC20(rewardToken);
        window.ipfsHash = ipfsHash;

        emit CreatedWindow(windowIndex, rewardsDeposited, rewardToken, msg.sender);

        window.rewardToken.safeTransferFrom(msg.sender, address(this), rewardsDeposited);
    }

    // Verify claim is valid and mark it as completed in this contract.
    function _verifyAndMarkClaimed(Claim memory _claim) private {
        // Check claimed proof against merkle window at given index.
        require(verifyClaim(_claim), "Incorrect merkle proof");
        // Check the account has not yet claimed for this window.
        require(!isClaimed(_claim.windowIndex, _claim.accountIndex), "Account has already claimed for this window");

        // Proof is correct and claim has not occurred yet, mark claimed complete.
        _setClaimed(_claim.windowIndex, _claim.accountIndex);
        emit Claimed(
            msg.sender,
            _claim.windowIndex,
            _claim.account,
            _claim.accountIndex,
            _claim.amount,
            address(merkleWindows[_claim.windowIndex].rewardToken)
        );
    }
}

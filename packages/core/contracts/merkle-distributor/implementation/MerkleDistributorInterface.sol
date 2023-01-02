// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @notice Concise list of functions in MerkleDistributor implementation that would be called by
 * a consuming external contract (such as the Across Protocol's AcceleratingDistributor).
 */
interface MerkleDistributorInterface {
    // A Window maps a Merkle root to a reward token address.
    struct Window {
        // Merkle root describing the distribution.
        bytes32 merkleRoot;
        // Remaining amount of deposited rewards that have not yet been claimed.
        uint256 remainingAmount;
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

    function claim(Claim memory _claim) external;

    function claimMulti(Claim[] memory claims) external;

    function getRewardTokenForWindow(uint256 windowIndex) external view returns (address);
}

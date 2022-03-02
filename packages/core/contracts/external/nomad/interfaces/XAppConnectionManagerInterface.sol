// SPDX-License-Identifier: MIT OR Apache-2.0
pragma solidity ^0.8.0;

import "./HomeInterface.sol";

/**
 * @title XAppConnectionManager
 * @notice Inspired from https://github.com/nomad-xyz/nomad-monorepo/blob/9294161dffa27ddd26d37462404ba294d31f73ad/solidity/nomad-core/contracts/XAppConnectionManager.sol
 */
interface XAppConnectionManagerInterface {
    // ============ Public Storage ============

    // Home contract for this chain.
    function home() external view returns (HomeInterface);

    /**
     * @notice Check whether _replica is enrolled
     * @param _replica the replica to check for enrollment
     * @return TRUE iff _replica is enrolled
     */
    function isReplica(address _replica) external view returns (bool);
}

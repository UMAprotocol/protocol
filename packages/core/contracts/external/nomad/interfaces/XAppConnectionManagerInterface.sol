// SPDX-License-Identifier: MIT OR Apache-2.0
pragma solidity ^0.8.0;

import "./HomeInterface.sol";

/**
 * @title XAppConnectionManager
 * @author Celo Labs Inc.
 * @notice Manages a registry of local Replica contracts
 * for remote Home domains. Accepts Watcher signatures
 * to un-enroll Replicas attached to fraudulent remote Homes
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

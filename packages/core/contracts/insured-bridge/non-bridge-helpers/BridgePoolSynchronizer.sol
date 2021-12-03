pragma solidity ^0.8.0;

interface BridgePoolLike {
    function syncUmaEcosystemParams() external;

    function syncWithBridgeAdminParams() external;
}

/**
 * @notice Small helper contract to facilitate calling sync methods on a set of bridge pools. When one pool needs to be
 * synced it is likely that all ecosystem pools also need to be synced. This contract lets the caller do this in a batch.
 */
contract BridgePoolSynchronizer {
    function syncUmaEcosystemParams(BridgePoolLike[] memory bridgePools) public {
        for (uint256 i = 0; i < bridgePools.length; i++) {
            bridgePools[i].syncUmaEcosystemParams();
        }
    }

    function syncWithBridgeAdminParams(BridgePoolLike[] memory bridgePools) public {
        for (uint256 i = 0; i < bridgePools.length; i++) {
            bridgePools[i].syncWithBridgeAdminParams();
        }
    }

    function syncBothUmaEcosystemParamsAndBridgeAdminParms(BridgePoolLike[] memory bridgePools) public {
        for (uint256 i = 0; i < bridgePools.length; i++) {
            bridgePools[i].syncUmaEcosystemParams();
            bridgePools[i].syncWithBridgeAdminParams();
        }
    }
}

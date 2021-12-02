pragma solidity ^0.8.0;

interface BridgePoolLike {
    function syncUmaEcosystemParams() external;

    function syncWithBridgeAdminParams() external;
}

/**
 * @notice Small helper contract to make calling sync methods on a set of bridge pools easier. When one pool needs to be
 * sync it is likely that all ecosystem pools also need to by sync. This contract lets the caller do this in a batch.
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

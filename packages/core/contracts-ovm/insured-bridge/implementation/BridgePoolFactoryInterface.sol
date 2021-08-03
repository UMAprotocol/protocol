// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

/**
 * @notice Helper view methods designed to be called by children BridgePool contracts.
 */
interface BridgePoolFactoryInterface {
    function finder() external view returns (address);

    function depositContract() external view returns (address);

    struct L1TokenRelationships {
        address l2Token;
        address bridgePool;
    }

    function optimisticOracleLiveness() external view returns (uint64);

    function proposerBondPct() external view returns (uint64);

    function identifier() external view returns (bytes32);
}

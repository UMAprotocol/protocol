// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

/**
 * @notice Helper view methods designed to be called by BridgePool contracts.
 */
interface BridgeAdminInterface {
    event SetDepositContract(address indexed l2DepositContract);
    event SetBridgeAdmin(address indexed bridgeAdmin);
    event SetRelayIdentifier(bytes32 indexed identifier);
    event SetOptimisticOracleLiveness(uint64 indexed liveness);
    event SetProposerBondPct(uint64 indexed proposerBondPct);
    event DeployedBridgePool(address indexed bridgePool);
    event SetMinimumBridgingDelay(uint64 newMinimumBridgingDelay);
    event DepositsEnabled(address indexed l2Token, bool depositsEnabled);
    event WhitelistToken(address indexed l1Token, address indexed l2Token, address indexed bridgePool);

    function finder() external view returns (address);

    function depositContract() external view returns (address);

    struct L1TokenRelationships {
        address l2Token;
        address bridgePool;
    }

    function whitelistedTokens(address) external view returns (L1TokenRelationships memory);

    function optimisticOracleLiveness() external view returns (uint64);

    function proposerBondPct() external view returns (uint64);

    function identifier() external view returns (bytes32);
}

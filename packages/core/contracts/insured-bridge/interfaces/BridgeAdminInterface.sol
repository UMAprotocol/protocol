// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

/**
 * @notice Helper view methods designed to be called by BridgePool contracts.
 */
interface BridgeAdminInterface {
    event SetDepositContracts(
        uint256 indexed chainId,
        address indexed l2DepositContract,
        address indexed l2MessengerContract
    );
    event SetCrossDomainAdmin(uint256 indexed chainId, address indexed newAdmin);
    event SetRelayIdentifier(bytes32 indexed identifier);
    event SetOptimisticOracleLiveness(uint32 indexed liveness);
    event SetProposerBondPct(uint64 indexed proposerBondPct);
    event WhitelistToken(uint256 chainId, address indexed l1Token, address indexed l2Token, address indexed bridgePool);
    event SetMinimumBridgingDelay(uint256 indexed chainId, uint64 newMinimumBridgingDelay);
    event DepositsEnabled(uint256 indexed chainId, address indexed l2Token, bool depositsEnabled);
    event BridgePoolsAdminTransferred(address[] bridgePools, address indexed newAdmin);
    event SetLpFeeRate(address indexed bridgePool, uint64 newLpFeeRatePerSecond);

    function finder() external view returns (address);

    struct DepositUtilityContracts {
        address depositContract; // L2 deposit contract where cross-chain relays originate.
        address messengerContract; // L1 helper contract that can send a message to the L2 with the mapped network ID.
    }

    function depositContracts(uint256) external view returns (DepositUtilityContracts memory);

    struct L1TokenRelationships {
        mapping(uint256 => address) l2Tokens; // L2 Chain Id to l2Token address.
        address bridgePool;
    }

    function whitelistedTokens(address, uint256) external view returns (address l2Token, address bridgePool);

    function optimisticOracleLiveness() external view returns (uint32);

    function proposerBondPct() external view returns (uint64);

    function identifier() external view returns (bytes32);
}

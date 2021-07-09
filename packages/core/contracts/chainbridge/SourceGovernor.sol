// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../oracle/interfaces/FinderInterface.sol";
import "../oracle/implementation/Constants.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../external/chainbridge/interfaces/IBridge.sol";

/**
 * @title Governance relayer contract on L1 that receives messages from the owner (Governor) and sends them to L2.
 */
contract SourceGovernor is Ownable {
    FinderInterface public finder;
    uint8 public currentChainId;
    bytes32 internal currentRequestHash;

    event RelayedGovernanceRequest(uint8 indexed destinationChainId, address indexed to, bytes indexed data);

    /**
     * @notice Constructor.
     * @param _finder Address of Finder that this contract uses to locate Bridge.
     * @param _currentChainId Chain ID for this network. This is configurable by the deployer, rather than
     * automatically detected via `block.chainid` because the type of `currentChainId` should match any
     * `destinationChainId`'s submitted as input to `relayGovernance()`. `relayGovernance()` calls `Bridge.deposit()`
     * which expects a uint8 chainID passed as the first param, but `block.chainid` returns a uint256 value. Due to
     * the possibility that a uint256 --> uint28 conversion leads to data loss and the complexity of mapping safely
     * from uint256 --> uint8 on-chain, we opt to allow the user to specify a unique uint8 ID for this chain. It
     * follows that the `_currentChainId` may not match with `block.chainid`.
     */
    constructor(FinderInterface _finder, uint8 _currentChainId) {
        finder = _finder;
        currentChainId = _currentChainId;
        currentRequestHash = bytes32(0);
    }

    /**
     * @notice This is the first method that should be called in order to relay a governance request to another network
     * marked by `destinationChainId`. Note: this can only be called by the owner (presumably the L1 governor).
     * @dev The transaction submitted to `to` on the sidechain with the calldata `data` is assumed to have 0 `value`
     * in order to avoid the added complexity of sending cross-chain transactions with positive value.
     * @param destinationChainId Chain ID of SinkGovernor that this governance request should ultimately be sent to.
     * @param to Contract on network with chain ID `destinationChainId` to send governance transaction to.
     * @param data Calldata to include in governance transaction.
     */
    function relayGovernance(
        uint8 destinationChainId,
        address to,
        bytes memory data
    ) external onlyOwner {
        require(currentRequestHash == bytes32(0), "Request hash already set");
        currentRequestHash = _computeRequestHash(to, data);
        _getBridge().deposit(destinationChainId, getResourceId(), _formatMetadata(to, data));
        currentRequestHash = bytes32(0);
        emit RelayedGovernanceRequest(destinationChainId, to, data);
    }

    /**
     * @notice This method will ultimately be called after `relayGovernance` calls `Bridge.deposit()`, which will call
     * `GenericHandler.deposit()` and ultimately this method.
     * @dev This method should basically check that the `Bridge.deposit()` was triggered by a valid relay event.
     * @param to Contract on network with chain ID `destinationChainId` to send governance transaction to.
     * @param data Calldata to include in governance transaction.
     */
    function verifyRequest(address to, bytes memory data) external view {
        require(currentRequestHash == _computeRequestHash(to, data), "Invalid Request");
    }

    /**
     * @notice Gets the resource id to send to the bridge.
     * @dev More details about Resource ID's here: https://chainbridge.chainsafe.io/spec/#resource-id
     * @return bytes32 Hash containing this stored chain ID.
     */
    function getResourceId() public view returns (bytes32) {
        return keccak256(abi.encode("Governor", currentChainId));
    }

    function _getBridge() internal view returns (IBridge) {
        return IBridge(finder.getImplementationAddress(OracleInterfaces.Bridge));
    }

    function _formatMetadata(address to, bytes memory data) internal pure returns (bytes memory) {
        bytes memory metadata = abi.encode(to, data);
        return abi.encodePacked(metadata.length, metadata);
    }

    function _computeRequestHash(address to, bytes memory data) internal pure returns (bytes32) {
        return keccak256(abi.encode(to, data));
    }
}

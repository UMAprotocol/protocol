// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../oracle/interfaces/FinderInterface.sol";
import "../oracle/implementation/Constants.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./IBridge.sol";

/**
 * @title Governance relayer contract on L1 that receives messages from the owner (Governor) and sends them to L2.
 */
contract SourceGovernor is Ownable {
    FinderInterface public finder;
    uint8 public currentChainId;
    bytes32 internal currentRequestHash;

    event RelayedGovernanceRequest(
        uint8 indexed destinationChainId,
        address indexed to,
        uint256 value,
        bytes indexed data
    );

    constructor(FinderInterface _finder, uint8 _currentChainId) {
        finder = _finder;
        currentChainId = _currentChainId;
        currentRequestHash = bytes32(0);
    }

    /**
     * @notice This is the first method that should be called in order to relay a governance request to another network
     * marked by `sinkChainID`. Note: this can only be called by the owner (presumably the L1 governor).
     */
    function relayGovernance(
        uint8 destinationChainId,
        address to,
        uint256 value,
        bytes memory data
    ) external onlyOwner {
        require(currentRequestHash == bytes32(0), "Request hash already set");
        currentRequestHash = _computeRequestHash(to, value, data);
        _getBridge().deposit(destinationChainId, getResourceId(), _formatMetadata(to, value, data));
        currentRequestHash = bytes32(0);
        emit RelayedGovernanceRequest(destinationChainId, to, value, data);
    }

    /**
     * @notice This method will ultimately be called after `relayGovernance` calls `Bridge.deposit()`, which will call
     * `GenericHandler.deposit()` and ultimately this method.
     * @dev This method should basically check that the `Bridge.deposit()` was triggered by a valid relay event.
     */
    function verifyRequest(
        address to,
        uint256 value,
        bytes memory data
    ) external view {
        require(currentRequestHash == _computeRequestHash(to, value, data), "Invalid Request");
    }

    /**
     * @notice Gets the resource id to send to the bridge.
     */
    function getResourceId() public view returns (bytes32) {
        return keccak256(abi.encode("Governor", currentChainId));
    }

    function _getBridge() internal view returns (IBridge) {
        return IBridge(finder.getImplementationAddress(OracleInterfaces.Bridge));
    }

    function _formatMetadata(
        address to,
        uint256 value,
        bytes memory data
    ) internal pure returns (bytes memory) {
        bytes memory metadata = abi.encode(to, value, data);
        return abi.encodePacked(metadata.length, metadata);
    }

    function _computeRequestHash(
        address to,
        uint256 value,
        bytes memory data
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(to, value, data));
    }
}

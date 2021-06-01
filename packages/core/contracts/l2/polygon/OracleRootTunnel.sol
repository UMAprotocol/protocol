// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./tunnel/FxBaseRootTunnel.sol";
import "./OracleBaseTunnel.sol";
import "../../oracle/interfaces/OracleAncillaryInterface.sol";

/**
 * @title Adapter deployed on L1 that validates and sends price requests from L2 to the DVM on L1.
 * @dev This contract must be a registered financial contract in order to make DVM price requests.
 */

contract OracleRootTunnel is OracleBaseTunnel, FxBaseRootTunnel {
    constructor(
        address _checkpointManager, 
        address _fxRoot,
        address _finderAddress
    ) 
    OracleBaseTunnel(_finderAddress) 
    FxBaseRootTunnel(_checkpointManager, _fxRoot) {}

    function publishPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public {
        require(_getOracle().hasPrice(identifier, time, ancillaryData), "DVM has not resolved price");
        int256 price = _getOracle().getPrice(identifier, time, ancillaryData);
        _publishPrice(identifier, time, ancillaryData, price);
        // Initiate cross-chain price request:
        // TODO: Can we pack more information into this request?
        _sendMessageToChild(abi.encode(identifier, time, ancillaryData, price));
    }

    function _processMessageFromChild(bytes memory data) internal override {
        (bytes32 identifier, uint256 time, bytes memory ancillaryData) = abi.decode(data, (bytes32, uint256, bytes));
        _requestPrice(identifier, time, ancillaryData);
        _getOracle().requestPrice(identifier, time, ancillaryData);
    }

    /**
     * @notice Return DVM for this network.
     */
    function _getOracle() internal view returns (OracleAncillaryInterface) {
        return OracleAncillaryInterface(finder.getImplementationAddress(OracleInterfaces.Oracle));
    }
}
// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../OracleRootTunnel.sol";

contract OracleRootTunnelMock is OracleRootTunnel {
    // If set to true, then always revert on calls to receiveMessage.
    bool public revertReceiveMessage;

    // Error message to emit when receiveMessage reverts.
    string public errorMessage;

    event ReceivedMessage(bytes indexed inputData);

    constructor(
        address _checkpointManager,
        address _fxRoot,
        address _finderAddress
    ) OracleRootTunnel(_checkpointManager, _fxRoot, _finderAddress) {
        revertReceiveMessage = false;
        errorMessage = "generic error message";
    }

    // Helper method to test _processMessageFromChild directly without having to call internal
    // _validateAndExtractMessage
    function processMessageFromChild(bytes memory message) public {
        _processMessageFromChild(message);
    }

    // Helper method to test receiveMessage. Will always succeed unless `revertReceiveMessage` is True, then will
    // always revert.
    function receiveMessage(bytes memory inputData) public override {
        if (!revertReceiveMessage) {
            emit ReceivedMessage(inputData);
        } else {
            require(false, errorMessage);
        }
    }

    function setRevertReceiveMessage(bool _revertReceiveMessage) public {
        revertReceiveMessage = _revertReceiveMessage;
    }

    function setRevertErrorMessage(string calldata _errorMessage) public {
        errorMessage = _errorMessage;
    }
}

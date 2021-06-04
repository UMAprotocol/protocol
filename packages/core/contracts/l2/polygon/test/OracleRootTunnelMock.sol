// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../OracleRootTunnel.sol";

contract OracleRootTunnelMock is OracleRootTunnel {
    constructor(
        address _checkpointManager,
        address _fxRoot,
        address _finderAddress
    ) OracleRootTunnel(_checkpointManager, _fxRoot, _finderAddress) {}

    // Helper method to test _processMessageFromChild directly without having to call internal
    // _validateAndExtractMessage
    function processMessageFromChild(bytes memory message) public {
        _processMessageFromChild(message);
    }
}

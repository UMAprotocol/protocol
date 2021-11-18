// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../Polygon_ParentMessenger.sol";

contract Polygon_ParentMessengerMock is Polygon_ParentMessenger {
    constructor(
        address _checkpointManager,
        address _fxRoot,
        uint256 _childChainId
    ) Polygon_ParentMessenger(_checkpointManager, _fxRoot, _childChainId) {}

    function processMessageFromChild(bytes memory data) external {
        _processMessageFromChild(data);
    }
}

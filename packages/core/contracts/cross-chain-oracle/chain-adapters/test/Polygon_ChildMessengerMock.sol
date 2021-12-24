// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../Polygon_ChildMessenger.sol";

contract Polygon_ChildMessengerMock is Polygon_ChildMessenger {
    constructor(address _fxChild, address _finder) Polygon_ChildMessenger(_fxChild, _finder) {}

    function processMessageFromRoot(address sender, bytes memory data) external {
        _processMessageFromRoot(
            1, // Unused param set to arbitrary value.
            sender,
            data
        );
    }
}

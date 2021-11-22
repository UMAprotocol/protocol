// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../ParentMessengerBase.sol";

contract ParentMessengerBaseMock is ParentMessengerBase {
    constructor(uint256 _childChainId) ParentMessengerBase(_childChainId) {}

    function sendMessageToChild(bytes memory) public view override {
        require(false, "unused function");
    }
}

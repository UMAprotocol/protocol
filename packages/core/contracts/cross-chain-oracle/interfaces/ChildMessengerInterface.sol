// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

interface ChildMessengerInterface {
    // Should send cross-chain message to Parent messenger contract or revert.
    function sendMessageToParent(bytes memory data) external;

    // Should be targeted by ParentMessenger and executed upon receiving a message from root chain.
    function processMessageFromParent(bytes memory data) external;
}

// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

interface ChildMessengerInterface {
    // Should send cross-chain message to parent messenger contract or revert.
    function sendMessageToParent(bytes memory data) external;

    // Processes a message recived from the parent messanger, calling `target` with `data`.
    function processMessageFromCrossChainParent(bytes memory data, address target) external;
}

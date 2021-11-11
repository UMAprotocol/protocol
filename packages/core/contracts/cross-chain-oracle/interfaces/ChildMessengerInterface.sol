// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

interface ChildMessengerInterface {
    // Should send cross-chain message to Parent messenger contract or revert.
    function sendMessageToParent(bytes memory data) external;

    // Should be called by parent messenger over the canonical bridge. Includes a target as the L2 contract that should
    // have data passed to it.
    function processMessageFromParent(bytes memory data, address target) external;
}

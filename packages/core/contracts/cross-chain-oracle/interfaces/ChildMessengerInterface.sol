// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

interface ChildMessengerInterface {
    // Should send cross-chain message to Root chain or revert.
    function sendMessageToRoot(bytes memory data) external;
}

// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

interface RootMessengerInterface {
    // Should send cross-chain message to Child chain or revert.
    function sendMessageToChild(bytes memory data) external;
}

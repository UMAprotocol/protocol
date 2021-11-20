// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

interface ParentMessengerInterface {
    // Should send cross-chain message to Child messenger contract or revert.
    function sendMessageToChild(bytes memory data) external;

    // Informs Hub how much msg.value they need to include to call `sendMessageToChild`.
    function getL1CallValue() external view returns (uint256);
}

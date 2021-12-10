// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

interface ChildMessengerConsumerInterface {
    // Called on L2 by child messenger.
    function processMessageFromParent(bytes memory data) external;
}

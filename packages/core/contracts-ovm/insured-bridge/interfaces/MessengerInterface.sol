// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

/**
 * @notice Sends cross chain messages to contracts on a specific L2 network. The `relayMessage` implementation will
 * differ for each L2.
 */
interface MessengerInterface {
    function relayMessage(
        address target,
        uint32 gasLimit,
        bytes memory message
    ) external;
}

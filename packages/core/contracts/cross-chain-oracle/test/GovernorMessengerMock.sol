// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

/**
 * @notice Can be used as either a Parent or Child messenger mock in unit tests for the Governor Hub and Spoke
 * cross-chain contracts. The reason that this can't also be used for the Oracle Hub and Spoke is that the
 * sendMessageToChild is called with different encoded data in the Oracle versus the Governor.
 */
contract GovernorMessengerMock {
    bytes public latestData;
    address public latestTo;

    function sendMessageToChild(bytes memory data) external {
        (latestTo, latestData) = abi.decode(data, (address, bytes));
    }
}

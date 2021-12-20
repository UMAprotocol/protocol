// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../GovernorSpoke.sol";

/**
 * @notice Can be used as either a Parent or Child messenger mock in unit tests for the Governor Hub and Spoke
 * cross-chain contracts. The reason that this can't also be used for the Oracle Hub and Spoke is that the
 * sendMessageToChild is called with different encoded data in the Oracle versus the Governor.
 */
contract GovernorMessengerMock {
    GovernorSpoke.Call[] private _latestCalls;

    function latestCalls() external view returns (GovernorSpoke.Call[] memory) {
        return _latestCalls;
    }

    function sendMessageToChild(bytes memory data) external {
        delete _latestCalls;
        GovernorSpoke.Call[] memory calls = abi.decode(data, (GovernorSpoke.Call[]));
        for (uint256 i = 0; i < calls.length; i++) _latestCalls.push(calls[i]);
    }
}

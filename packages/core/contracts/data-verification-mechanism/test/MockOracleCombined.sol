// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "./MockOracleAncillary.sol";

// A mock oracle used for testing. Allows both ancillary and non-ancillary methods to be called.
contract MockOracleCombined is MockOracleAncillary {
    constructor(address _finderAddress, address _timerAddress) MockOracleAncillary(_finderAddress, _timerAddress) {}

    // Enqueues a request (if a request isn't already present) for the given (identifier, time) pair.
    function requestPrice(bytes32 identifier, uint256 time) public {
        requestPrice(identifier, time, "");
    }

    // Pushes the verified price for a requested query.
    function pushPrice(
        bytes32 identifier,
        uint256 time,
        int256 price
    ) external {
        pushPrice(identifier, time, "", price);
    }

    // Checks whether a price has been resolved.
    function hasPrice(bytes32 identifier, uint256 time) public view returns (bool) {
        return hasPrice(identifier, time, "");
    }

    // Gets a price that has already been resolved.
    function getPrice(bytes32 identifier, uint256 time) public view returns (int256) {
        return getPrice(identifier, time, "");
    }
}

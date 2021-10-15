// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../interfaces/OracleAncillaryInterface.sol";

// A mock oracle used for testing that always reverts on requestPrice calls.
contract MockOracleRevert is OracleAncillaryInterface {
    constructor() {}

    // Enqueues a request (if a request isn't already present) for the given (identifier, time) pair.

    function requestPrice(
        bytes32,
        uint256,
        bytes memory
    ) public pure override {
        require(false, "always reverts");
    }

    function hasPrice(
        bytes32,
        uint256,
        bytes memory
    ) public pure override returns (bool) {
        return false;
    }

    function getPrice(
        bytes32,
        uint256,
        bytes memory
    ) public pure override returns (int256) {
        return 0;
    }
}

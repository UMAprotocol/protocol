// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../Governor.sol";
import "../AdminIdentifierLib.sol";

// GovernorTest exposes internal methods in the Governor for testing.
contract GovernorTest is Governor {
    constructor(address _timerAddress) Governor(address(0), 0, _timerAddress) {}

    function addPrefix(
        bytes32 input,
        bytes32 prefix,
        uint256 prefixLength
    ) external pure returns (bytes32) {
        return AdminIdentifierLib._addPrefix(input, prefix, prefixLength);
    }

    function uintToUtf8(uint256 v) external pure returns (bytes32 ret) {
        return AdminIdentifierLib._uintToUtf8(v);
    }

    function constructIdentifier(uint256 id) external pure returns (bytes32 identifier) {
        return AdminIdentifierLib._constructIdentifier(id);
    }
}

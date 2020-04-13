pragma solidity ^0.6.0;

pragma experimental ABIEncoderV2;

import "../Governor.sol";


// GovernorTest exposes internal methods in the Governor for testing.
contract GovernorTest is Governor {
    constructor(address _timerAddress) public Governor(address(0), true, _timerAddress) {}

    function addPrefix(bytes32 input, bytes32 prefix, uint prefixLength) external pure returns (bytes32 output) {
        return _addPrefix(input, prefix, prefixLength);
    }

    function uintToUtf8(uint v) external pure returns (bytes32 ret) {
        return _uintToUtf8(v);
    }

    function constructIdentifier(uint id) external pure returns (bytes32 identifier) {
        return _constructIdentifier(id);
    }
}

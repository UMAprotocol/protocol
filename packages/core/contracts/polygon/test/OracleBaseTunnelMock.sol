// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../OracleBaseTunnel.sol";

/**
 * @title Test implementation of OracleBaseTunnel enabling unit tests on internal methods.
 * @dev Unit tests should ensure that internal methods `_requestPrice` and `_publishPrice` emit the correct events
 * and modify state as expected.
 */
contract OracleBaseTunnelMock is OracleBaseTunnel {
    constructor(address _finderAddress) OracleBaseTunnel(_finderAddress) {}

    function requestPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public {
        _requestPrice(identifier, time, ancillaryData);
    }

    function encodePriceRequest(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public pure returns (bytes32) {
        return _encodePriceRequest(identifier, time, ancillaryData);
    }

    function publishPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData,
        int256 price
    ) public {
        _publishPrice(identifier, time, ancillaryData, price);
    }
}

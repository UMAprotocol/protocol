// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../OracleBase.sol";

/**
 * @title Test implementation of OracleBase enabling unit tests on internal methods.
 */
contract OracleBaseMock is OracleBase {
    constructor(address _finderAddress) HasFinder(_finderAddress) {}

    function requestPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public returns (bool) {
        return _requestPrice(identifier, time, ancillaryData);
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

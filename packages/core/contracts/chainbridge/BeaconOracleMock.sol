// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "./BeaconOracle.sol";

/**
 * @title Test implementation of BeaconOracle enabling unit tests on internal methods.
 */
contract BeaconOracleMock is BeaconOracle {
    constructor(address _finderAddress, uint8 _chainID) public BeaconOracle(_finderAddress, _chainID) {}

    function requestPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public {
        _requestPrice(currentChainID, identifier, time, ancillaryData);
    }

    function encodePriceRequest(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public view returns (bytes32) {
        return _encodePriceRequest(currentChainID, identifier, time, ancillaryData);
    }

    function publishPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData,
        int256 price
    ) public {
        _publishPrice(currentChainID, identifier, time, ancillaryData, price);
    }

    function getBridge() public view returns (IBridge) {
        return _getBridge();
    }
}

// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.6.0;

import "./BeaconOracle.sol";

/**
 * @title Simple implementation of the OracleInterface that is intended to be deployed on Mainnet and used
 * to communicate price request data cross-chain with Sink Oracles on non-Mainnet networks. An Admin can publish
 * prices to this oracle. An off-chain relayer can subsequently see when prices are published and signal to publish
 * those prices to any non-Mainnet Sink Oracles.
 * @dev This contract should be able to make price requests to the DVM, and the Admin capable of making and publishing
 * price reqests should be an off-chain relayer capable of detecting signals from the non-Mainnet Sink Oracles.
 */
contract SourceOracle is BeaconOracle {
    constructor(address _finderAddress) public BeaconOracle(_finderAddress) {}

    function requestPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public override {
        _requestPrice(identifier, time, ancillaryData);
        _getOracle().requestPrice(identifier, time, ancillaryData);
    }

    function pushPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData,
        int256 price
    ) public {
        _pushPrice(identifier, time, ancillaryData, price);

        // TODO: Call Bridge.deposit() to intiate cross-chain publishing of price request.
        // _getBridge().deposit(formattedMetadata);
    }
}

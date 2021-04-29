// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.6.0;

import "./BeaconOracle.sol";
import "../oracle/interfaces/OracleAncillaryInterface.sol";

/**
 * @title Simple implementation of the OracleInterface that is intended to be deployed on Mainnet and used
 * to communicate price request data cross-chain with Sink Oracles on non-Mainnet networks. An Admin can publish
 * prices to this oracle. An off-chain relayer can subsequently see when prices are published and signal to publish
 * those prices to any non-Mainnet Sink Oracles.
 * @dev This contract should be able to make price requests to the DVM, and the Admin capable of making and publishing
 * price reqests should be an off-chain relayer capable of detecting signals from the non-Mainnet Sink Oracles.
 */
contract SourceOracle is BeaconOracle {
    constructor(address _finderAddress, uint8 _chainID) public BeaconOracle(_finderAddress, _chainID) {}

    // This function will be called by the GenericHandler upon a deposit to ensure that the deposit is arising from a
    // real price request. This method will revert unless the price request has been resolved by a registered contract.
    function validateDeposit(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public view {
        bytes32 priceRequestId = _encodePriceRequest(identifier, time, ancillaryData);
        Price storage lookup = prices[priceRequestId];
        require(lookup.state == RequestState.Resolved, "Price has not been published");
    }

    // Should be callable only by GenericHandler following a bridged price request from a Sink Oracle.
    function requestPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public onlyGenericHandlerContract() {
        _requestPrice(identifier, time, ancillaryData);
        _getOracle().requestPrice(identifier, time, ancillaryData);
    }

    // Stores `price` assuming that it is the same price resolved on DVM for this unique request.
    function publishPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData,
        int256 price
    ) public {
        require(_getOracle().hasPrice(identifier, time, ancillaryData), "DVM has not resolved price");
        require(_getOracle().getPrice(identifier, time, ancillaryData) == price, "DVM resolved different price");
        _publishPrice(identifier, time, ancillaryData, price);

        // TODO: Call Bridge.deposit() to intiate cross-chain publishing of price request.
        // _getBridge().deposit(formattedMetadata);
    }

    function _getOracle() internal view returns (OracleAncillaryInterface) {
        return OracleAncillaryInterface(finder.getImplementationAddress(OracleInterfaces.Oracle));
    }
}

// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../data-verification-mechanism/interfaces/FinderInterface.sol";
import "../data-verification-mechanism/implementation/Constants.sol";

/**
 * @notice Enforces lifecycle of price requests for deriving contract.
 */
abstract contract OracleBaseTunnel {
    enum RequestState { NeverRequested, Requested, Resolved }

    struct Price {
        RequestState state;
        int256 price;
    }

    // Mapping of encoded price requests {identifier, time, ancillaryData} to Price objects.
    mapping(bytes32 => Price) internal prices;

    // Finder to provide addresses for DVM system contracts.
    FinderInterface public finder;

    event PriceRequestAdded(bytes32 indexed identifier, uint256 time, bytes ancillaryData, bytes32 indexed requestHash);
    event PushedPrice(
        bytes32 indexed identifier,
        uint256 time,
        bytes ancillaryData,
        int256 price,
        bytes32 indexed requestHash
    );

    /**
     * @notice Constructor.
     * @param _finderAddress finder to use to get addresses of DVM contracts.
     */
    constructor(address _finderAddress) {
        finder = FinderInterface(_finderAddress);
    }

    /**
     * @notice Enqueues a request (if a request isn't already present) for the given (identifier, time,
     * ancillary data) combination. Will only emit an event if the request has never been requested.
     */
    function _requestPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) internal {
        bytes32 priceRequestId = _encodePriceRequest(identifier, time, ancillaryData);
        Price storage lookup = prices[priceRequestId];
        if (lookup.state == RequestState.NeverRequested) {
            lookup.state = RequestState.Requested;
            emit PriceRequestAdded(identifier, time, ancillaryData, priceRequestId);
        }
    }

    /**
     * @notice Publishes price for a requested query. Will only emit an event if the request has never been resolved.
     */
    function _publishPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData,
        int256 price
    ) internal {
        bytes32 priceRequestId = _encodePriceRequest(identifier, time, ancillaryData);
        Price storage lookup = prices[priceRequestId];
        if (lookup.state == RequestState.Resolved) return;
        lookup.price = price;
        lookup.state = RequestState.Resolved;
        emit PushedPrice(identifier, time, ancillaryData, lookup.price, priceRequestId);
    }

    /**
     * @notice Returns the convenient way to store price requests, uniquely identified by {identifier, time,
     * ancillaryData }.
     */
    function _encodePriceRequest(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(identifier, time, ancillaryData));
    }
}

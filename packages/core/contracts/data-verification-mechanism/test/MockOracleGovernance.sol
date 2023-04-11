// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../interfaces/OracleGovernanceInterface.sol";
import "./MockOracleAncillary.sol";

// A mock oracle used for testing.
contract MockOracleGovernance is MockOracleAncillary {
    constructor(address _finderAddress, address _timerAddress) MockOracleAncillary(_finderAddress, _timerAddress) {}

    // Enqueues a governance request (if a request isn't already present) for the given (identifier, time) pair.
    function requestGovernanceAction(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public {
        _requestPrice(identifier, time, ancillaryData, true);
    }

    function _requestPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData,
        bool isGovernance
    ) internal {
        require(isGovernance || _getIdentifierWhitelist().isIdentifierSupported(identifier));
        bytes32 requestId = _encodePriceRequest(identifier, time, ancillaryData);
        Price storage lookup = verifiedPrices[requestId];
        if (!lookup.isAvailable && !queryIndices[requestId].isValid) {
            // New query, enqueue it for review.
            queryIndices[requestId] = QueryIndex(true, requestedPrices.length);
            QueryPoint memory queryPoint = QueryPoint(identifier, time, ancillaryData);
            requestedPrices.push(queryPoint);
            emit PriceRequestAdded(msg.sender, identifier, time, ancillaryData, requestId);
        }
    }
}

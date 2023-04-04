// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../../common/implementation/Testable.sol";
import "../interfaces/OracleInterface.sol";
import "../interfaces/IdentifierWhitelistInterface.sol";
import "../interfaces/FinderInterface.sol";
import "../implementation/Constants.sol";

// A mock oracle used for testing.
contract MockOracle is OracleInterface, Testable {
    // Represents an available price. Have to keep a separate bool to allow for price=0.
    struct Price {
        bool isAvailable;
        int256 price;
        // Time the verified price became available.
        uint256 verifiedTime;
    }

    // The two structs below are used in an array and mapping to keep track of prices that have been requested but are
    // not yet available.
    struct QueryIndex {
        bool isValid;
        uint256 index;
    }

    // Represents a (identifier, time) point that has been queried.
    struct QueryPoint {
        bytes32 identifier;
        uint256 time;
    }

    // Reference to the Finder.
    FinderInterface private finder;

    // Maps request IDs to their resolved Price structs.
    mapping(bytes32 => Price) private verifiedPrices;

    // Maps request IDs to their pending QueryIndex structs.
    mapping(bytes32 => QueryIndex) private queryIndices;

    // Array of pending QueryPoint structs.
    QueryPoint[] private requestedPrices;

    event PriceRequestAdded(
        address indexed requester,
        bytes32 indexed identifier,
        uint256 time,
        bytes32 indexed requestId
    );
    event PushedPrice(
        address indexed pusher,
        bytes32 indexed identifier,
        uint256 time,
        int256 price,
        bytes32 indexed requestId
    );

    constructor(address _finderAddress, address _timerAddress) Testable(_timerAddress) {
        finder = FinderInterface(_finderAddress);
    }

    // Enqueues a request (if a request isn't already present) for the given (identifier, time) pair.

    function requestPrice(bytes32 identifier, uint256 time) public override {
        require(_getIdentifierWhitelist().isIdentifierSupported(identifier));
        bytes32 requestId = _encodePriceRequest(identifier, time);
        Price storage lookup = verifiedPrices[requestId];
        if (!lookup.isAvailable && !queryIndices[requestId].isValid) {
            // New query, enqueue it for review.
            queryIndices[requestId] = QueryIndex(true, requestedPrices.length);
            requestedPrices.push(QueryPoint(identifier, time));
            emit PriceRequestAdded(msg.sender, identifier, time, requestId);
        }
    }

    // Pushes the verified price for a requested query.
    function pushPrice(
        bytes32 identifier,
        uint256 time,
        int256 price
    ) public {
        bytes32 requestId = _encodePriceRequest(identifier, time);
        verifiedPrices[requestId] = Price(true, price, getCurrentTime());

        QueryIndex storage queryIndex = queryIndices[requestId];
        require(queryIndex.isValid, "Can't push prices that haven't been requested");
        // Delete from the array. Instead of shifting the queries over, replace the contents of `indexToReplace` with
        // the contents of the last index (unless it is the last index).
        uint256 indexToReplace = queryIndex.index;
        delete queryIndices[requestId];
        uint256 lastIndex = requestedPrices.length - 1;
        if (lastIndex != indexToReplace) {
            QueryPoint storage queryToCopy = requestedPrices[lastIndex];
            queryIndices[_encodePriceRequest(queryToCopy.identifier, queryToCopy.time)].index = indexToReplace;
            requestedPrices[indexToReplace] = queryToCopy;
        }
        requestedPrices.pop();

        emit PushedPrice(msg.sender, identifier, time, price, requestId);
    }

    // Wrapper function to push the verified price by request ID.
    function pushPriceByRequestId(bytes32 requestId, int256 price) external {
        QueryPoint memory queryPoint = getRequestParameters(requestId);
        pushPrice(queryPoint.identifier, queryPoint.time, price);
    }

    // Checks whether a price has been resolved.
    function hasPrice(bytes32 identifier, uint256 time) public view override returns (bool) {
        Price storage lookup = verifiedPrices[_encodePriceRequest(identifier, time)];
        return lookup.isAvailable;
    }

    // Gets a price that has already been resolved.
    function getPrice(bytes32 identifier, uint256 time) public view override returns (int256) {
        Price storage lookup = verifiedPrices[_encodePriceRequest(identifier, time)];
        require(lookup.isAvailable);
        return lookup.price;
    }

    // Gets the queries that still need verified prices.
    function getPendingQueries() external view returns (QueryPoint[] memory) {
        return requestedPrices;
    }

    // Gets the request parameters by request ID.
    function getRequestParameters(bytes32 requestId) public view returns (QueryPoint memory) {
        QueryIndex storage queryIndex = queryIndices[requestId];
        require(queryIndex.isValid, "Request ID not found");
        return requestedPrices[queryIndex.index];
    }

    function _getIdentifierWhitelist() private view returns (IdentifierWhitelistInterface supportedIdentifiers) {
        return IdentifierWhitelistInterface(finder.getImplementationAddress(OracleInterfaces.IdentifierWhitelist));
    }

    // Returns an encoded bytes32 representing a price request ID. Used when storing/referencing price requests.
    function _encodePriceRequest(bytes32 identifier, uint256 time) internal pure returns (bytes32) {
        return keccak256(abi.encode(identifier, time));
    }
}

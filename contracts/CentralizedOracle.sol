/*
  CentralizedOracle implementation.

  Implementation of OracleInterface that allows the owner to provide verified prices.
*/
pragma solidity ^0.5.0;

pragma experimental ABIEncoderV2;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import "./AdminInterface.sol";
import "./OracleInterface.sol";
import "./RegistryInterface.sol";
import "./Testable.sol";


// Implements an oracle that allows the owner to push prices for queries that have been made.
contract CentralizedOracle is OracleInterface, Ownable, Testable {
    using SafeMath for uint;

    // This contract doesn't implement the voting routine, and naively indicates that all requested prices will be
    // available in a week.
    uint constant private SECONDS_IN_WEEK = 60*60*24*7;

    // Represents an available price. Have to keep a separate bool to allow for price=0.
    struct Price {
        bool isAvailable;
        int price;
        // Time the verified price became available.
        uint verifiedTime;
    }

    // The two structs below are used in an array and mapping to keep track of prices that have been requested but are
    // not yet available.
    struct QueryIndex {
        bool isValid;
        uint index;
    }

    // Represents a (identifier, time) point that has been queried.
    struct QueryPoint {
        bytes32 identifier;
        uint time;
    }

    // The set of identifiers the oracle can provide verified prices for.
    mapping(bytes32 => bool) private supportedIdentifiers;

    // Conceptually we want a (time, identifier) -> price map.
    mapping(bytes32 => mapping(uint => Price)) private verifiedPrices;

    // The mapping and array allow retrieving all the elements in a mapping and finding/deleting elements.
    // Is there a generalize this data structure?
    mapping(bytes32 => mapping(uint => QueryIndex)) private queryIndices;
    QueryPoint[] private requestedPrices;

    // Registry to verify that a derivative is approved to use the Oracle.
    RegistryInterface private registry;

    constructor(address _registry, bool _isTest) public Testable(_isTest) {
        registry = RegistryInterface(_registry);
    }

    // Gets the price if available, else enqueues a request (if a request isn't already present).
    function getPrice(bytes32 identifier, uint time)
        external
        returns (uint timeForPrice, int price, uint verifiedTime)
    {
        require(supportedIdentifiers[identifier]);

        // Ensure that the caller has been registered with the Oracle before processing the request.
        require(registry.isDerivativeRegistered(msg.sender));

        Price storage lookup = verifiedPrices[identifier][time];
        if (lookup.isAvailable) {
            // We already have a price, return it.
            return (time, lookup.price, lookup.verifiedTime);
        } else if (queryIndices[identifier][time].isValid) {
            // We already have a pending query, don't need to do anything.
            return (0, 0, getCurrentTime().add(SECONDS_IN_WEEK));
        } else {
            // New query, enqueue it for review.
            queryIndices[identifier][time] = QueryIndex(true, requestedPrices.length);
            requestedPrices.push(QueryPoint(identifier, time));
            emit VerifiedPriceRequested(identifier, time);
            return (0, 0, getCurrentTime().add(SECONDS_IN_WEEK));
        }
    }

    // Pushes the verified price for a requested query.
    function pushPrice(bytes32 identifier, uint time, int price) external onlyOwner {
        verifiedPrices[identifier][time] = Price(true, price, getCurrentTime());
        emit VerifiedPriceAvailable(identifier, time, price);

        QueryIndex storage queryIndex = queryIndices[identifier][time];
        require(queryIndex.isValid, "Can't push prices that haven't been requested");
        // Delete from the array. Instead of shifting the queries over, replace the contents of `indexToReplace` with
        // the the contents of the last index (unless it is the last index).
        uint indexToReplace = queryIndex.index;
        delete queryIndices[identifier][time];
        uint lastIndex = requestedPrices.length.sub(1);
        if (lastIndex != indexToReplace) {
            QueryPoint storage queryToCopy = requestedPrices[lastIndex];
            queryIndices[queryToCopy.identifier][queryToCopy.time].index = indexToReplace;
            requestedPrices[indexToReplace] = queryToCopy;
        }
        requestedPrices.length = requestedPrices.length.sub(1);
    }

    // Adds the provided identifier as a supported identifier.
    function addSupportedIdentifier(bytes32 identifier) external onlyOwner {
        supportedIdentifiers[identifier] = true;
    }

    // Calls emergencyShutdown() on the provided derivative.
    function callEmergencyShutdown(address derivative) external onlyOwner {
        AdminInterface admin = AdminInterface(derivative);
        admin.emergencyShutdown();
    }

    // Calls remargin() on the provided derivative.
    function callRemargin(address derivative) external onlyOwner {
        AdminInterface admin = AdminInterface(derivative);
        admin.remargin();
    }

    // Gets the queries that still need verified prices.
    function getPendingQueries() external view onlyOwner returns (QueryPoint[] memory queryPoints) {
        return requestedPrices;
    }

    // Whether the oracle provides verified prices for the provided identifier.
    function isIdentifierSupported(bytes32 identifier) external view returns (bool isSupported) {
        return supportedIdentifiers[identifier];
    }
}

/*
  CentralizedOracle implementation.

  Implementation of V2OracleInterface that allows the owner to provide verified prices.
*/
pragma solidity ^0.5.0;

pragma experimental ABIEncoderV2;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import "./V2OracleInterface.sol";


// Implements an oracle that allows the owner to push prices for queries that have been made.
contract CentralizedOracle is V2OracleInterface, Ownable {
    using SafeMath for uint;

    // This contract doesn't implement the voting routine, and naively indicates that all requested prices will be
    // available in a week.
    uint constant private SECONDS_IN_WEEK = 60*60*24*7;

    // Represents an available price. Have to keep a separate bool to allow for price=0.
    struct Price {
        bool isAvailable;
        int price;
    }

    // The two structs below are used in an array and mapping to keep track of prices that have been requested but are
    // not yet available.
    struct QueryIndex {
        bool isAvailable;
        uint index;
    }

    // Represents a (symbol, time) point that has been queried.
    struct QueryPoint {
        bytes32 symbol;
        uint time;
    }

    // Conceptually we want a (time, symbol) -> price map.
    mapping(bytes32 => mapping(uint => Price)) private verifiedPrices;

    // The mapping and array allow retrieving all the elements in a mapping and finding/deleting elements.
    // Is there a generalize this data structure?
    mapping(bytes32 => mapping(uint => QueryIndex)) private queryIndices;
    QueryPoint[] private needsReview;

    // Gets the price if available, else enqueues a request (if a request isn't already present).
    function getPrice(bytes32 symbol, uint time) external returns (uint timeForPrice, int price, uint verifiedTime) {
        // TODO(ptare): Add verification via the registry for the caller.
        Price storage lookup = verifiedPrices[symbol][time];
        if (lookup.isAvailable) {
            // We already have a price, return it.
            return (time, lookup.price, 0);
        } else if (queryIndices[symbol][time].isAvailable) {
            // We already have a pending query, don't need to do anything.
            return (0, 0, SECONDS_IN_WEEK);
        } else {
            // New query, enqueue it for review.
            queryIndices[symbol][time] = QueryIndex(true, needsReview.length);
            needsReview.push(QueryPoint(symbol, time));
            emit VerifiedPriceRequested(symbol, time);
            return (0, 0, SECONDS_IN_WEEK);
        }
    }

    // Should this take an array for multiple prices?
    function pushPrice(bytes32 symbol, uint time, int price) external onlyOwner {
        verifiedPrices[symbol][time] = Price(true, price);

        QueryIndex storage queryIndex = queryIndices[symbol][time];
        require(queryIndex.isAvailable, "Can't push prices that haven't been requested");
        // Delete from the array. Instead of shifting the queries over, replace the contents of `indexToReplace` with
        // the the contents of the last index (unless it is the last index).
        uint indexToReplace = queryIndex.index;
        delete queryIndices[symbol][time];
        uint lastIndex = needsReview.length - 1;
        if (lastIndex != indexToReplace) {
            QueryPoint storage queryToCopy = needsReview[lastIndex];
            queryIndices[queryToCopy.symbol][queryToCopy.time].index = indexToReplace;
            needsReview[indexToReplace] = queryToCopy;
        }
        delete needsReview[lastIndex];
        needsReview.length = needsReview.length.sub(1);
    }

    // Is this useful? Does it save on gas by being a view function? Or does having this extra function waste bytes in
    // the contract itself?
    function isPriceAvailable(uint time, bytes32 symbol) external view returns (bool isAvailable) {
        return verifiedPrices[symbol][time].isAvailable;
    }

    function getPriceKnownToBeAvailable(uint time, bytes32 symbol)
            external
            view
        returns (uint timeForPrice, int price) {
            require(verifiedPrices[symbol][time].isAvailable);
            return (time, verifiedPrices[symbol][time].price);
        }

    // Gets the queries that still need verified prices.
    function getPendingQueries() external view onlyOwner returns (QueryPoint[] memory queryPoints) {
        return needsReview;
    }

    // An event fired when a request for a (symbol, time) pair is made.
    event VerifiedPriceRequested(bytes32 indexed symbol, uint time);
}

// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "../oracle/interfaces/OracleAncillaryInterface.sol";
import "../common/implementation/MultiRole.sol";
import "../oracle/interfaces/FinderInterface.sol";
import "./IBridge.sol";
import "../oracle/implementation/Constants.sol";

/**
 * @title Simple implementation of the OracleInterface used to communicate price request data cross-chain between
 * EVM networks. Can be extended either into a "Source" or "Sink" oracle. The intention is that the "Source" Oracle
 * is the originator of price resolution data, secured by the DVM, and the "Sink" Oracle can both receive this price
 * resolution data and request prices cross-chain to the "Source" Oracle. The "Sink" is designed to be deployed on
 * non-Mainnet networks and the "Source" should be deployed on Mainnet.
 */
abstract contract BeaconOracle is OracleAncillaryInterface, MultiRole {
    enum Roles {
        Owner, // The owner manages the other roles.
        Requester, // Can make price requests.
        Publisher // Can publish price request results.
    }

    struct Price {
        bool isAvailable;
        int256 price;
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
        bytes ancillaryData;
    }

    // Conceptually we want a (time, identifier, ancillaryData) -> price map.
    mapping(bytes32 => mapping(uint256 => mapping(bytes => Price))) internal verifiedPrices;

    // The mapping and array allow retrieving all the elements in a mapping and finding/deleting elements.
    // Can we generalize this data structure?
    mapping(bytes32 => mapping(uint256 => mapping(bytes => QueryIndex))) internal queryIndices;

    QueryPoint[] public requestedPrices;

    // Finder to provide addresses for DVM contracts.
    FinderInterface public finder;

    event PriceRequestAdded(address indexed requester, bytes32 indexed identifier, uint256 time, bytes ancillaryData);
    event PushedPrice(
        address indexed pusher,
        bytes32 indexed identifier,
        uint256 time,
        bytes ancillaryData,
        int256 price
    );

    /**
     * @notice Constructor.
     * @param _finderAddress finder to use to get addresses of DVM contracts.
     */
    constructor(address _finderAddress) public {
        finder = FinderInterface(_finderAddress);
    }

    /**
     * @notice Enqueues a request (if a request isn't already present) for the given (identifier, time, ancillary data)
     * pair.
     * @dev If this is a SinkOracle, then this should be called by an OptimisticOracle on same network that wants to
     * bubble up price request to the Mainnet DVM. If this is a SourceOracle, it will pass on the request to the DVM.
     */
    function _requestPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) internal onlyRoleHolder(uint256(Roles.Requester)) {
        Price storage lookup = verifiedPrices[identifier][time][ancillaryData];
        if (!lookup.isAvailable && !queryIndices[identifier][time][ancillaryData].isValid) {
            // New query, enqueue it for review.
            queryIndices[identifier][time][ancillaryData] = QueryIndex(true, requestedPrices.length);
            requestedPrices.push(QueryPoint(identifier, time, ancillaryData));
            emit PriceRequestAdded(msg.sender, identifier, time, ancillaryData);
        }
    }

    /**
     * @notice Pushes the verified price for a requested query.
     * @dev Should be called by an off-chain relayer who saw a price resolved on a different network's Source or Sink
     * Oracle.
     */
    function _pushPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData,
        int256 price
    ) internal onlyRoleHolder(uint256(Roles.Publisher)) {
        verifiedPrices[identifier][time][ancillaryData] = Price(true, price);

        QueryIndex storage queryIndex = queryIndices[identifier][time][ancillaryData];
        require(queryIndex.isValid, "Can't push prices that haven't been requested");
        // Delete from the array. Instead of shifting the queries over, replace the contents of `indexToReplace` with
        // the contents of the last index (unless it is the last index).
        uint256 indexToReplace = queryIndex.index;
        delete queryIndices[identifier][time][ancillaryData];
        uint256 lastIndex = requestedPrices.length - 1;
        if (lastIndex != indexToReplace) {
            QueryPoint storage queryToCopy = requestedPrices[lastIndex];
            queryIndices[queryToCopy.identifier][queryToCopy.time][queryToCopy.ancillaryData].index = indexToReplace;
            requestedPrices[indexToReplace] = queryToCopy;
        }

        emit PushedPrice(msg.sender, identifier, time, ancillaryData, price);
    }

    // Checks whether a price has been resolved.
    function hasPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public view override returns (bool) {
        Price storage lookup = verifiedPrices[identifier][time][ancillaryData];
        return lookup.isAvailable;
    }

    // Gets a price that has already been resolved.
    function getPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public view override returns (int256) {
        Price storage lookup = verifiedPrices[identifier][time][ancillaryData];
        require(lookup.isAvailable);
        return lookup.price;
    }

    function _getOracle() internal view returns (OracleAncillaryInterface) {
        return OracleAncillaryInterface(finder.getImplementationAddress(OracleInterfaces.Oracle));
    }

    function _getBridge() internal view returns (IBridge) {
        return IBridge(finder.getImplementationAddress(OracleInterfaces.Bridge));
    }
}

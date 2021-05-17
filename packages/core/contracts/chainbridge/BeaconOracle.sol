// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../oracle/interfaces/FinderInterface.sol";
import "./IBridge.sol";
import "../oracle/implementation/Constants.sol";

/**
 * @title Simple implementation of the OracleInterface used to communicate price request data cross-chain between
 * EVM networks. Can be extended either into a "Source" or "Sink" oracle that specializes in making and resolving
 * cross-chain price requests, respectivly. The "Source" Oracle is the originator or source of price resolution data
 * and can only resolve prices already published by the DVM. The "Sink" Oracle receives the price resolution data
 * from the Source Oracle and makes it available on non-Mainnet chains. The "Sink" Oracle can also be used to trigger
 * price requests from the DVM on Mainnet.
 */
abstract contract BeaconOracle {
    enum RequestState { NeverRequested, Requested, Resolved }

    struct Price {
        RequestState state;
        int256 price;
    }

    // Chain ID for this Oracle.
    uint8 public currentChainID;

    // Mapping of encoded price requests {identifier, time, ancillaryData} to Price objects.
    mapping(bytes32 => Price) internal prices;

    // Finder to provide addresses for DVM system contracts.
    FinderInterface public finder;

    event PriceRequestAdded(
        address indexed requester,
        uint8 indexed chainID,
        bytes32 indexed identifier,
        uint256 time,
        bytes ancillaryData
    );
    event PushedPrice(
        address indexed pusher,
        uint8 indexed chainID,
        bytes32 indexed identifier,
        uint256 time,
        bytes ancillaryData,
        int256 price
    );

    /**
     * @notice Constructor.
     * @param _finderAddress finder to use to get addresses of DVM contracts.
     */
    constructor(address _finderAddress, uint8 _chainID) {
        finder = FinderInterface(_finderAddress);
        currentChainID = _chainID;
    }

    // We assume that there is only one GenericHandler for this network.
    modifier onlyGenericHandlerContract() {
        require(
            msg.sender == finder.getImplementationAddress(OracleInterfaces.GenericHandler),
            "Caller must be GenericHandler"
        );
        _;
    }

    /**
     * @notice Enqueues a request (if a request isn't already present) for the given (identifier, time, ancillary data)
     * pair. Will revert if request has been requested already.
     */
    function _requestPrice(
        uint8 chainID,
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) internal {
        bytes32 priceRequestId = _encodePriceRequest(chainID, identifier, time, ancillaryData);
        Price storage lookup = prices[priceRequestId];
        if (lookup.state == RequestState.NeverRequested) {
            // New query, change state to Requested:
            lookup.state = RequestState.Requested;
            emit PriceRequestAdded(msg.sender, chainID, identifier, time, ancillaryData);
        }
    }

    /**
     * @notice Publishes price for a requested query. Will revert if request hasn't been requested yet or has been
     * resolved already.
     */
    function _publishPrice(
        uint8 chainID,
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData,
        int256 price
    ) internal {
        bytes32 priceRequestId = _encodePriceRequest(chainID, identifier, time, ancillaryData);
        Price storage lookup = prices[priceRequestId];
        require(lookup.state == RequestState.Requested, "Price request is not currently pending");
        lookup.price = price;
        lookup.state = RequestState.Resolved;
        emit PushedPrice(msg.sender, chainID, identifier, time, ancillaryData, lookup.price);
    }

    /**
     * @notice Returns Bridge contract on network.
     */
    function _getBridge() internal view returns (IBridge) {
        return IBridge(finder.getImplementationAddress(OracleInterfaces.Bridge));
    }

    /**
     * @notice Returns the convenient way to store price requests, uniquely identified by {chainID, identifier, time,
     * ancillaryData }.
     */
    function _encodePriceRequest(
        uint8 chainID,
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(chainID, identifier, time, ancillaryData));
    }
}

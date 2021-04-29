// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "../oracle/interfaces/FinderInterface.sol";
import "./IBridge.sol";
import "../oracle/implementation/Constants.sol";
import "../oracle/interfaces/OracleAncillaryInterface.sol";

/**
 * @title Simple implementation of the OracleInterface used to communicate price request data cross-chain between
 * EVM networks. Can be extended either into a "Source" or "Sink" oracle. The intention is that the "Source" Oracle
 * is the originator of price resolution data, secured by the DVM, and the "Sink" Oracle can both receive this price
 * resolution data and request prices cross-chain to the "Source" Oracle. The "Sink" is designed to be deployed on
 * non-Mainnet networks and the "Source" should be deployed on Mainnet.
 */
abstract contract BeaconOracle is OracleAncillaryInterface {
    enum RequestState { NeverRequested, Requested, Resolved }

    struct Price {
        RequestState state;
        int256 price;
    }

    // Mapping of encoded price requests {identifier, time, ancillaryData} to Prices.
    mapping(bytes32 => Price) internal prices;

    // Finder to provide addresses for DVM contracts.
    FinderInterface public finder;
    // Chain ID for this Beacon Oracle. Used to construct ResourceID along with this contract address.
    uint8 public chainID;

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
    constructor(address _finderAddress, uint8 _chainID) public {
        finder = FinderInterface(_finderAddress);
        chainID = _chainID;
    }

    modifier onlyGenericHandlerContract() {
        require(
            msg.sender == finder.getImplementationAddress(OracleInterfaces.GenericHandler),
            "Caller must be GenericHandler"
        );
        _;
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
    ) internal {
        bytes32 priceRequestId = _encodePriceRequest(identifier, time, ancillaryData);
        Price storage lookup = prices[priceRequestId];
        require(lookup.state == RequestState.NeverRequested, "Price has already been requested");
        // New query, change state to Requested:
        lookup.state = RequestState.Requested;
        emit PriceRequestAdded(msg.sender, identifier, time, ancillaryData);
    }

    /**
     * @notice Publishes price for a requested query.
     * @dev Should be called by an off-chain relayer who saw a price resolved on a different network's Source or Sink
     * Oracle.
     */
    function _publishPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData,
        int256 price
    ) internal {
        bytes32 priceRequestId = _encodePriceRequest(identifier, time, ancillaryData);
        Price storage lookup = prices[priceRequestId];
        require(lookup.state == RequestState.Requested, "Price request is not currently pending");
        lookup.price = price;
        lookup.state = RequestState.Resolved;
        emit PushedPrice(msg.sender, identifier, time, ancillaryData, lookup.price);
    }

    // Checks whether a price has been resolved.
    function hasPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public view override returns (bool) {
        bytes32 priceRequestId = _encodePriceRequest(identifier, time, ancillaryData);
        Price storage lookup = prices[priceRequestId];
        if (lookup.state == RequestState.Resolved) {
            return true;
        } else {
            return false;
        }
    }

    // Gets a price that has already been resolved.
    function getPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public view override returns (int256) {
        bytes32 priceRequestId = _encodePriceRequest(identifier, time, ancillaryData);
        Price storage lookup = prices[priceRequestId];
        require(lookup.state == RequestState.Resolved, "Price has not been resolved");
        return lookup.price;
    }

    function _getBridge() internal view returns (IBridge) {
        return IBridge(finder.getImplementationAddress(OracleInterfaces.Bridge));
    }

    function _encodePriceRequest(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(identifier, time, ancillaryData));
    }

    function getResourceId() public view returns (bytes32) {
        return keccak256(abi.encode(address(this), chainID));
    }
}

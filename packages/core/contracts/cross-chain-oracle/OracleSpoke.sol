// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../data-verification-mechanism/interfaces/OracleAncillaryInterface.sol";
import "../data-verification-mechanism/interfaces/OracleInterface.sol";
import "../data-verification-mechanism/interfaces/RegistryInterface.sol";
import "./AncillaryDataCompression.sol";
import "./OracleBase.sol";
import "../common/implementation/AncillaryData.sol";
import "../common/implementation/Lockable.sol";
import "./interfaces/ChildMessengerInterface.sol";
import "./interfaces/ChildMessengerConsumerInterface.sol";
import "./SpokeBase.sol";

/**
 * @title Cross-chain Oracle L2 Oracle Spoke.
 * @notice This contract is primarily intended to receive messages on the child chain from a parent chain and allow
 * contracts deployed on the child chain to interact with this contract as an Oracle. Moreover, this contract gives
 * child chain contracts the ability to trigger cross-chain price requests to the mainnet DVM. This Spoke knows how
 * to communicate with the parent chain via a "ChildMessenger" contract which directly communicates with the
 * "ParentMessenger" on mainnet.
 * @dev The intended client of this contract is an OptimisticOracle on sidechain that needs price
 * resolution secured by the DVM on mainnet.
 */
contract OracleSpoke is
    OracleBase,
    SpokeBase,
    OracleAncillaryInterface,
    OracleInterface,
    ChildMessengerConsumerInterface,
    Lockable
{
    using AncillaryDataCompression for bytes;

    // Mapping of parent request ID to child request ID.
    mapping(bytes32 => bytes32) public childRequestIds;

    event PriceRequestBridged(
        address indexed requester,
        bytes32 identifier,
        uint256 time,
        bytes ancillaryData,
        bytes32 indexed childRequestId,
        bytes32 indexed parentRequestId
    );
    event ResolvedLegacyRequest(
        bytes32 indexed identifier,
        uint256 time,
        bytes ancillaryData,
        int256 price,
        bytes32 indexed requestHash,
        bytes32 indexed legacyRequestHash
    );

    constructor(address _finderAddress) HasFinder(_finderAddress) {}

    // This assumes that the local network has a Registry that resembles the mainnet registry.
    modifier onlyRegisteredContract() {
        RegistryInterface registry = RegistryInterface(finder.getImplementationAddress(OracleInterfaces.Registry));
        require(registry.isContractRegistered(msg.sender), "Caller must be registered");
        _;
    }

    /**
     * @notice This is called to bridge a price request to mainnet. This method will enqueue a new price request
     * or return silently if already requested. Price requests are relayed to mainnet (the "Parent" chain) via the
     * ChildMessenger contract.
     * @dev Can be called only by a registered contract that is allowed to make DVM price requests. Will mark this
     * price request as Requested, and therefore able to receive the price resolution data from mainnet.
     * @dev Contract registration enables the DVM to validate that the calling contract correctly pays final fees.
     * Therefore, this function does not directly attempt to pull a final fee from the caller.
     * @param identifier Identifier of price request.
     * @param time Timestamp of price request.
     * @param ancillaryData extra data of price request.
     */
    function requestPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public override nonReentrant() onlyRegisteredContract() {
        _requestPriceSpoke(identifier, time, ancillaryData);
    }

    /**
     * @notice Overloaded function to provide backwards compatibility for legacy financial contracts that do not use
     * ancillary data.
     */
    function requestPrice(bytes32 identifier, uint256 time) public override nonReentrant() onlyRegisteredContract() {
        _requestPriceSpoke(identifier, time, "");
    }

    function _requestPriceSpoke(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) internal {
        address requester = msg.sender;
        bytes32 childRequestId = _encodeChildPriceRequest(requester, identifier, time, ancillaryData);
        Price storage lookup = prices[childRequestId];

        // Send the request to mainnet only if it has not been requested yet.
        if (lookup.state != RequestState.NeverRequested) return;
        lookup.state = RequestState.Requested;

        // Only the compressed ancillary data is sent to the mainnet. As it includes the request block number that is
        // not available when getting the resolved price, we map the derived request ID.
        bytes memory parentAncillaryData = ancillaryData.compress(requester, block.number);
        bytes32 parentRequestId = _encodePriceRequest(identifier, time, parentAncillaryData);
        childRequestIds[parentRequestId] = childRequestId;

        // Emit all required information so that voters on mainnet can track the origin of the request and full
        // ancillary data by using the parentRequestId that is derived from identifier, time and ancillary data as
        // observed on mainnet.
        emit PriceRequestBridged(requester, identifier, time, ancillaryData, childRequestId, parentRequestId);
        emit PriceRequestAdded(identifier, time, parentAncillaryData, parentRequestId);

        getChildMessenger().sendMessageToParent(abi.encode(identifier, time, parentAncillaryData));
    }

    /**
     * @notice Resolves a price request originating from a message sent by the DVM on the parent chain.
     * @dev Can only be called by the ChildMessenger contract which is designed to communicate only with the
     * ParentMessenger contract on Mainnet. See the SpokeBase for the onlyMessenger modifier.
     * @param data ABI encoded params with which to call `_publishPrice`.
     */
    function processMessageFromParent(bytes memory data) public override nonReentrant() onlyMessenger() {
        (bytes32 identifier, uint256 time, bytes memory ancillaryData, int256 price) =
            abi.decode(data, (bytes32, uint256, bytes, int256));
        bytes32 parentRequestId = _encodePriceRequest(identifier, time, ancillaryData);

        // Resolve the requestId used when requesting and checking the price. The childRequestIds value in the mapping
        // could be uninitialized if the request was originated from:
        // - the previous implementation of this contract, or
        // - another chain and was pushed to this chain by mistake.
        bytes32 priceRequestId = childRequestIds[parentRequestId];
        if (priceRequestId == bytes32(0)) priceRequestId = parentRequestId;
        Price storage lookup = prices[priceRequestId];

        // In order to support resolving the requests initiated from the previous implementation of this contract, we
        // only update the state and emit an event if it has not yet been resolved.
        if (lookup.state == RequestState.Resolved) return;
        lookup.price = price;
        lookup.state = RequestState.Resolved;
        emit PushedPrice(identifier, time, ancillaryData, price, priceRequestId);
    }

    /**
     * @notice This method handles a special case when a price request was originated on the previous implementation of
     * this contract, but was not settled before the upgrade.
     * @dev Duplicates the resolved state from the legacy request to the new request where requester address is also
     * part of request ID derivation. Will revert if the legacy request has not been pushed from mainnet.
     * @param identifier Identifier of price request to resolve.
     * @param time Timestamp of price request to resolve.
     * @param ancillaryData Original ancillary data passed by the requester before stamping by the legacy spoke.
     * @param childRequester Address of the requester that initiated the price request.
     */
    function resolveLegacyRequest(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData,
        address childRequester
    ) external {
        bytes32 legacyRequestId = _encodePriceRequest(identifier, time, _legacyStampAncillaryData(ancillaryData));
        Price storage legacyLookup = prices[legacyRequestId];
        require(legacyLookup.state == RequestState.Resolved, "Price has not been resolved");

        bytes32 priceRequestId = _encodeChildPriceRequest(childRequester, identifier, time, ancillaryData);
        Price storage lookup = prices[priceRequestId];

        // Update the state and emit an event only if the legacy request has not been resolved yet.
        if (lookup.state == RequestState.Resolved) return;
        lookup.price = legacyLookup.price;
        lookup.state = RequestState.Resolved;
        emit ResolvedLegacyRequest(identifier, time, ancillaryData, lookup.price, priceRequestId, legacyRequestId);
    }

    /**
     * @notice Returns whether a price has resolved for the request. This method will not revert.
     * @param identifier Identifier of price request.
     * @param time Timestamp of price request
     * @param ancillaryData extra data of price request.
     * @return True if a price is available, False otherwise. If true, then getPrice will succeed for the request.
     */
    function hasPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public view override nonReentrantView() onlyRegisteredContract() returns (bool) {
        bytes32 priceRequestId = _encodeChildPriceRequest(msg.sender, identifier, time, ancillaryData);
        return prices[priceRequestId].state == RequestState.Resolved;
    }

    /**
     * @notice Overloaded function to provide backwards compatibility for legacy financial contracts that do not use
     * ancillary data.
     */
    function hasPrice(bytes32 identifier, uint256 time)
        public
        view
        override
        nonReentrantView()
        onlyRegisteredContract()
        returns (bool)
    {
        bytes32 priceRequestId = _encodeChildPriceRequest(msg.sender, identifier, time, "");
        return prices[priceRequestId].state == RequestState.Resolved;
    }

    /**
     * @notice Returns resolved price for the request. Reverts if price is not available.
     * @param identifier Identifier of price request.
     * @param time Timestamp of price request
     * @param ancillaryData extra data of price request.
     * @return int256 Price, or reverts if no resolved price for any reason.
     */
    function getPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public view override nonReentrantView() onlyRegisteredContract() returns (int256) {
        bytes32 priceRequestId = _encodeChildPriceRequest(msg.sender, identifier, time, ancillaryData);
        Price storage lookup = prices[priceRequestId];
        require(lookup.state == RequestState.Resolved, "Price has not been resolved");
        return lookup.price;
    }

    /**
     * @notice Overloaded function to provide backwards compatibility for legacy financial contracts that do not use
     * ancillary data.
     */
    function getPrice(bytes32 identifier, uint256 time)
        public
        view
        override
        nonReentrantView()
        onlyRegisteredContract()
        returns (int256)
    {
        bytes32 priceRequestId = _encodeChildPriceRequest(msg.sender, identifier, time, "");
        Price storage lookup = prices[priceRequestId];
        require(lookup.state == RequestState.Resolved, "Price has not been resolved");
        return lookup.price;
    }

    /**
     * @notice Compresses ancillary data by providing sufficient information to track back the original ancillary data
     * mainnet.
     * @dev This is expected to be used in offchain infrastructure when speeding up requests to the mainnet.
     * @param ancillaryData original ancillary data to be processed.
     * @param requester address of the requester who initiated the price request.
     * @param requestBlockNumber block number when the price request was initiated.
     * @return compressed ancillary data if it exceeds the threshold, otherwise metadata is appended at the end.
     */
    function compressAncillaryData(
        bytes memory ancillaryData,
        address requester,
        uint256 requestBlockNumber
    ) external view returns (bytes memory) {
        return ancillaryData.compress(requester, requestBlockNumber);
    }

    /**
     * @dev This replicates the implementation of `_stampAncillaryData` from the previous version of this contract for
     * the purpose of resolving legacy requests if they had not been resolved before the upgrade.
     */
    function _legacyStampAncillaryData(bytes memory ancillaryData) internal view returns (bytes memory) {
        // This contract should stamp the child network's ID so that voters on the parent network can
        // deterministically track unique price requests back to this contract.
        return AncillaryData.appendKeyValueUint(ancillaryData, "childChainId", block.chainid);
    }

    /**
     * @notice Returns the convenient way to store price requests, uniquely identified by {requester, identifier, time,
     * ancillaryData }.
     * @dev Compared to _encodePriceRequest, this method ensures requests are unique also among different requesters.
     */
    function _encodeChildPriceRequest(
        address requester,
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(requester, identifier, time, ancillaryData));
    }
}

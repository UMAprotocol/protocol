// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@maticnetwork/fx-portal/contracts/tunnel/FxBaseChildTunnel.sol";
import "../cross-chain-oracle/AncillaryDataCompression.sol";
import "../data-verification-mechanism/interfaces/OracleAncillaryInterface.sol";
import "../data-verification-mechanism/interfaces/RegistryInterface.sol";
import "./OracleBaseTunnel.sol";
import "../common/implementation/Lockable.sol";

/**
 * @title Adapter deployed on sidechain to give financial contracts the ability to trigger cross-chain price requests to
 * the mainnet DVM. Also has the ability to receive published prices from mainnet. This contract can be treated as the
 * "DVM" for this network, because a calling contract can request and access a resolved price request from this
 * contract.
 * @dev The intended client of this contract is an OptimisticOracle on sidechain that needs price
 * resolution secured by the DVM on mainnet.
 */
contract OracleChildTunnel is OracleBaseTunnel, OracleAncillaryInterface, FxBaseChildTunnel, Lockable {
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

    constructor(address _fxChild, address _finderAddress)
        OracleBaseTunnel(_finderAddress)
        FxBaseChildTunnel(_fxChild)
    {}

    // This assumes that the local network has a Registry that resembles the mainnet registry.
    modifier onlyRegisteredContract() {
        RegistryInterface registry = RegistryInterface(finder.getImplementationAddress(OracleInterfaces.Registry));
        require(registry.isContractRegistered(msg.sender), "Caller must be registered");
        _;
    }

    /**
     * @notice This should be called to bridge a price request to mainnet.
     * @dev Can be called only by a registered contract that is allowed to make DVM price requests. Will mark this
     * price request as Requested, and therefore able to receive the price resolution data from mainnet. Emits a message
     * that will be included in regular checkpoint of all sidechain transactions to mainnet.
     * @param identifier Identifier of price request.
     * @param time Timestamp of price request.
     * @param ancillaryData extra data of price request.
     */
    function requestPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public override nonReentrant() onlyRegisteredContract() {
        address requester = msg.sender;
        bytes32 childRequestId = _encodeChildPriceRequest(requester, identifier, time, ancillaryData);
        Price storage lookup = prices[childRequestId];

        // Send the request to mainnet if it has not been requested yet.
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

        _sendMessageToRoot(abi.encode(identifier, time, parentAncillaryData));
    }

    /**
     * @notice Resolves a price request.
     * @dev The data will be received automatically from the state receiver when the state is synced between Ethereum
     * and Polygon. This will revert if the Root chain sender is not the `fxRootTunnel` contract.
     * @param sender The sender of `data` from the Root chain.
     * @param data ABI encoded params with which to call `_publishPrice`.
     */
    function _processMessageFromRoot(
        uint256, /* stateId */
        address sender,
        bytes memory data
    ) internal override validateSender(sender) {
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
        bytes32 legacyRequestId =
            _encodePriceRequest(identifier, time, _legacyStampAncillaryData(ancillaryData, childRequester));
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
     * @notice Returns whether a price has resolved for the request.
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
     * @notice Returns resolved price for the request.
     * @dev Reverts if price is not available.
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
    function _legacyStampAncillaryData(bytes memory ancillaryData, address requester)
        internal
        view
        returns (bytes memory)
    {
        // Price requests that originate from this method, on Polygon, will ultimately be submitted to the DVM on
        // Ethereum via the OracleRootTunnel. Therefore this contract should stamp its requester's address in the
        // ancillary data so voters can conveniently track the requests path to the DVM.
        return
            AncillaryData.appendKeyValueUint(
                AncillaryData.appendKeyValueAddress(ancillaryData, "childRequester", requester),
                "childChainId",
                block.chainid
            );
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

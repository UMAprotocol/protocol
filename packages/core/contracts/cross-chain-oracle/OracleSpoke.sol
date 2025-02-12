// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../data-verification-mechanism/interfaces/OracleAncillaryInterface.sol";
import "../data-verification-mechanism/interfaces/OracleInterface.sol";
import "../data-verification-mechanism/interfaces/RegistryInterface.sol";
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
    // Compressing the ancillary data adds additional key-value pairs compared to the stamping method so that its easier
    // to track back the original request when voting on mainnet. Actual threshold when compression would produce
    // shorter data varies depending on the number of decimal digits of chainId and block number, but 256 bytes has a
    // safe margin ensuring that the compression will not be longer than stamping.
    uint256 public constant compressAncillaryBytesThreshold = 256;

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
        _requestPrice(identifier, time, ancillaryData);
    }

    /**
     * @notice Overloaded function to provide backwards compatibility for legacy financial contracts that do not use
     * ancillary data.
     */
    function requestPrice(bytes32 identifier, uint256 time) public override nonReentrant() onlyRegisteredContract() {
        _requestPrice(identifier, time, "");
    }

    function _requestPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) internal {
        // Append requester and chainId so that the request is unique.
        address requester = msg.sender;
        bytes memory childAncillaryData = _stampAncillaryData(ancillaryData, requester);
        bytes32 childRequestId = _encodePriceRequest(identifier, time, childAncillaryData);

        // Send the request to mainnet if it has not been requested yet.
        Price storage lookup = prices[childRequestId];
        if (lookup.state == RequestState.NeverRequested) {
            lookup.state = RequestState.Requested;

            // Longer ancillary data is compressed to save gas on the mainnet.
            bytes memory parentAncillaryData = _stampOrCompressAncillaryData(ancillaryData, requester, block.number);
            bytes32 parentRequestId = _encodePriceRequest(identifier, time, parentAncillaryData);

            // There is no need to store the childRequestId in the mapping if the parentRequestId is the same since this
            // contract would fallback to the parentRequestId when receiving the resolved price.
            if (parentRequestId != childRequestId) childRequestIds[parentRequestId] = childRequestId;

            // In case of longer ancillary data, only its compressed representation is bridged to mainnet. In any case,
            // emit all required information so that voters on mainnet can track the origin of the request and full
            // ancillary data by using the parentRequestId that is derived from identifier, time and ancillary data as
            // observed on mainnet.
            emit PriceRequestBridged(requester, identifier, time, childAncillaryData, childRequestId, parentRequestId);

            getChildMessenger().sendMessageToParent(abi.encode(identifier, time, parentAncillaryData));
        }
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

        // Resolve the requestId used when requesting and checking the price. This could differ from the parent if the
        // ancillary data was compressed when sending to the mainnet. The childRequestIds value in the mapping could
        // be uninitialized in the following cases:
        // - Ancillary data was not compressed, so requestId would be the same.
        // - The request was originated from the previous implementation of this contract.
        // - The request was originated from another chain and was pushed to this chain by mistake.
        bytes32 priceRequestId = childRequestIds[parentRequestId];
        if (priceRequestId == bytes32(0)) priceRequestId = parentRequestId;

        // In order to support resolving the requests initiated from the previous implementation of this contract, we
        // only check if it has not yet been resolved (can be NeverRequested).
        Price storage lookup = prices[priceRequestId];
        if (lookup.state != RequestState.Resolved) {
            lookup.price = price;
            lookup.state = RequestState.Resolved;
            emit PushedPrice(identifier, time, ancillaryData, price, priceRequestId);
        }
    }

    /**
     * @notice This method handles a special case when a price request was originated on the previous implementation of
     * this contract, but was not settled before the upgrade.
     * @dev Duplicates the resolved state from the legacy request to the new request where requester address is now
     * appended. Will revert if the legacy request has not been pushed from mainnet.
     * @param identifier Identifier of price request to resolve.
     * @param time Timestamp of price request to resolve.
     * @param requestAncillaryData Original ancillary data passed by the requester before stamping by the legacy spoke.
     * @param childRequester Address of the requester that initiated the price request.
     */
    function resolveLegacyRequest(
        bytes32 identifier,
        uint256 time,
        bytes memory requestAncillaryData,
        address childRequester
    ) external {
        bytes32 legacyRequestId =
            _encodePriceRequest(identifier, time, _legacyStampAncillaryData(requestAncillaryData));
        Price storage legacyLookup = prices[legacyRequestId];
        require(legacyLookup.state == RequestState.Resolved, "Price has not been resolved");

        bytes memory ancillaryData = _stampAncillaryData(requestAncillaryData, childRequester);
        bytes32 priceRequestId = _encodePriceRequest(identifier, time, ancillaryData);
        Price storage lookup = prices[priceRequestId];

        // Update the state and emit an event only if the legacy request has not been resolved yet.
        if (lookup.state != RequestState.Resolved) {
            lookup.price = legacyLookup.price;
            lookup.state = RequestState.Resolved;
            emit ResolvedLegacyRequest(identifier, time, ancillaryData, lookup.price, priceRequestId, legacyRequestId);
        }
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
        bytes32 priceRequestId = _encodePriceRequest(identifier, time, _stampAncillaryData(ancillaryData, msg.sender));
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
        bytes32 priceRequestId = _encodePriceRequest(identifier, time, _stampAncillaryData("", msg.sender));
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
        bytes32 priceRequestId = _encodePriceRequest(identifier, time, _stampAncillaryData(ancillaryData, msg.sender));
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
        bytes32 priceRequestId = _encodePriceRequest(identifier, time, _stampAncillaryData("", msg.sender));
        Price storage lookup = prices[priceRequestId];
        require(lookup.state == RequestState.Resolved, "Price has not been resolved");
        return lookup.price;
    }

    /**
     * @notice Generates compressed or stamped ancillary data in the format that it would be bridged to mainnet in the
     * case of a price request.
     * @param ancillaryData ancillary data of the price being requested.
     * @param requester sender of the initial price request.
     * @param requestBlockNumber block number of the price request.
     * @return the stamped or compressed ancillary bytes.
     */
    function stampOrCompressAncillaryData(
        bytes memory ancillaryData,
        address requester,
        uint256 requestBlockNumber
    ) external view nonReentrantView() returns (bytes memory) {
        return _stampOrCompressAncillaryData(ancillaryData, requester, requestBlockNumber);
    }

    /**
     * @notice Compresses longer ancillary data by providing sufficient information to track back the original ancillary
     * data on mainnet. In case of shorter ancillary data, it simply stamps the requester's address and chainId.
     */
    function _stampOrCompressAncillaryData(
        bytes memory ancillaryData,
        address requester,
        uint256 requestBlockNumber
    ) internal view returns (bytes memory) {
        if (ancillaryData.length <= compressAncillaryBytesThreshold) {
            return _stampAncillaryData(ancillaryData, requester);
        }

        // Compared to the simple stamping method, the compression replaces original ancillary data with its hash and
        // adds address of this child oracle and block number so that its more efficient to fetch original ancillary
        // data from PriceRequestBridged event on origin chain indexed by parentRequestId. This parentRequestId can be
        // reconstructed by taking keccak256 hash of ABI encoded price identifier, time and ancillary data as bridged
        // to mainnet.
        return
            AncillaryData.appendKeyValueUint(
                AncillaryData.appendKeyValueAddress(
                    AncillaryData.appendKeyValueAddress(
                        AncillaryData.appendKeyValueUint(
                            AncillaryData.appendKeyValueBytes32("", "ancillaryDataHash", keccak256(ancillaryData)),
                            "childBlockNumber",
                            requestBlockNumber
                        ),
                        "childOracle",
                        address(this)
                    ),
                    "childRequester",
                    requester
                ),
                "childChainId",
                block.chainid
            );
    }

    /**
     * @dev We don't handle specifically the case where `ancillaryData` is not already readily translatable in utf8.
     * For those cases, we assume that the client will be able to strip out the utf8-translatable part of the
     * ancillary data that this contract stamps.
     */
    function _stampAncillaryData(bytes memory ancillaryData, address requester) internal view returns (bytes memory) {
        // This contract should stamp the child network's ID and requester's address so that voters on the parent
        // network can deterministically track unique price requests back to this contract.
        return
            AncillaryData.appendKeyValueUint(
                AncillaryData.appendKeyValueAddress(ancillaryData, "childRequester", requester),
                "childChainId",
                block.chainid
            );
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
}

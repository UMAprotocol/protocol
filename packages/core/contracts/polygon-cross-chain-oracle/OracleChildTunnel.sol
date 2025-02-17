// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@maticnetwork/fx-portal/contracts/tunnel/FxBaseChildTunnel.sol";
import "../data-verification-mechanism/interfaces/OracleAncillaryInterface.sol";
import "../data-verification-mechanism/interfaces/RegistryInterface.sol";
import "./OracleBaseTunnel.sol";
import "../common/implementation/AncillaryData.sol";
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
        // Append requester and chainId so that the request is unique.
        address requester = msg.sender;
        bytes memory childAncillaryData = _stampAncillaryData(ancillaryData, requester);
        bytes32 childRequestId = _encodePriceRequest(identifier, time, childAncillaryData);
        Price storage lookup = prices[childRequestId];

        // Send the request to mainnet if it has not been requested yet.
        if (lookup.state != RequestState.NeverRequested) return;
        lookup.state = RequestState.Requested;

        // Longer ancillary data is compressed to save gas on the mainnet.
        bytes memory parentAncillaryData =
            ancillaryData.length <= compressAncillaryBytesThreshold
                ? childAncillaryData
                : _compressAncillaryData(ancillaryData, requester, block.number);
        bytes32 parentRequestId = _encodePriceRequest(identifier, time, parentAncillaryData);

        // There is no need to store the childRequestId in the mapping if the parentRequestId is the same since this
        // contract would fallback to the parentRequestId when receiving the resolved price.
        if (parentRequestId != childRequestId) childRequestIds[parentRequestId] = childRequestId;

        // In case of longer ancillary data, only its compressed representation is bridged to mainnet. In any case,
        // emit all required information so that voters on mainnet can track the origin of the request and full
        // ancillary data by using the parentRequestId that is derived from identifier, time and ancillary data as
        // observed on mainnet.
        emit PriceRequestBridged(requester, identifier, time, childAncillaryData, childRequestId, parentRequestId);
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

        // Resolve the requestId used when requesting and checking the price. This could differ from the parent if the
        // ancillary data was compressed when sending to the mainnet. The childRequestIds value in the mapping could
        // be uninitialized in the following cases:
        // - Ancillary data was not compressed, so requestId would be the same.
        // - The request was originated from the previous implementation of this contract.
        // - The request was originated from another chain and was pushed to this chain by mistake.
        bytes32 priceRequestId = childRequestIds[parentRequestId];
        if (priceRequestId == bytes32(0)) priceRequestId = parentRequestId;
        Price storage lookup = prices[priceRequestId];

        // In order to support resolving the requests initiated from the previous implementation of this contract, we
        // only the state and emit an event if it has not yet been resolved.
        if (lookup.state == RequestState.Resolved) return;
        lookup.price = price;
        lookup.state = RequestState.Resolved;
        emit PushedPrice(identifier, time, ancillaryData, price, priceRequestId);
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
        bytes32 priceRequestId = _encodePriceRequest(identifier, time, _stampAncillaryData(ancillaryData, msg.sender));
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
        bytes32 priceRequestId = _encodePriceRequest(identifier, time, _stampAncillaryData(ancillaryData, msg.sender));
        Price storage lookup = prices[priceRequestId];
        require(lookup.state == RequestState.Resolved, "Price has not been resolved");
        return lookup.price;
    }

    /**
     * @notice Compresses longer ancillary data by providing sufficient information to track back the original ancillary
     * data on mainnet. In case of shorter ancillary data, it simply stamps the requester's address and chainId.
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
        return
            ancillaryData.length <= compressAncillaryBytesThreshold
                ? _stampAncillaryData(ancillaryData, requester)
                : _compressAncillaryData(ancillaryData, requester, requestBlockNumber);
    }

    /**
     * @notice Compresses ancillary data by providing sufficient information to track back the original ancillary data
     * on mainnet.
     * @dev Compared to the simple stamping method, the compression replaces original ancillary data with its hash and
     * adds address of this child oracle and block number so that its more efficient to fetch original ancillary data
     * from PriceRequestBridged event on origin chain indexed by parentRequestId. This parentRequestId can be
     * reconstructed by taking keccak256 hash of ABI encoded price identifier, time and ancillary data.
     */
    function _compressAncillaryData(
        bytes memory ancillaryData,
        address requester,
        uint256 requestBlockNumber
    ) internal view returns (bytes memory) {
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
}

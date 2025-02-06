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
        bytes memory l1AncillaryData = _compressAncillaryData(ancillaryData, msg.sender);

        // This implementation allows duplicate price requests to emit duplicate MessageSent events via
        // _sendMessageToRoot. The DVM will not have a problem handling duplicate requests (it will just ignore them).
        // This is potentially a fallback in case the checkpointing to mainnet is missing the `requestPrice` transaction
        // for some reason. There is little risk in duplicating MessageSent emissions because the sidechain bridge
        // does not impose any rate-limiting and this method is only callable by registered callers.
        _requestPrice(identifier, time, l1AncillaryData, ancillaryData);
        _sendMessageToRoot(abi.encode(identifier, time, l1AncillaryData));
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
        _publishPrice(identifier, time, ancillaryData, price);
    }

    /**
     * @notice This method handles a special case when a price request was originated on the previous implementation of
     * this contract, but was not settled before the upgrade.
     * @dev Duplicates the resolved state from the legacy request (ancillary data was stamped) to the new request where
     * longer ancillary data would be compressed. Will revert if the legacy request has not been pushed from mainnet.
     * @param identifier Identifier of price request to resolve.
     * @param time Timestamp of price request to resolve.
     * @param requestAncillaryData Original ancillary data passed by the requester before stamping by the legacy tunnel.
     * @param childRequester Address of the requester that initiated the price request.
     */
    function resolveLegacyRequest(
        bytes32 identifier,
        uint256 time,
        bytes memory requestAncillaryData,
        address childRequester
    ) external {
        bytes32 legacyRequestId =
            _encodePriceRequest(identifier, time, _stampAncillaryData(requestAncillaryData, childRequester));
        Price storage legacyLookup = prices[legacyRequestId];
        require(legacyLookup.state == RequestState.Resolved, "Price has not been resolved");

        bytes memory ancillaryData = _compressAncillaryData(requestAncillaryData, childRequester);
        bytes32 priceRequestId = _encodePriceRequest(identifier, time, ancillaryData);
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
        bytes32 priceRequestId =
            _encodePriceRequest(identifier, time, _compressAncillaryData(ancillaryData, msg.sender));
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
        bytes32 priceRequestId =
            _encodePriceRequest(identifier, time, _compressAncillaryData(ancillaryData, msg.sender));
        Price storage lookup = prices[priceRequestId];
        require(lookup.state == RequestState.Resolved, "Price has not been resolved");
        return lookup.price;
    }

    /**
     * @notice Generates compressed ancillary data in the format that it would be bridged to mainnet in the case of a
     * price request.
     * @param ancillaryData ancillary data of the price being requested.
     * @param requester sender of the initial price request.
     * @return the compressed ancillary bytes.
     */
    function compressAncillaryData(bytes memory ancillaryData, address requester)
        external
        view
        nonReentrantView()
        returns (bytes memory)
    {
        return _compressAncillaryData(ancillaryData, requester);
    }

    /**
     * @notice Compresses longer ancillary data by providing sufficient information to track back the original ancillary
     * data on mainnet. In case of shorter ancillary data, it simply stamps the requester's address and chainId.
     */
    function _compressAncillaryData(bytes memory ancillaryData, address requester)
        internal
        view
        returns (bytes memory)
    {
        if (ancillaryData.length <= compressAncillaryBytesThreshold) {
            return _stampAncillaryData(ancillaryData, requester);
        }

        // Compared to the simple stamping method, the compression replaces original ancillary data with its hash and
        // adds address of this child oracle and block number so that its more efficient to fetch original ancillary
        // data from PriceRequestAdded event on origin chain indexed by requestId. This requestId can be reconstructed
        // by taking keccak256 hash of ABI encoded price identifier, time and ancillary data as bridged to mainnet.
        return
            AncillaryData.appendKeyValueUint(
                AncillaryData.appendKeyValueAddress(
                    AncillaryData.appendKeyValueAddress(
                        AncillaryData.appendKeyValueUint(
                            AncillaryData.appendKeyValueBytes32("", "ancillaryDataHash", keccak256(ancillaryData)),
                            "childBlockNumber",
                            block.number
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

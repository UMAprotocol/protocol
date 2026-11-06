// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.22;

import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { ReentrancyGuardUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

// Import UMA interfaces from core package
import {
    OracleAncillaryInterface
} from "@uma/core/data-verification-mechanism/interfaces/OracleAncillaryInterface.sol";
import { FinderInterface } from "@uma/core/data-verification-mechanism/interfaces/FinderInterface.sol";
import { RegistryInterface } from "@uma/core/data-verification-mechanism/interfaces/RegistryInterface.sol";
import { OracleInterfaces } from "@uma/core/data-verification-mechanism/implementation/Constants.sol";

/**
 * @title DisputeRouter
 * @notice Routes UMA-style price disputes to either a permissioned council or the underlying Oracle.
 */
contract DisputeRouter is
    Initializable,
    UUPSUpgradeable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    OracleAncillaryInterface
{
    // ========== ERRORS ==========

    error CallerNotCouncil(address caller);
    error CallerNotRegistered(address caller);

    error RequestDoesNotExist(bytes32 requestId);
    error RequestAlreadyResolved(bytes32 requestId);
    error RequestAlreadyForwarded(bytes32 requestId);
    error CannotResolveAfterForwarding(bytes32 requestId);
    error DelayNotPassed(uint256 currentTime, uint256 requiredTime);

    error PriceWasNeverRequested(bytes32 identifier, uint256 time, bytes ancillaryData);
    error PriceNotYetResolved(bytes32 identifier, uint256 time, bytes ancillaryData);

    error ZeroAddress();

    // ========== STRUCTS ==========

    struct PriceRequest {
        uint64 requestTimestamp;
        uint64 forwardedTimestamp;
        bool resolved;
        int256 resolvedPrice;
    }

    enum GetPriceError {
        None,
        NeverRequested,
        NotYetResolved
    }

    // ========== ERC-7201 NAMESPACED STORAGE ==========

    /// @custom:storage-location erc7201:uma.storage.DisputeRouter
    struct DisputeRouterStorage {
        OracleAncillaryInterface oracle;
        address council;
        uint64 forwardDelay;
        mapping(bytes32 => PriceRequest) priceRequests;
    }

    // keccak256(abi.encode(uint256(keccak256("uma.storage.DisputeRouter")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant DISPUTE_ROUTER_STORAGE_LOCATION =
        0x27fad7f759f5b0490db0c354080fe10b99002885ea52e5a6702712b9c9c6a900;

    function _getStorage() private pure returns (DisputeRouterStorage storage $) {
        assembly {
            $.slot := DISPUTE_ROUTER_STORAGE_LOCATION
        }
    }

    // ========== IMMUTABLES ==========

    FinderInterface public immutable finder;

    // ========== EVENTS ==========

    event RequestAdded(address indexed requester, bytes32 indexed identifier, uint256 time, bytes ancillaryData);

    event RequestForwarded(
        address indexed caller, bytes32 indexed identifier, uint256 time, bytes ancillaryData, address indexed oracle
    );

    event RequestResolved(
        bytes32 indexed requestId,
        bytes32 indexed identifier,
        uint256 time,
        bytes ancillaryData,
        int256 price,
        address indexed resolver
    );

    event CouncilChanged(address indexed newCouncil);
    event ForwardDelayChanged(uint64 newDelay);
    event OracleChanged(address indexed newOracle);

    // ========== MODIFIERS ==========

    modifier onlyRegisteredContract() {
        _requireRegisteredContract();
        _;
    }

    modifier onlyCouncil() {
        _requireOnlyCouncil();
        _;
    }

    // ========== CONSTRUCTOR & INITIALIZER ==========

    /**
     * @notice Constructs the implementation contract and permanently sets immutables.
     * @dev Uses _disableInitializers() to prevent initializing the implementation itself.
     * @param _finder UMA Finder used to locate Registry implementation for contract registration checks.
     */
    constructor(FinderInterface _finder) {
        if (address(_finder) == address(0)) revert ZeroAddress();
        finder = _finder;
        _disableInitializers();
    }

    /**
     * @notice Initializes the proxy state for this router instance.
     * @dev Callable only once due to the OpenZeppelin initializer modifier.
     * @param _oracle The underlying oracle to forward requests to.
     * @param _council Address allowed to resolve locally and force-forward immediately.
     * @param _forwardDelay Delay (in seconds) before non-council callers may forward to the oracle; 0 enables passthrough mode.
     * @param _owner Owner for admin configuration and upgrades.
     */
    function initialize(
        OracleAncillaryInterface _oracle,
        address _council,
        uint64 _forwardDelay,
        address _owner
    )
        external
        initializer
    {
        if (address(_oracle) == address(0)) revert ZeroAddress();
        if (_council == address(0)) revert ZeroAddress();
        if (_owner == address(0)) revert ZeroAddress();

        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        DisputeRouterStorage storage $ = _getStorage();
        $.oracle = _oracle;
        $.council = _council;
        $.forwardDelay = _forwardDelay;
    }

    // ========== PUBLIC VIEW GETTERS ==========

    /**
     * @notice Returns the underlying oracle address.
     * @return The oracle implementing OracleAncillaryInterface.
     */
    function oracle() external view returns (OracleAncillaryInterface) {
        return _getStorage().oracle;
    }

    /**
     * @notice Returns the council address.
     * @return The address authorized to resolve disputes locally.
     */
    function council() external view returns (address) {
        return _getStorage().council;
    }

    /**
     * @notice Returns the forwarding delay in seconds.
     * @return The delay before non-council callers may forward to oracle; 0 means passthrough mode.
     */
    function forwardDelay() external view returns (uint64) {
        return _getStorage().forwardDelay;
    }

    /**
     * @notice Returns the price request data for a given request ID.
     * @param requestId The keccak256 hash of (identifier, time, ancillaryData).
     * @return requestTimestamp When the request was created.
     * @return forwardedTimestamp When the request was forwarded to oracle (0 if not forwarded).
     * @return resolved Whether the request has been resolved by council.
     * @return resolvedPrice The resolved price (only valid if resolved is true).
     */
    function priceRequests(bytes32 requestId)
        external
        view
        returns (uint64 requestTimestamp, uint64 forwardedTimestamp, bool resolved, int256 resolvedPrice)
    {
        PriceRequest storage request = _getStorage().priceRequests[requestId];
        return (request.requestTimestamp, request.forwardedTimestamp, request.resolved, request.resolvedPrice);
    }

    // ========== REQUEST INGESTION ==========

    /**
     * @notice Requests a price with ancillary data and caches it locally.
     * @dev
     * - Restricted to UMA-registered calling contracts.
     * - When forwardDelay == 0, also forwards immediately to the oracle.
     * - Returns early if the request already exists (idempotent).
     * @param identifier Price identifier.
     * @param time Timestamp of price request.
     * @param ancillaryData Extra data of price request.
     */
    function requestPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    )
        public
        override
        nonReentrant
        onlyRegisteredContract
    {
        _requestPrice(identifier, time, ancillaryData);
    }

    // ========== ROUTING ACTIONS ==========

    /**
     * @notice Resolves a cached request locally via the council (without forwarding to the oracle).
     * @dev
     * - Restricted to council.
     * - Reverts if the request doesn't exist, is already resolved, or has already been forwarded to the oracle.
     * @param identifier Price identifier.
     * @param time Timestamp (seconds since epoch) that was requested.
     * @param ancillaryData Ancillary data (arbitrary bytes) used when requesting the price.
     * @param resolvedPrice Resolved price to cache.
     */
    function resolvePriceRequest(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData,
        int256 resolvedPrice
    )
        external
        nonReentrant
        onlyCouncil
    {
        DisputeRouterStorage storage $ = _getStorage();
        bytes32 requestId = _encodePriceRequest(identifier, time, ancillaryData);
        PriceRequest storage request = _getExistingRequest($, requestId);
        _revertIfResolved(request, requestId);
        if (request.forwardedTimestamp != 0) revert CannotResolveAfterForwarding(requestId);

        request.resolved = true;
        request.resolvedPrice = resolvedPrice;

        emit RequestResolved(requestId, identifier, time, ancillaryData, resolvedPrice, $.council);
    }

    /**
     * @notice Forwards a cached request to the oracle after the configured delay has passed.
     * @dev
     * - Callable by anyone.
     * - Reverts if the request doesn't exist, is already resolved, is already forwarded, or the delay hasn't passed.
     * @param identifier Price identifier.
     * @param time Timestamp (seconds since epoch) that was requested.
     * @param ancillaryData Ancillary data (arbitrary bytes) used when requesting the price.
     */
    function forwardPriceRequest(bytes32 identifier, uint256 time, bytes memory ancillaryData) external nonReentrant {
        DisputeRouterStorage storage $ = _getStorage();
        bytes32 requestId = _encodePriceRequest(identifier, time, ancillaryData);
        PriceRequest storage request = _getExistingRequest($, requestId);
        _revertIfResolved(request, requestId);
        _revertIfForwarded(request, requestId);

        uint256 requiredTime = uint256(request.requestTimestamp) + uint256($.forwardDelay);
        if (getCurrentTime() < requiredTime) revert DelayNotPassed(getCurrentTime(), requiredTime);

        _forwardRequestToOracleAndMark($, request, identifier, time, ancillaryData);

        emit RequestForwarded(msg.sender, identifier, time, ancillaryData, address($.oracle));
    }

    /**
     * @notice Forwards a cached request to the oracle immediately (council-only escalation).
     * @dev Reverts if the request doesn't exist, is already resolved, or is already forwarded.
     * @param identifier Price identifier.
     * @param time Timestamp (seconds since epoch) that was requested.
     * @param ancillaryData Ancillary data (arbitrary bytes) used when requesting the price.
     */
    function escalateNow(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    )
        external
        nonReentrant
        onlyCouncil
    {
        DisputeRouterStorage storage $ = _getStorage();
        bytes32 requestId = _encodePriceRequest(identifier, time, ancillaryData);
        PriceRequest storage request = _getExistingRequest($, requestId);
        _revertIfResolved(request, requestId);
        _revertIfForwarded(request, requestId);

        _forwardRequestToOracleAndMark($, request, identifier, time, ancillaryData);

        emit RequestForwarded(msg.sender, identifier, time, ancillaryData, address($.oracle));
    }

    // ========== PRICE AVAILABILITY & RETRIEVAL ==========

    /**
     * @notice Returns whether a price is available for a given identifier/time/ancillary triple.
     * @dev Restricted to UMA-registered calling contracts.
     * @param identifier Price identifier.
     * @param time Timestamp (seconds since epoch) that was requested.
     * @param ancillaryData Ancillary data (arbitrary bytes) used when requesting the price.
     * @return True if the price is available either from local cache (council resolution) or from the oracle (if forwarded).
     */
    function hasPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    )
        public
        view
        override
        onlyRegisteredContract
        returns (bool)
    {
        (bool _hasPrice,,) = _getPriceOrError(identifier, time, ancillaryData);
        return _hasPrice;
    }

    /**
     * @notice Returns the resolved price for a given identifier/time/ancillary triple.
     * @dev
     * - Restricted to UMA-registered calling contracts.
     * - Reverts if never requested or not yet resolved.
     * @param identifier Price identifier.
     * @param time Timestamp (seconds since epoch) that was requested.
     * @param ancillaryData Ancillary data (arbitrary bytes) used when requesting the price.
     * @return price The resolved price.
     */
    function getPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    )
        public
        view
        override
        onlyRegisteredContract
        returns (int256)
    {
        (bool _hasPrice, int256 price, GetPriceError err) = _getPriceOrError(identifier, time, ancillaryData);
        if (!_hasPrice) {
            if (err == GetPriceError.NeverRequested) revert PriceWasNeverRequested(identifier, time, ancillaryData);
            revert PriceNotYetResolved(identifier, time, ancillaryData);
        }
        return price;
    }

    // ========== ADMIN FUNCTIONS ==========

    /**
     * @notice Updates the council address.
     * @param newCouncil New council address.
     */
    function setCouncil(address newCouncil) external onlyOwner {
        if (newCouncil == address(0)) revert ZeroAddress();
        _getStorage().council = newCouncil;
        emit CouncilChanged(newCouncil);
    }

    /**
     * @notice Updates the forwarding delay (in seconds).
     * @dev Setting to 0 enables passthrough mode (requests are forwarded immediately on ingestion).
     * @param newDelay New delay value in seconds.
     */
    function setForwardDelay(uint64 newDelay) external onlyOwner {
        _getStorage().forwardDelay = newDelay;
        emit ForwardDelayChanged(newDelay);
    }

    /**
     * @notice Updates the underlying oracle address.
     * @dev Changing the oracle will orphan all previously forwarded requests (both resolved and unresolved) in the old
     * oracle. The new oracle is expected to implement fallback logic to the previous oracle to preserve access to
     * resolved prices. If the new oracle does not implement such a fallback, resolved prices from the old oracle will
     * become inaccessible through this contract.
     * @param newOracle New oracle address implementing OracleAncillaryInterface.
     */
    function setOracle(address newOracle) external onlyOwner {
        if (newOracle == address(0)) revert ZeroAddress();
        _getStorage().oracle = OracleAncillaryInterface(newOracle);
        emit OracleChanged(newOracle);
    }

    // ========== VIEW FUNCTIONS ==========

    /**
     * @notice Returns the current time used by this contract.
     * @dev Overridable for testing.
     * @return currentTime The current timestamp (seconds since epoch).
     */
    function getCurrentTime() public view virtual returns (uint256) {
        return block.timestamp;
    }

    // ========== INTERNAL FUNCTIONS ==========

    function _requestPrice(bytes32 identifier, uint256 time, bytes memory ancillaryData) internal {
        DisputeRouterStorage storage $ = _getStorage();
        bytes32 requestId = _encodePriceRequest(identifier, time, ancillaryData);
        PriceRequest storage request = $.priceRequests[requestId];

        // Return early if already requested (idempotent, matches OracleChildTunnel behavior)
        if (request.requestTimestamp != 0) return;

        uint64 now64 = uint64(getCurrentTime());

        // Only set requestTimestamp (others default to 0/false/address(0))
        request.requestTimestamp = now64;

        emit RequestAdded(msg.sender, identifier, time, ancillaryData);

        // Forward immediately if forwardDelay is 0 (passthrough mode)
        if ($.forwardDelay == 0) {
            request.forwardedTimestamp = now64;
            $.oracle.requestPrice(identifier, time, ancillaryData);
            emit RequestForwarded(msg.sender, identifier, time, ancillaryData, address($.oracle));
        }
    }

    function _getPriceOrError(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    )
        internal
        view
        returns (bool _hasPrice, int256 price, GetPriceError err)
    {
        DisputeRouterStorage storage $ = _getStorage();
        bytes32 requestId = _encodePriceRequest(identifier, time, ancillaryData);
        PriceRequest storage request = $.priceRequests[requestId];

        // Priority 1: Council resolution (local cache)
        if (request.resolved) {
            return (true, request.resolvedPrice, GetPriceError.None);
        }

        // Priority 2: Oracle (if forwarded)
        if (request.forwardedTimestamp != 0) {
            if ($.oracle.hasPrice(identifier, time, ancillaryData)) {
                return (true, $.oracle.getPrice(identifier, time, ancillaryData), GetPriceError.None);
            }
        }

        if (request.requestTimestamp == 0) return (false, 0, GetPriceError.NeverRequested);
        return (false, 0, GetPriceError.NotYetResolved);
    }

    function _encodePriceRequest(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    )
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(identifier, time, ancillaryData));
    }

    function _getExistingRequest(
        DisputeRouterStorage storage $,
        bytes32 requestId
    )
        internal
        view
        returns (PriceRequest storage request)
    {
        request = $.priceRequests[requestId];
        if (request.requestTimestamp == 0) revert RequestDoesNotExist(requestId);
    }

    function _revertIfResolved(PriceRequest storage request, bytes32 requestId) internal view {
        if (request.resolved) revert RequestAlreadyResolved(requestId);
    }

    function _revertIfForwarded(PriceRequest storage request, bytes32 requestId) internal view {
        if (request.forwardedTimestamp != 0) revert RequestAlreadyForwarded(requestId);
    }

    function _forwardRequestToOracleAndMark(
        DisputeRouterStorage storage $,
        PriceRequest storage request,
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    )
        internal
    {
        request.forwardedTimestamp = uint64(getCurrentTime());
        $.oracle.requestPrice(identifier, time, ancillaryData);
    }

    function _requireRegisteredContract() internal view {
        RegistryInterface registry = RegistryInterface(finder.getImplementationAddress(OracleInterfaces.Registry));
        if (!registry.isContractRegistered(msg.sender)) {
            revert CallerNotRegistered(msg.sender);
        }
    }

    function _requireOnlyCouncil() internal view {
        DisputeRouterStorage storage $ = _getStorage();
        if (msg.sender != $.council) revert CallerNotCouncil(msg.sender);
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner { }
}

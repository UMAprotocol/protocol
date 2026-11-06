// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.22;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Multicall } from "@openzeppelin/contracts/utils/Multicall.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { DisputeRouter } from "./DisputeRouter.sol";

/**
 * @title Narrow managed Optimistic Oracle V2 interface used by the dispute router council.
 * @notice Provides the managed Optimistic Oracle surface needed for managed request resolution flows.
 * @dev Replicated locally because managed Optimistic Oracle request structs differ across OO flavors, and the council
 * needs getRequest() to validate disputed event-based managed requests, derive their DVM timestamps, and read settled
 * follow-up prices. Managed resolution decodes the immutable mooV2 runtime according to this ABI; if
 * ManagedOptimisticOracleV2 receives a breaking ABI change, deploy a replacement DisputeRouterCouncil compiled against
 * the new ABI and point the DisputeRouter at it with setCouncil().
 */
interface IManagedOptimisticOracleV2ForCouncil {
    struct RequestSettings {
        bool eventBased;
        bool refundOnDispute;
        bool callbackOnPriceProposed;
        bool callbackOnPriceDisputed;
        bool callbackOnPriceSettled;
        uint256 bond;
        uint256 customLiveness;
    }

    struct Request {
        address proposer;
        address disputer;
        IERC20 currency;
        bool settled;
        RequestSettings requestSettings;
        int256 proposedPrice;
        int256 resolvedPrice;
        uint256 expirationTime;
        uint256 reward;
        uint256 finalFee;
        uint256 proposalTime;
    }

    /**
     * @notice Returns the managed request data for a specific request.
     * @param requester Requester recorded for the managed Optimistic Oracle request.
     * @param identifier Price identifier for the request.
     * @param timestamp Request timestamp.
     * @param ancillaryData Ancillary data associated with the request.
     * @return The managed request data.
     */
    function getRequest(
        address requester,
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData
    )
        external
        view
        returns (Request memory);

    /**
     * @notice Returns ancillary data stamped for the given requester.
     * @param ancillaryData Original ancillary data.
     * @param requester Requester to stamp into the ancillary data.
     * @return The stamped ancillary data.
     */
    function stampAncillaryData(bytes memory ancillaryData, address requester) external view returns (bytes memory);
}

/**
 * @title DisputeRouterCouncil
 * @notice Wraps the router council role with owner-managed operators that can locally resolve configured managed
 * requests or bypass the router forwarding delay for operator-selected Optimistic Oracle-backed router requests.
 * @dev Managed resolution validates MOOv2 request metadata before setting local router prices. Escalation does not
 * inspect Optimistic Oracle state; operator authorization and router-entry existence are the gate. Operators are
 * trusted to select router entries that should go to the underlying oracle instead of local managed resolution.
 */
contract DisputeRouterCouncil is Ownable, ReentrancyGuard, Multicall {
    int256 public constant TOO_EARLY_RESPONSE = type(int256).min;
    uint256 private constant LEGACY_DEFAULT_LIVENESS = 2 hours;

    DisputeRouter public immutable router;
    IManagedOptimisticOracleV2ForCouncil public immutable mooV2;

    mapping(address => bool) public operators;
    mapping(bytes32 => bool) public earlyRequestIdentifiers;

    event EarlyRequestIdentifierUpdated(bytes32 indexed identifier, bool allowed);
    event OperatorUpdated(address indexed operator, bool allowed);
    event ManagedResolvedTooEarly(
        address indexed operator,
        address indexed requester,
        bytes32 indexed identifier,
        uint256 dvmRequestTimestamp,
        bytes ancillaryData
    );
    event ManagedResolvedFromFollowUp(
        address indexed operator,
        address indexed requester,
        bytes32 indexed identifier,
        uint256 dvmRequestTimestamp,
        uint256 followUpRequestTime,
        bytes ancillaryData,
        int256 price
    );
    event OptimisticOracleRequestEscalated(
        address indexed operator, bytes32 indexed identifier, uint256 dvmRequestTimestamp, bytes dvmAncillaryData
    );

    error CallerNotOperator(address caller);
    error IdentifierNotAllowedForTooEarly(bytes32 identifier);
    error InvalidFollowUpRequestTime(uint256 dvmRequestTimestamp, uint256 followUpDvmRequestTimestamp);
    error ManagedRequestNotDisputed(address requester, bytes32 identifier, uint256 timestamp, bytes ancillaryData);
    error ManagedRequestNotEventBased(address requester, bytes32 identifier, uint256 timestamp, bytes ancillaryData);
    error UnsettledFollowUpRequest(address requester, uint256 timestamp, bytes ancillaryData);
    error ZeroAddress();

    /**
     * @notice Reverts unless the caller is an approved council operator.
     */
    modifier onlyOperator() {
        _requireOperator();
        _;
    }

    /**
     * @notice Constructs the dispute router council.
     * @dev Ownable(_owner) validates the owner address. The configured mooV2 is immutable and must remain ABI-compatible
     * with IManagedOptimisticOracleV2ForCouncil for managed resolution paths.
     * @param _router Dispute router that receives council resolutions and escalations.
     * @param _mooV2 Managed Optimistic Oracle V2 used for managed request inspection and ancillary stamping.
     * @param _owner Initial owner allowed to manage operators and early request identifiers.
     */
    constructor(DisputeRouter _router, IManagedOptimisticOracleV2ForCouncil _mooV2, address _owner) Ownable(_owner) {
        if (address(_router) == address(0) || address(_mooV2) == address(0)) {
            revert ZeroAddress();
        }

        router = _router;
        mooV2 = _mooV2;
    }

    /**
     * @notice Updates whether an address can perform council operator actions.
     * @param operator Address to update.
     * @param allowed Whether the operator is allowed.
     */
    function setOperator(address operator, bool allowed) external onlyOwner {
        if (operator == address(0)) revert ZeroAddress();

        operators[operator] = allowed;
        emit OperatorUpdated(operator, allowed);
    }

    /**
     * @notice Updates whether an identifier may be resolved using the TOO_EARLY_RESPONSE sentinel value.
     * @param identifier Identifier to update.
     * @param allowed Whether the identifier may use too-early resolution.
     */
    function setEarlyRequestIdentifier(bytes32 identifier, bool allowed) external onlyOwner {
        earlyRequestIdentifiers[identifier] = allowed;
        emit EarlyRequestIdentifierUpdated(identifier, allowed);
    }

    /**
     * @notice Resolves a managed request using the TOO_EARLY_RESPONSE sentinel value.
     * @dev Reverts unless the identifier is approved for too-early resolution and the target MOOv2 request is disputed
     * and event-based.
     * @param requester Requester for the managed Optimistic Oracle request being resolved.
     * @param identifier Price identifier for the request.
     * @param mooV2RequestTime Timestamp of the managed Optimistic Oracle request being resolved.
     * @param ancillaryData Original managed request ancillary data.
     */
    function resolveManagedAsTooEarly(
        address requester,
        bytes32 identifier,
        uint256 mooV2RequestTime,
        bytes memory ancillaryData
    )
        external
        onlyOperator
        nonReentrant
    {
        if (requester == address(0)) revert ZeroAddress();
        if (!earlyRequestIdentifiers[identifier]) {
            revert IdentifierNotAllowedForTooEarly(identifier);
        }

        IManagedOptimisticOracleV2ForCouncil.Request memory request =
            mooV2.getRequest(requester, identifier, mooV2RequestTime, ancillaryData);
        _requireDisputedEventBasedManagedRequest(requester, identifier, mooV2RequestTime, ancillaryData, request);

        uint256 dvmRequestTimestamp = _getDvmRequestTimestamp(request);
        bytes memory stampedAncillaryData = mooV2.stampAncillaryData(ancillaryData, requester);
        router.resolvePriceRequest(identifier, dvmRequestTimestamp, stampedAncillaryData, TOO_EARLY_RESPONSE);

        emit ManagedResolvedTooEarly(msg.sender, requester, identifier, dvmRequestTimestamp, ancillaryData);
    }

    /**
     * @notice Resolves a managed request using the resolved price from a settled follow-up request.
     * @dev Reverts unless the target request was disputed and event-based, the follow-up request is settled and
     * event-based, and the follow-up DVM timestamp is not earlier than the target DVM timestamp.
     * @param requester Shared requester for the managed Optimistic Oracle requests.
     * @param identifier Price identifier for both requests.
     * @param mooV2RequestTime Timestamp of the managed Optimistic Oracle request being resolved.
     * @param followUpRequestTime Timestamp of the settled follow-up managed request.
     * @param ancillaryData Ancillary data shared by the managed requests.
     */
    function resolveManagedFromSettledFollowUp(
        address requester,
        bytes32 identifier,
        uint256 mooV2RequestTime,
        uint256 followUpRequestTime,
        bytes memory ancillaryData
    )
        external
        onlyOperator
        nonReentrant
    {
        if (requester == address(0)) revert ZeroAddress();

        IManagedOptimisticOracleV2ForCouncil.Request memory targetRequest =
            mooV2.getRequest(requester, identifier, mooV2RequestTime, ancillaryData);
        _requireDisputedEventBasedManagedRequest(requester, identifier, mooV2RequestTime, ancillaryData, targetRequest);
        uint256 dvmRequestTimestamp = _getDvmRequestTimestamp(targetRequest);

        IManagedOptimisticOracleV2ForCouncil.Request memory followUpRequest =
            mooV2.getRequest(requester, identifier, followUpRequestTime, ancillaryData);
        if (!followUpRequest.settled) revert UnsettledFollowUpRequest(requester, followUpRequestTime, ancillaryData);
        if (!followUpRequest.requestSettings.eventBased) {
            revert ManagedRequestNotEventBased(requester, identifier, followUpRequestTime, ancillaryData);
        }
        uint256 followUpDvmRequestTimestamp = _getDvmRequestTimestamp(followUpRequest);
        if (followUpDvmRequestTimestamp < dvmRequestTimestamp) {
            revert InvalidFollowUpRequestTime(dvmRequestTimestamp, followUpDvmRequestTimestamp);
        }
        if (followUpRequest.resolvedPrice == TOO_EARLY_RESPONSE && !earlyRequestIdentifiers[identifier]) {
            revert IdentifierNotAllowedForTooEarly(identifier);
        }

        bytes memory stampedAncillaryData = mooV2.stampAncillaryData(ancillaryData, requester);
        router.resolvePriceRequest(identifier, dvmRequestTimestamp, stampedAncillaryData, followUpRequest.resolvedPrice);

        emit ManagedResolvedFromFollowUp(
            msg.sender,
            requester,
            identifier,
            dvmRequestTimestamp,
            followUpRequestTime,
            ancillaryData,
            followUpRequest.resolvedPrice
        );
    }

    /**
     * @notice Escalates an Optimistic Oracle-backed router request by bypassing the router forwarding delay.
     * @dev Does not inspect Optimistic Oracle state; operator authorization and router-entry existence are the
     * escalation gate. Operators are trusted to select router requests that should go to the underlying oracle instead
     * of local managed resolution.
     * @param identifier Price identifier for the request.
     * @param dvmRequestTimestamp Timestamp of the router/DVM request to escalate.
     * @param dvmAncillaryData Ancillary data for the router/DVM request.
     */
    function escalateOptimisticOracleRequest(
        bytes32 identifier,
        uint256 dvmRequestTimestamp,
        bytes memory dvmAncillaryData
    )
        external
        onlyOperator
        nonReentrant
    {
        router.escalateNow(identifier, dvmRequestTimestamp, dvmAncillaryData);

        emit OptimisticOracleRequestEscalated(msg.sender, identifier, dvmRequestTimestamp, dvmAncillaryData);
    }

    /**
     * @notice Returns the DVM timestamp that the managed Optimistic Oracle uses for an event-based OO request.
     * @dev Caller must only pass an event-based request. Mirrors ManagedOptimisticOracleV2 proposalTime handling and
     * the legacy fallback for event-based requests created before proposalTime was populated.
     */
    function _getDvmRequestTimestamp(IManagedOptimisticOracleV2ForCouncil.Request memory request)
        private
        pure
        returns (uint256)
    {
        uint256 proposalTime = request.proposalTime;
        if (proposalTime > 0) return proposalTime;

        uint256 liveness = request.requestSettings.customLiveness != 0
            ? request.requestSettings.customLiveness
            : LEGACY_DEFAULT_LIVENESS;
        return request.expirationTime - liveness;
    }

    /**
     * @notice Reverts unless a managed request is disputed and event-based.
     */
    function _requireDisputedEventBasedManagedRequest(
        address requester,
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData,
        IManagedOptimisticOracleV2ForCouncil.Request memory request
    )
        private
        pure
    {
        if (request.disputer == address(0)) {
            revert ManagedRequestNotDisputed(requester, identifier, timestamp, ancillaryData);
        }
        if (!request.requestSettings.eventBased) {
            revert ManagedRequestNotEventBased(requester, identifier, timestamp, ancillaryData);
        }
    }

    /**
     * @notice Reverts unless the caller is an approved operator.
     */
    function _requireOperator() private view {
        if (!operators[msg.sender]) revert CallerNotOperator(msg.sender);
    }
}

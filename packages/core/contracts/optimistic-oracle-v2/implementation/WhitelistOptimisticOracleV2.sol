// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import { AccessControlDefaultAdminRules } from "@openzeppelin/contracts/access/AccessControlDefaultAdminRules.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeMath } from "@openzeppelin/contracts/utils/math/SafeMath.sol";

import { DisableableAddressWhitelistInterface } from "../../common/interfaces/DisableableAddressWhitelistInterface.sol";

import { OptimisticOracleV2 } from "./OptimisticOracleV2.sol";

/**
 * @title Events emitted by the WhitelistOptimisticOracleV2 contract.
 * @notice Contains events for request manager management, bond and liveness updates, and whitelists.
 */
abstract contract WhitelistOptimisticOracleV2Events {
    event RequestManagerAdded(address indexed requestManager);
    event RequestManagerRemoved(address indexed requestManager);
    event MaximumBondUpdated(uint256 newMaximumBond);
    event MinimumLivenessUpdated(uint256 newMinimumLiveness);
    event DefaultProposerWhitelistUpdated(address indexed newWhitelist);
    event RequesterWhitelistUpdated(address indexed newWhitelist);
    event CustomProposerWhitelistSet(
        bytes32 indexed requestId,
        address requester,
        bytes32 indexed identifier,
        bytes ancillaryData,
        address indexed newWhitelist
    );
}

/**
 * @title Optimistic Oracle V2 with whitelist restrictions.
 * @notice Pre-DVM escalation contract that allows faster settlement.
 */
contract WhitelistOptimisticOracleV2 is
    WhitelistOptimisticOracleV2Events,
    OptimisticOracleV2,
    AccessControlDefaultAdminRules
{
    using SafeMath for uint256;

    bytes32 public constant REQUEST_MANAGER = keccak256("REQUEST_MANAGER");

    // Default whitelist for proposers.
    DisableableAddressWhitelistInterface public defaultProposerWhitelist;
    DisableableAddressWhitelistInterface public requesterWhitelist;

    mapping(bytes32 => DisableableAddressWhitelistInterface) public customProposerWhitelists;

    // Owner controlled bounds limiting the changes that can be made by request managers.
    uint256 public maximumBond;
    uint256 public minimumLiveness;

    /**
     * @notice Constructor.
     * @param _liveness default liveness applied to each price request.
     * @param _finderAddress finder to use to get addresses of DVM contracts.
     * @param _timerAddress address of the timer contract. Should be 0x0 in prod.
     * @param _defaultProposerWhitelist address of the default whitelist.
     * @param _requesterWhitelist address of the requester whitelist.
     * @param _maximumBond maximum bond that can be overridden for a request.
     * @param _minimumLiveness minimum liveness that can be overridden for a request.
     * @param _admin address of the admin.
     */
    constructor(
        uint256 _liveness,
        address _finderAddress,
        address _timerAddress,
        address _defaultProposerWhitelist,
        address _requesterWhitelist,
        uint256 _maximumBond,
        uint256 _minimumLiveness,
        address _admin
    ) OptimisticOracleV2(_liveness, _finderAddress, _timerAddress) AccessControlDefaultAdminRules(3 days, _admin) {
        _setDefaultProposerWhitelist(_defaultProposerWhitelist);
        _setRequesterWhitelist(_requesterWhitelist);
        _setMaximumBond(_maximumBond);
        _setMinimumLiveness(_minimumLiveness);
    }

    /**
     * @dev Throws if called by any account other than the owner.
     */
    modifier onlyOwner() {
        _checkRole(DEFAULT_ADMIN_ROLE);
        _;
    }

    /**
     * @dev Throws if called by any account other than the request manager.
     */
    modifier onlyRequestManager() {
        _checkRole(REQUEST_MANAGER);
        _;
    }

    /**
     * @notice Adds a request manager.
     * @dev Only callable by the owner (checked in grantRole of AccessControl).
     * @param requestManager address of the request manager to set.
     */
    function addRequestManager(address requestManager) external nonReentrant() {
        grantRole(REQUEST_MANAGER, requestManager);
        emit RequestManagerAdded(requestManager);
    }

    /**
     * @notice Removes a request manager.
     * @dev Only callable by the owner (checked in revokeRole of AccessControl).
     * @param requestManager address of the request manager to remove.
     */
    function removeRequestManager(address requestManager) external nonReentrant() {
        revokeRole(REQUEST_MANAGER, requestManager);
        emit RequestManagerRemoved(requestManager);
    }

    /**
     * @notice Sets the maximum bond that can be set for a request.
     * @dev This can be used to limit the bond amount that can be set by request managers, callable by the owner.
     * @param _maximumBond new maximum bond amount.
     */
    function setMaximumBond(uint256 _maximumBond) external nonReentrant() onlyOwner() {
        _setMaximumBond(_maximumBond);
    }

    /**
     * @notice Sets the minimum liveness that can be set for a request.
     * @dev This can be used to limit the liveness period that can be set by request managers, callable by the owner.
     * @param _minimumLiveness new minimum liveness period.
     */
    function setMinimumLiveness(uint256 _minimumLiveness) external nonReentrant() onlyOwner() {
        _setMinimumLiveness(_minimumLiveness);
    }

    /**
     * @notice Sets the default proposer whitelist.
     * @dev Only callable by the owner.
     * @param whitelist address of the whitelist to set.
     */
    function setDefaultProposerWhitelist(address whitelist) external nonReentrant() onlyOwner() {
        require(whitelist != address(0), "Whitelist cannot be zero address");
        _setDefaultProposerWhitelist(whitelist);
    }

    /**
     * @notice Sets the requester whitelist.
     * @dev Only callable by the owner.
     * @param whitelist address of the whitelist to set.
     */
    function setRequesterWhitelist(address whitelist) external nonReentrant() onlyOwner() {
        require(whitelist != address(0), "Whitelist cannot be zero address");
        _setRequesterWhitelist(whitelist);
    }

    /**
     * @notice Requests a new price.
     * @param identifier price identifier being requested.
     * @param timestamp timestamp of the price being requested.
     * @param ancillaryData ancillary data representing additional args being passed with the price request.
     * @param currency ERC20 token used for payment of rewards and fees. Must be approved for use with the DVM.
     * @param reward reward offered to a successful proposer. Will be pulled from the caller. Note: this can be 0,
     *               which could make sense if the contract requests and proposes the value in the same call or
     *               provides its own reward system.
     * @return totalBond default bond (final fee) + final fee that the proposer and disputer will be required to pay.
     * This can be changed with a subsequent call to setBond().
     */
    function requestPrice(
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData,
        IERC20 currency,
        uint256 reward
    ) public override returns (uint256 totalBond) {
        require(requesterWhitelist.isOnWhitelist(address(msg.sender)), "Requester not whitelisted");
        return super.requestPrice(identifier, timestamp, ancillaryData, currency, reward);
    }

    /**
     * @notice Set the proposal bond associated with a price request.
     * @param requester sender of the initial price request.
     * @param identifier price identifier to identify the existing request.
     * @param timestamp timestamp to identify the existing request.
     * @param ancillaryData ancillary data of the price being requested.
     * @param bond custom bond amount to set.
     * @return totalBond new bond + final fee that the proposer and disputer will be required to pay. This can be
     * changed again with a subsequent call to setBond().
     */
    function requestManagerSetBond(
        address requester,
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData,
        uint256 bond
    ) external nonReentrant() onlyRequestManager() returns (uint256 totalBond) {
        require(_getState(requester, identifier, timestamp, ancillaryData) == State.Requested, "setBond: Requested");
        _validateBond(bond);
        Request storage request = _getRequest(requester, identifier, timestamp, ancillaryData);
        request.requestSettings.bond = bond;

        // Total bond is the final fee + the newly set bond.
        return bond.add(request.finalFee);
    }

    /**
     * @notice Sets a custom liveness value for the request. Liveness is the amount of time a proposal must wait before
     * being auto-resolved.
     * @param requester sender of the initial price request.
     * @param identifier price identifier to identify the existing request.
     * @param timestamp timestamp to identify the existing request.
     * @param ancillaryData ancillary data of the price being requested.
     * @param customLiveness new custom liveness.
     */
    function requestManagerSetCustomLiveness(
        address requester,
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData,
        uint256 customLiveness
    ) external nonReentrant() onlyRequestManager() {
        require(
            _getState(requester, identifier, timestamp, ancillaryData) == State.Requested,
            "setCustomLiveness: Requested"
        );
        _validateLiveness(customLiveness);
        _getRequest(requester, identifier, timestamp, ancillaryData).requestSettings.customLiveness = customLiveness;
    }

    /**
     * @notice Sets the proposer whitelist for a request.
     * @dev This can also be set in advance of the request as the timestamp is omitted from the mapping key derivation.
     * @param requester sender of the initial price request.
     * @param identifier price identifier to identify the existing request.
     * @param ancillaryData ancillary data of the price being requested.
     * @param whitelist address of the whitelist to set.
     */
    function requestManagerSetProposerWhitelist(
        address requester,
        bytes32 identifier,
        bytes memory ancillaryData,
        address whitelist
    ) external nonReentrant() onlyRequestManager() {
        bytes32 requestId = _getId(requester, identifier, 0, ancillaryData);
        customProposerWhitelists[requestId] = DisableableAddressWhitelistInterface(whitelist);
        emit CustomProposerWhitelistSet(requestId, requester, identifier, ancillaryData, whitelist);
    }

    /**
     * @notice Proposes a price value on another address' behalf. Note: this address will receive any rewards that come
     * from this proposal. However, any bonds are pulled from the caller.
     * @dev Timestamp is omitted from the whitelist key derivation, so it would also apply for repeated requests.
     * @param proposer address to set as the proposer.
     * @param requester sender of the initial price request.
     * @param identifier price identifier to identify the existing request.
     * @param timestamp timestamp to identify the existing request.
     * @param ancillaryData ancillary data of the price being requested.
     * @param proposedPrice price being proposed.
     * @return totalBond the amount that's pulled from the caller's wallet as a bond. The bond will be returned to
     * the proposer once settled if the proposal is correct.
     */
    function proposePriceFor(
        address proposer,
        address requester,
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData,
        int256 proposedPrice
    ) public override returns (uint256 totalBond) {
        DisableableAddressWhitelistInterface whitelist =
            _getEffectiveProposerWhitelist(requester, identifier, ancillaryData);

        require(whitelist.isOnWhitelist(proposer), "Proposer not whitelisted");
        return super.proposePriceFor(proposer, requester, identifier, timestamp, ancillaryData, proposedPrice);
    }

    /**
     * @notice Gets the custom proposer whitelist for a request.
     * @dev This omits the timestamp from the key derivation, so the whitelist might have been set in advance of the
     * request.
     * @param requester sender of the initial price request.
     * @param identifier price identifier to identify the existing request.
     * @param ancillaryData ancillary data of the price being requested.
     * @return AddressWhitelistInterface the custom proposer whitelist for the request or zero address if not set.
     */
    function getCustomProposerWhitelist(
        address requester,
        bytes32 identifier,
        bytes memory ancillaryData
    ) external view returns (DisableableAddressWhitelistInterface) {
        return customProposerWhitelists[_getId(requester, identifier, 0, ancillaryData)];
    }

    /**
     * @notice Returns the proposer whitelist and enforcement status for a given request.
     * @dev If no custom proposer whitelist is set for the request, the default proposer whitelist is used.
     * If whitelist enforcement is disabled, the returned proposer list will be empty and isEnforced will be false,
     * indicating that any address is allowed to propose.
     * @param requester The address that made or will make the price request.
     * @param identifier The identifier of the price request.
     * @param ancillaryData Additional data used to uniquely identify the request.
     * @return allowedProposers The list of addresses allowed to propose, if enforcement is enabled. Otherwise, an empty array.
     * @return isEnforced A boolean indicating whether whitelist enforcement is active for this request.
     */
    function getProposerWhitelistWithEnforcementStatus(
        address requester,
        bytes32 identifier,
        bytes memory ancillaryData
    ) external view returns (address[] memory allowedProposers, bool isEnforced) {
        DisableableAddressWhitelistInterface whitelist =
            _getEffectiveProposerWhitelist(requester, identifier, ancillaryData);
        isEnforced = whitelist.isEnforced();
        allowedProposers = isEnforced ? whitelist.getWhitelist() : new address[](0);
        return (allowedProposers, isEnforced);
    }

    /**
     * @notice Gets the internal request ID for a price request (without timestamp).
     * @dev This is just a helper function that offchain systems can use for tracking the indexed
     * CustomProposerWhitelistSet events.
     * @param requester sender of the initial price request.
     * @param identifier price identifier to identify the existing request.
     * @param ancillaryData ancillary data of the price being requested.
     * @return bytes32 the request ID for the advance request.
     */
    function getInternalRequestId(
        address requester,
        bytes32 identifier,
        bytes memory ancillaryData
    ) external pure returns (bytes32) {
        return _getId(requester, identifier, 0, ancillaryData);
    }

    /**
     * @notice Sets the maximum bond that can be set for a request.
     * @dev This can be used to limit the bond amount that can be set by request managers.
     * @param _maximumBond new maximum bond amount.
     */
    function _setMaximumBond(uint256 _maximumBond) internal {
        maximumBond = _maximumBond;
        emit MaximumBondUpdated(_maximumBond);
    }

    /**
     * @notice Sets the minimum liveness that can be set for a request.
     * @dev This can be used to limit the liveness period that can be set by request managers.
     * @param _minimumLiveness new minimum liveness period.
     */
    function _setMinimumLiveness(uint256 _minimumLiveness) internal {
        minimumLiveness = _minimumLiveness;
        emit MinimumLivenessUpdated(_minimumLiveness);
    }

    /**
     * @notice Sets the default proposer whitelist.
     * @param whitelist address of the whitelist to set.
     */
    function _setDefaultProposerWhitelist(address whitelist) internal {
        defaultProposerWhitelist = DisableableAddressWhitelistInterface(whitelist);
        emit DefaultProposerWhitelistUpdated(whitelist);
    }

    /**
     * @notice Sets the requester whitelist.
     * @param whitelist address of the whitelist to set.
     */
    function _setRequesterWhitelist(address whitelist) internal {
        requesterWhitelist = DisableableAddressWhitelistInterface(whitelist);
        emit RequesterWhitelistUpdated(whitelist);
    }

    /**
     * @notice Validates the bond amount.
     * @dev Reverts if the bond exceeds the maximum bond amount (controllable by the owner).
     * @param bond the bond amount to validate.
     */
    function _validateBond(uint256 bond) internal view {
        require(bond <= maximumBond, "Bond exceeds maximum bond");
    }

    /**
     * @notice Validates the liveness period.
     * @dev Reverts if the liveness period is less than the minimum liveness (controllable by the owner) or above the
     * maximum liveness (which is set in the parent contract).
     * @param liveness the liveness period to validate.
     */
    function _validateLiveness(uint256 liveness) internal view override {
        require(liveness >= minimumLiveness, "Liveness is less than minimum");
        super._validateLiveness(liveness);
    }

    /**
     * @notice Gets the effective proposer whitelist contract for a given request.
     * @dev Returns the custom proposer whitelist if set; otherwise falls back to the default. Timestamp is omitted from
     * the key derivation, so this can be used for checks before the request is made.
     * @param requester The address that made or will make the price request.
     * @param identifier The identifier of the price request.
     * @param ancillaryData Additional data used to uniquely identify the request.
     * @return whitelist The effective DisableableAddressWhitelistInterface for the request.
     */
    function _getEffectiveProposerWhitelist(
        address requester,
        bytes32 identifier,
        bytes memory ancillaryData
    ) internal view returns (DisableableAddressWhitelistInterface whitelist) {
        whitelist = customProposerWhitelists[_getId(requester, identifier, 0, ancillaryData)];
        if (address(whitelist) == address(0)) {
            whitelist = defaultProposerWhitelist;
        }
    }
}

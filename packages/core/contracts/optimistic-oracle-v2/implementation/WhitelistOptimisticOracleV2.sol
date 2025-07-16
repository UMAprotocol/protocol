// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import { AccessControlDefaultAdminRules } from "@openzeppelin/contracts/access/AccessControlDefaultAdminRules.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeMath } from "@openzeppelin/contracts/utils/math/SafeMath.sol";

import { AddressWhitelistInterface } from "../../common/interfaces/AddressWhitelistInterface.sol";

import { OptimisticOracleV2 } from "./OptimisticOracleV2.sol";

/**
 * @title Optimistic Oracle.
 * @notice Pre-DVM escalation contract that allows faster settlement.
 */
contract WhitelistOptimisticOracleV2 is OptimisticOracleV2, AccessControlDefaultAdminRules {
    using SafeMath for uint256;

    bytes32 public constant REQUEST_MANAGER = keccak256("REQUEST_MANAGER");

    // Default whitelist for proposers.
    AddressWhitelistInterface public defaultProposerWhitelist;
    AddressWhitelistInterface public requesterWhitelist;

    mapping(bytes32 => AddressWhitelistInterface) public customProposerWhitelists;

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
        defaultProposerWhitelist = AddressWhitelistInterface(_defaultProposerWhitelist);
        requesterWhitelist = AddressWhitelistInterface(_requesterWhitelist);
        maximumBond = _maximumBond;
        minimumLiveness = _minimumLiveness;
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
    }

    /**
     * @notice Removes a request manager.
     * @dev Only callable by the owner (checked in revokeRole of AccessControl).
     * @param requestManager address of the request manager to remove.
     */
    function removeRequestManager(address requestManager) external nonReentrant() {
        revokeRole(REQUEST_MANAGER, requestManager);
    }

    /**
     * @notice Sets the maximum bond that can be set for a request.
     * @dev This can be used to limit the bond amount that can be set by request managers.
     * @param _maximumBond new maximum bond amount.
     */
    function setMaximumBond(uint256 _maximumBond) external nonReentrant() onlyOwner() {
        maximumBond = _maximumBond;
    }

    /**
     * @notice Sets the minimum liveness that can be set for a request.
     * @dev This can be used to limit the liveness period that can be set by request managers.
     * @param _minimumLiveness new minimum liveness period.
     */
    function setMinimumLiveness(uint256 _minimumLiveness) external nonReentrant() onlyOwner() {
        minimumLiveness = _minimumLiveness;
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
        customProposerWhitelists[_getId(requester, identifier, 0, ancillaryData)] = AddressWhitelistInterface(
            whitelist
        );
    }

    /**
     * @notice Sets the default proposer whitelist.
     * @param whitelist address of the whitelist to set.
     */
    function ownerSetProposerWhitelist(address whitelist) external nonReentrant() onlyOwner() {
        defaultProposerWhitelist = AddressWhitelistInterface(whitelist);
    }

    /**
     * @notice Sets the requester whitelist.
     * @param whitelist address of the whitelist to set.
     */
    function ownerSetRequesterWhitelist(address whitelist) external nonReentrant() onlyOwner() {
        requesterWhitelist = AddressWhitelistInterface(whitelist);
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
        AddressWhitelistInterface whitelist = customProposerWhitelists[_getId(requester, identifier, 0, ancillaryData)];
        if (address(whitelist) == address(0)) {
            whitelist = defaultProposerWhitelist;
        }

        require(whitelist.isOnWhitelist(proposer) || msg.sender == owner(), "Proposer not whitelisted");
        return super.proposePriceFor(proposer, requester, identifier, timestamp, ancillaryData, proposedPrice);
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
}

/*
 * @title AllowAllList
 * @notice A whitelist that allows all addresses.
 * This can be used to effectively disable whitelist restrictions the WhitelistOptimisticOracleV2.
 */
contract AllowAllList is AddressWhitelistInterface {
    /**
     * @notice Checks whether an address is on the whitelist.
     * @param elementToCheck address to check.
     * @return true, as all addresses are considered whitelisted.
     */
    function isOnWhitelist(address elementToCheck) external pure returns (bool) {
        elementToCheck; // Silence unused variable warning
        return true;
    }

    /**
     * @notice Adds an address to the whitelist.
     * @dev This function is not supported in this contract.
     * @param newElement address to add to the whitelist.
     */
    function addToWhitelist(address newElement) external pure {
        newElement; // Silence unused variable warning
        revert("Not supported");
    }

    /**
     * @notice Removes an address from the whitelist.
     * @dev This function is not supported in this contract.
     * @param elementToRemove address to remove from the whitelist.
     */
    function removeFromWhitelist(address elementToRemove) external pure {
        elementToRemove; // Silence unused variable warning
        revert("Not supported");
    }

    /**
     * @notice Gets all addresses that are currently included in the whitelist.
     * @dev This function is not supported in this contract.
     * @return activeWhitelist the list of addresses on the whitelist (always reverts in this contract).
     */
    function getWhitelist() external pure returns (address[] memory) {
        revert("Not supported");
    }
}

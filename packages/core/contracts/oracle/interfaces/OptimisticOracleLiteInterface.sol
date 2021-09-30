// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/OptimisticOracleInterface.sol";

/**
 * @title Interface for the gas-cost-reduced version of the OptimisticOracle
 * @dev Interface used by financial contracts to interact with the Oracle. Voters will use a different interface.
 */
abstract contract OptimisticOracleLiteInterface {
    // Struct representing a price request. Note that this differs from the OptimisticOracleInterface's Request struct
    // in that refundOnDispute is removed.
    struct Request {
        address proposer; // Address of the proposer.
        address disputer; // Address of the disputer.
        IERC20 currency; // ERC20 token used to pay rewards and fees.
        bool settled; // True if the request is settled.
        int256 proposedPrice; // Price that the proposer submitted.
        int256 resolvedPrice; // Price resolved once the request is settled.
        uint256 expirationTime; // Time at which the request auto-settles without a dispute.
        uint256 reward; // Amount of the currency to pay to the proposer on settlement.
        uint256 finalFee; // Final fee to pay to the Store upon request to the DVM.
        uint256 bond; // Bond that the proposer and disputer must pay on top of the final fee.
        uint256 customLiveness; // Custom liveness value set by the requester.
    }

    // This value must be <= the Voting contract's `ancillaryBytesLimit` value otherwise it is possible
    // that a price can be requested to this contract successfully, but cannot be disputed because the DVM refuses
    // to accept a price request made with ancillary data length over a certain size.
    uint256 public constant ancillaryBytesLimit = 8192;

    /**
     * @notice Requests a new price.
     * @param _identifier price identifier being requested.
     * @param _timestamp timestamp of the price being requested.
     * @param _ancillaryData ancillary data representing additional args being passed with the price request.
     * @param _currency ERC20 token used for payment of rewards and fees. Must be approved for use with the DVM.
     * @param _reward reward offered to a successful proposer. Will be pulled from the caller. Note: this can be 0,
     *               which could make sense if the contract requests and proposes the value in the same call or
     *               provides its own reward system.
     * @param _bond custom proposal bond to set for request. If set to 0, defaults to the final fee.
     * @param _customLiveness custom proposal liveness to set for request.
     * @return totalBond default bond + final fee that the proposer and disputer will be required to pay.
     */
    function requestPrice(
        bytes32 _identifier,
        uint256 _timestamp,
        bytes memory _ancillaryData,
        IERC20 _currency,
        uint256 _reward,
        uint256 _bond,
        uint256 _customLiveness
    ) external virtual returns (uint256 totalBond);

    /**
     * @notice Proposes a price value on another address' behalf. Note: this address will receive any rewards that come
     * from this proposal. However, any bonds are pulled from the caller.
     * @param _requester sender of the initial price request.
     * @param _identifier price identifier to identify the existing request.
     * @param _timestamp timestamp to identify the existing request.
     * @param _ancillaryData ancillary data of the price being requested.
     * @param _request price request parameters whose hash must match the request that the caller wants to
     * propose a price for.
     * @param _proposer address to set as the proposer.
     * @param _proposedPrice price being proposed.
     * @return totalBond the amount that's pulled from the caller's wallet as a bond. The bond will be returned to
     * the proposer once settled if the proposal is correct.
     */
    function proposePriceFor(
        address _requester,
        bytes32 _identifier,
        uint256 _timestamp,
        bytes memory _ancillaryData,
        Request memory _request,
        address _proposer,
        int256 _proposedPrice
    ) public virtual returns (uint256 totalBond);

    /**
     * @notice Proposes a price value where caller is the proposer.
     * @param _requester sender of the initial price request.
     * @param _identifier price identifier to identify the existing request.
     * @param _timestamp timestamp to identify the existing request.
     * @param _ancillaryData ancillary data of the price being requested.
     * @param _request price request parameters whose hash must match the request that the caller wants to
     * propose a price for.
     * @param _proposedPrice price being proposed.
     * @return totalBond the amount that's pulled from the caller's wallet as a bond. The bond will be returned to
     * the proposer once settled if the proposal is correct.
     */
    function proposePrice(
        address _requester,
        bytes32 _identifier,
        uint256 _timestamp,
        bytes memory _ancillaryData,
        Request memory _request,
        int256 _proposedPrice
    ) external virtual returns (uint256 totalBond);

    /**
     * @notice Combines logic of requestPrice and proposePrice while taking advantage of gas savings from not having to
     * overwrite Request params that a normal requestPrice() => proposePrice() flow would entail. Note: The proposer
     * will receive any rewards that come from this proposal. However, any bonds are pulled from the caller.
     * @dev The caller is the requester, but the proposer can be customized.
     * @param _identifier price identifier to identify the existing request.
     * @param _timestamp timestamp to identify the existing request.
     * @param _ancillaryData ancillary data of the price being requested.
     * @param _currency ERC20 token used for payment of rewards and fees. Must be approved for use with the DVM.
     * @param _reward reward offered to a successful proposer. Will be pulled from the caller. Note: this can be 0,
     *               which could make sense if the contract requests and proposes the value in the same call or
     *               provides its own reward system.
     * @param _bond custom proposal bond to set for request. If set to 0, defaults to the final fee.
     * @param _customLiveness custom proposal liveness to set for request.
     * @param _proposer address to set as the proposer.
     * @param _proposedPrice price being proposed.
     * @return totalBond the amount that's pulled from the caller's wallet as a bond. The bond will be returned to
     * the proposer once settled if the proposal is correct.
     */
    function requestAndProposePriceFor(
        bytes32 _identifier,
        uint256 _timestamp,
        bytes memory _ancillaryData,
        IERC20 _currency,
        uint256 _reward,
        uint256 _bond,
        uint256 _customLiveness,
        address _proposer,
        int256 _proposedPrice
    ) external virtual returns (uint256 totalBond);

    /**
     * @notice Disputes a price request with an active proposal on another address' behalf. Note: this address will
     * receive any rewards that come from this dispute. However, any bonds are pulled from the caller.
     * @param _identifier price identifier to identify the existing request.
     * @param _timestamp timestamp to identify the existing request.
     * @param _ancillaryData ancillary data of the price being requested.
     * @param _request price request parameters whose hash must match the request that the caller wants to
     * dispute.
     * @param _disputer address to set as the disputer.
     * @param _requester sender of the initial price request.
     * @return totalBond the amount that's pulled from the caller's wallet as a bond. The bond will be returned to
     * the disputer once settled if the dispute was valid (the proposal was incorrect).
     */
    function disputePriceFor(
        bytes32 _identifier,
        uint256 _timestamp,
        bytes memory _ancillaryData,
        Request memory _request,
        address _disputer,
        address _requester
    ) public virtual returns (uint256 totalBond);

    /**
     * @notice Disputes a price request with an active proposal where caller is the disputer.
     * @param _requester sender of the initial price request.
     * @param _identifier price identifier to identify the existing request.
     * @param _timestamp timestamp to identify the existing request.
     * @param _ancillaryData ancillary data of the price being requested.
     * @param _request price request parameters whose hash must match the request that the caller wants to
     * dispute.
     * @return totalBond the amount that's pulled from the caller's wallet as a bond. The bond will be returned to
     * the disputer once settled if the dispute was valid (the proposal was incorrect).
     */
    function disputePrice(
        address _requester,
        bytes32 _identifier,
        uint256 _timestamp,
        bytes memory _ancillaryData,
        Request memory _request
    ) external virtual returns (uint256 totalBond);

    /**
     * @notice Attempts to settle an outstanding price request. Will revert if it isn't settleable.
     * @param _requester sender of the initial price request.
     * @param _identifier price identifier to identify the existing request.
     * @param _timestamp timestamp to identify the existing request.
     * @param _ancillaryData ancillary data of the price being requested.
     * @param _request price request parameters whose hash must match the request that the caller wants to
     * settle.
     * @return payout the amount that the "winner" (proposer or disputer) receives on settlement. This amount includes
     * the returned bonds as well as additional rewards.
     * @return resolvedPrice the price that the request settled to.
     */
    function settle(
        address _requester,
        bytes32 _identifier,
        uint256 _timestamp,
        bytes memory _ancillaryData,
        Request memory _request
    ) external virtual returns (uint256 payout, int256 resolvedPrice);

    /**
     * @notice Computes the current state of a price request. See the State enum for more details.
     * @param _requester sender of the initial price request.
     * @param _identifier price identifier to identify the existing request.
     * @param _timestamp timestamp to identify the existing request.
     * @param _ancillaryData ancillary data of the price being requested.
     * @param _request price request parameters.
     * @return the State.
     */
    function getState(
        address _requester,
        bytes32 _identifier,
        uint256 _timestamp,
        bytes memory _ancillaryData,
        Request memory _request
    ) external virtual returns (OptimisticOracleInterface.State);

    /**
     * @notice Checks if a given request has resolved, expired or been settled (i.e the optimistic oracle has a price).
     * @param _requester sender of the initial price request.
     * @param _identifier price identifier to identify the existing request.
     * @param _timestamp timestamp to identify the existing request.
     * @param _ancillaryData ancillary data of the price being requested.
     * @param _request price request parameters. The hash of these parameters must match with the request hash that is
     * associated with the price request unique ID {requester, identifier, timestamp, ancillaryData}, or this method
     * will revert.
     * @return boolean indicating true if price exists and false if not.
     */
    function hasPrice(
        address _requester,
        bytes32 _identifier,
        uint256 _timestamp,
        bytes memory _ancillaryData,
        Request memory _request
    ) public virtual returns (bool);

    /**
     * @notice Generates stamped ancillary data in the format that it would be used in the case of a price dispute.
     * @param _ancillaryData ancillary data of the price being requested.
     * @param _requester sender of the initial price request.
     * @return the stamped ancillary bytes.
     */
    function stampAncillaryData(bytes memory _ancillaryData, address _requester)
        public
        pure
        virtual
        returns (bytes memory);
}

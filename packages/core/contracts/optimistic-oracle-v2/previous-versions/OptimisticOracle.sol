// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

// WARNING: This contract has been deprecated! It is left in the UMA Protocol repo for backwards compatibility reasons.
// You should refer to the latest implementation of the Optimistic Oracle which is named OptimisticOracleV2 and can
// be found in the UMA Finder under the same name.

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/Address.sol";

import "../../data-verification-mechanism/interfaces/StoreInterface.sol";
import "../../data-verification-mechanism/interfaces/OracleAncillaryInterface.sol";
import "../../data-verification-mechanism/interfaces/FinderInterface.sol";
import "../../data-verification-mechanism/interfaces/IdentifierWhitelistInterface.sol";
import "../interfaces/OptimisticOracleInterface.sol";
import "../../data-verification-mechanism/implementation/Constants.sol";

import "../../common/implementation/Testable.sol";
import "../../common/implementation/Lockable.sol";
import "../../common/implementation/FixedPoint.sol";
import "../../common/implementation/AncillaryData.sol";
import "../../common/implementation/AddressWhitelist.sol";

/**
 * @title Optimistic Requester.
 * @notice Optional interface that requesters can implement to receive callbacks.
 * @dev this contract does _not_ work with ERC777 collateral currencies or any others that call into the receiver on
 * transfer(). Using an ERC777 token would allow a user to maliciously grief other participants (while also losing
 * money themselves).
 */
interface OptimisticRequester {
    /**
     * @notice Callback for proposals.
     * @param identifier price identifier being requested.
     * @param timestamp timestamp of the price being requested.
     * @param ancillaryData ancillary data of the price being requested.
     */
    function priceProposed(
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData
    ) external;

    /**
     * @notice Callback for disputes.
     * @param identifier price identifier being requested.
     * @param timestamp timestamp of the price being requested.
     * @param ancillaryData ancillary data of the price being requested.
     * @param refund refund received in the case that refundOnDispute was enabled.
     */
    function priceDisputed(
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData,
        uint256 refund
    ) external;

    /**
     * @notice Callback for settlement.
     * @param identifier price identifier being requested.
     * @param timestamp timestamp of the price being requested.
     * @param ancillaryData ancillary data of the price being requested.
     * @param price price that was resolved by the escalation process.
     */
    function priceSettled(
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData,
        int256 price
    ) external;
}

/**
 * @title Optimistic Oracle.
 * @notice Pre-DVM escalation contract that allows faster settlement.
 */
contract OptimisticOracle is OptimisticOracleInterface, Testable, Lockable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    using Address for address;

    // Finder to provide addresses for DVM contracts.
    FinderInterface public override finder;

    // Default liveness value for all price requests.
    uint256 public override defaultLiveness;

    /**
     * @notice Constructor.
     * @param _liveness default liveness applied to each price request.
     * @param _finderAddress finder to use to get addresses of DVM contracts.
     * @param _timerAddress address of the timer contract. Should be 0x0 in prod.
     */
    constructor(
        uint256 _liveness,
        address _finderAddress,
        address _timerAddress
    ) Testable(_timerAddress) {
        finder = FinderInterface(_finderAddress);
        _validateLiveness(_liveness);
        defaultLiveness = _liveness;
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
    ) external override nonReentrant() returns (uint256 totalBond) {
        require(_getState(msg.sender, identifier, timestamp, ancillaryData) == State.Invalid, "requestPrice: Invalid");
        require(_getIdentifierWhitelist().isIdentifierSupported(identifier), "Unsupported identifier");
        require(_getCollateralWhitelist().isOnWhitelist(address(currency)), "Unsupported currency");
        require(timestamp <= getCurrentTime(), "Timestamp in future");
        require(
            _stampAncillaryData(ancillaryData, msg.sender).length <= ancillaryBytesLimit,
            "Ancillary Data too long"
        );
        uint256 finalFee = _getStore().computeFinalFee(address(currency)).rawValue;
        requests[_getId(msg.sender, identifier, timestamp, ancillaryData)] = Request({
            proposer: address(0),
            disputer: address(0),
            currency: currency,
            settled: false,
            refundOnDispute: false,
            proposedPrice: 0,
            resolvedPrice: 0,
            expirationTime: 0,
            reward: reward,
            finalFee: finalFee,
            bond: finalFee,
            customLiveness: 0
        });

        if (reward > 0) {
            currency.safeTransferFrom(msg.sender, address(this), reward);
        }

        emit RequestPrice(msg.sender, identifier, timestamp, ancillaryData, address(currency), reward, finalFee);

        // This function returns the initial proposal bond for this request, which can be customized by calling
        // setBond() with the same identifier and timestamp.
        return finalFee.mul(2);
    }

    /**
     * @notice Set the proposal bond associated with a price request.
     * @param identifier price identifier to identify the existing request.
     * @param timestamp timestamp to identify the existing request.
     * @param ancillaryData ancillary data of the price being requested.
     * @param bond custom bond amount to set.
     * @return totalBond new bond + final fee that the proposer and disputer will be required to pay. This can be
     * changed again with a subsequent call to setBond().
     */
    function setBond(
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData,
        uint256 bond
    ) external override nonReentrant() returns (uint256 totalBond) {
        require(_getState(msg.sender, identifier, timestamp, ancillaryData) == State.Requested, "setBond: Requested");
        Request storage request = _getRequest(msg.sender, identifier, timestamp, ancillaryData);
        request.bond = bond;

        // Total bond is the final fee + the newly set bond.
        return bond.add(request.finalFee);
    }

    /**
     * @notice Sets the request to refund the reward if the proposal is disputed. This can help to "hedge" the caller
     * in the event of a dispute-caused delay. Note: in the event of a dispute, the winner still receives the other's
     * bond, so there is still profit to be made even if the reward is refunded.
     * @param identifier price identifier to identify the existing request.
     * @param timestamp timestamp to identify the existing request.
     * @param ancillaryData ancillary data of the price being requested.
     */
    function setRefundOnDispute(
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData
    ) external override nonReentrant() {
        require(
            _getState(msg.sender, identifier, timestamp, ancillaryData) == State.Requested,
            "setRefundOnDispute: Requested"
        );
        _getRequest(msg.sender, identifier, timestamp, ancillaryData).refundOnDispute = true;
    }

    /**
     * @notice Sets a custom liveness value for the request. Liveness is the amount of time a proposal must wait before
     * being auto-resolved.
     * @param identifier price identifier to identify the existing request.
     * @param timestamp timestamp to identify the existing request.
     * @param ancillaryData ancillary data of the price being requested.
     * @param customLiveness new custom liveness.
     */
    function setCustomLiveness(
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData,
        uint256 customLiveness
    ) external override nonReentrant() {
        require(
            _getState(msg.sender, identifier, timestamp, ancillaryData) == State.Requested,
            "setCustomLiveness: Requested"
        );
        _validateLiveness(customLiveness);
        _getRequest(msg.sender, identifier, timestamp, ancillaryData).customLiveness = customLiveness;
    }

    /**
     * @notice Proposes a price value on another address' behalf. Note: this address will receive any rewards that come
     * from this proposal. However, any bonds are pulled from the caller.
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
    ) public override nonReentrant() returns (uint256 totalBond) {
        require(proposer != address(0), "proposer address must be non 0");
        require(
            _getState(requester, identifier, timestamp, ancillaryData) == State.Requested,
            "proposePriceFor: Requested"
        );
        Request storage request = _getRequest(requester, identifier, timestamp, ancillaryData);
        request.proposer = proposer;
        request.proposedPrice = proposedPrice;

        // If a custom liveness has been set, use it instead of the default.
        request.expirationTime = getCurrentTime().add(
            request.customLiveness != 0 ? request.customLiveness : defaultLiveness
        );

        totalBond = request.bond.add(request.finalFee);
        if (totalBond > 0) {
            request.currency.safeTransferFrom(msg.sender, address(this), totalBond);
        }

        emit ProposePrice(
            requester,
            proposer,
            identifier,
            timestamp,
            ancillaryData,
            proposedPrice,
            request.expirationTime,
            address(request.currency)
        );

        // Callback.
        if (address(requester).isContract())
            try OptimisticRequester(requester).priceProposed(identifier, timestamp, ancillaryData) {} catch {}
    }

    /**
     * @notice Proposes a price value for an existing price request.
     * @param requester sender of the initial price request.
     * @param identifier price identifier to identify the existing request.
     * @param timestamp timestamp to identify the existing request.
     * @param ancillaryData ancillary data of the price being requested.
     * @param proposedPrice price being proposed.
     * @return totalBond the amount that's pulled from the proposer's wallet as a bond. The bond will be returned to
     * the proposer once settled if the proposal is correct.
     */
    function proposePrice(
        address requester,
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData,
        int256 proposedPrice
    ) external override returns (uint256 totalBond) {
        // Note: re-entrancy guard is done in the inner call.
        return proposePriceFor(msg.sender, requester, identifier, timestamp, ancillaryData, proposedPrice);
    }

    /**
     * @notice Disputes a price request with an active proposal on another address' behalf. Note: this address will
     * receive any rewards that come from this dispute. However, any bonds are pulled from the caller.
     * @param disputer address to set as the disputer.
     * @param requester sender of the initial price request.
     * @param identifier price identifier to identify the existing request.
     * @param timestamp timestamp to identify the existing request.
     * @param ancillaryData ancillary data of the price being requested.
     * @return totalBond the amount that's pulled from the caller's wallet as a bond. The bond will be returned to
     * the disputer once settled if the dispute was valid (the proposal was incorrect).
     */
    function disputePriceFor(
        address disputer,
        address requester,
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData
    ) public override nonReentrant() returns (uint256 totalBond) {
        require(disputer != address(0), "disputer address must be non 0");
        require(
            _getState(requester, identifier, timestamp, ancillaryData) == State.Proposed,
            "disputePriceFor: Proposed"
        );
        Request storage request = _getRequest(requester, identifier, timestamp, ancillaryData);
        request.disputer = disputer;

        uint256 finalFee = request.finalFee;
        uint256 bond = request.bond;
        totalBond = bond.add(finalFee);
        if (totalBond > 0) {
            request.currency.safeTransferFrom(msg.sender, address(this), totalBond);
        }

        StoreInterface store = _getStore();

        // Avoids stack too deep compilation error.
        {
            // Along with the final fee, "burn" part of the loser's bond to ensure that a larger bond always makes it
            // proportionally more expensive to delay the resolution even if the proposer and disputer are the same
            // party.
            uint256 burnedBond = _computeBurnedBond(request);

            // The total fee is the burned bond and the final fee added together.
            uint256 totalFee = finalFee.add(burnedBond);

            if (totalFee > 0) {
                request.currency.safeIncreaseAllowance(address(store), totalFee);
                _getStore().payOracleFeesErc20(address(request.currency), FixedPoint.Unsigned(totalFee));
            }
        }

        _getOracle().requestPrice(identifier, timestamp, _stampAncillaryData(ancillaryData, requester));

        // Compute refund.
        uint256 refund = 0;
        if (request.reward > 0 && request.refundOnDispute) {
            refund = request.reward;
            request.reward = 0;
            request.currency.safeTransfer(requester, refund);
        }

        emit DisputePrice(
            requester,
            request.proposer,
            disputer,
            identifier,
            timestamp,
            ancillaryData,
            request.proposedPrice
        );

        // Callback.
        if (address(requester).isContract())
            try OptimisticRequester(requester).priceDisputed(identifier, timestamp, ancillaryData, refund) {} catch {}
    }

    /**
     * @notice Disputes a price value for an existing price request with an active proposal.
     * @param requester sender of the initial price request.
     * @param identifier price identifier to identify the existing request.
     * @param timestamp timestamp to identify the existing request.
     * @param ancillaryData ancillary data of the price being requested.
     * @return totalBond the amount that's pulled from the disputer's wallet as a bond. The bond will be returned to
     * the disputer once settled if the dispute was valid (the proposal was incorrect).
     */
    function disputePrice(
        address requester,
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData
    ) external override returns (uint256 totalBond) {
        // Note: re-entrancy guard is done in the inner call.
        return disputePriceFor(msg.sender, requester, identifier, timestamp, ancillaryData);
    }

    /**
     * @notice Retrieves a price that was previously requested by a caller. Reverts if the request is not settled
     * or settleable. Note: this method is not view so that this call may actually settle the price request if it
     * hasn't been settled.
     * @param identifier price identifier to identify the existing request.
     * @param timestamp timestamp to identify the existing request.
     * @param ancillaryData ancillary data of the price being requested.
     * @return resolved price.
     */
    function settleAndGetPrice(
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData
    ) external override nonReentrant() returns (int256) {
        if (_getState(msg.sender, identifier, timestamp, ancillaryData) != State.Settled) {
            _settle(msg.sender, identifier, timestamp, ancillaryData);
        }

        return _getRequest(msg.sender, identifier, timestamp, ancillaryData).resolvedPrice;
    }

    /**
     * @notice Attempts to settle an outstanding price request. Will revert if it isn't settleable.
     * @param requester sender of the initial price request.
     * @param identifier price identifier to identify the existing request.
     * @param timestamp timestamp to identify the existing request.
     * @param ancillaryData ancillary data of the price being requested.
     * @return payout the amount that the "winner" (proposer or disputer) receives on settlement. This amount includes
     * the returned bonds as well as additional rewards.
     */
    function settle(
        address requester,
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData
    ) external override nonReentrant() returns (uint256 payout) {
        return _settle(requester, identifier, timestamp, ancillaryData);
    }

    /**
     * @notice Gets the current data structure containing all information about a price request.
     * @param requester sender of the initial price request.
     * @param identifier price identifier to identify the existing request.
     * @param timestamp timestamp to identify the existing request.
     * @param ancillaryData ancillary data of the price being requested.
     * @return the Request data structure.
     */
    function getRequest(
        address requester,
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData
    ) public view override nonReentrantView() returns (Request memory) {
        return _getRequest(requester, identifier, timestamp, ancillaryData);
    }

    /**
     * @notice Computes the current state of a price request. See the State enum for more details.
     * @param requester sender of the initial price request.
     * @param identifier price identifier to identify the existing request.
     * @param timestamp timestamp to identify the existing request.
     * @param ancillaryData ancillary data of the price being requested.
     * @return the State.
     */
    function getState(
        address requester,
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData
    ) public view override nonReentrantView() returns (State) {
        return _getState(requester, identifier, timestamp, ancillaryData);
    }

    /**
     * @notice Checks if a given request has resolved, expired or been settled (i.e the optimistic oracle has a price).
     * @param requester sender of the initial price request.
     * @param identifier price identifier to identify the existing request.
     * @param timestamp timestamp to identify the existing request.
     * @param ancillaryData ancillary data of the price being requested.
     * @return boolean indicating true if price exists and false if not.
     */
    function hasPrice(
        address requester,
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData
    ) public view override nonReentrantView() returns (bool) {
        State state = _getState(requester, identifier, timestamp, ancillaryData);
        return state == State.Settled || state == State.Resolved || state == State.Expired;
    }

    /**
     * @notice Generates stamped ancillary data in the format that it would be used in the case of a price dispute.
     * @param ancillaryData ancillary data of the price being requested.
     * @param requester sender of the initial price request.
     * @return the stamped ancillary bytes.
     */
    function stampAncillaryData(bytes memory ancillaryData, address requester)
        public
        pure
        override
        returns (bytes memory)
    {
        return _stampAncillaryData(ancillaryData, requester);
    }

    function _getId(
        address requester,
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData
    ) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(requester, identifier, timestamp, ancillaryData));
    }

    function _settle(
        address requester,
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData
    ) private returns (uint256 payout) {
        State state = _getState(requester, identifier, timestamp, ancillaryData);

        // Set it to settled so this function can never be entered again.
        Request storage request = _getRequest(requester, identifier, timestamp, ancillaryData);
        request.settled = true;

        if (state == State.Expired) {
            // In the expiry case, just pay back the proposer's bond and final fee along with the reward.
            request.resolvedPrice = request.proposedPrice;
            payout = request.bond.add(request.finalFee).add(request.reward);
            request.currency.safeTransfer(request.proposer, payout);
        } else if (state == State.Resolved) {
            // In the Resolved case, pay either the disputer or the proposer the entire payout (+ bond and reward).
            request.resolvedPrice = _getOracle().getPrice(
                identifier,
                timestamp,
                _stampAncillaryData(ancillaryData, requester)
            );
            bool disputeSuccess = request.resolvedPrice != request.proposedPrice;
            uint256 bond = request.bond;

            // Unburned portion of the loser's bond = 1 - burned bond.
            uint256 unburnedBond = bond.sub(_computeBurnedBond(request));

            // Winner gets:
            // - Their bond back.
            // - The unburned portion of the loser's bond.
            // - Their final fee back.
            // - The request reward (if not already refunded -- if refunded, it will be set to 0).
            payout = bond.add(unburnedBond).add(request.finalFee).add(request.reward);
            request.currency.safeTransfer(disputeSuccess ? request.disputer : request.proposer, payout);
        } else {
            revert("_settle: not settleable");
        }

        emit Settle(
            requester,
            request.proposer,
            request.disputer,
            identifier,
            timestamp,
            ancillaryData,
            request.resolvedPrice,
            payout
        );

        // Callback.
        if (address(requester).isContract())
            try
                OptimisticRequester(requester).priceSettled(identifier, timestamp, ancillaryData, request.resolvedPrice)
            {} catch {}
    }

    function _getRequest(
        address requester,
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData
    ) private view returns (Request storage) {
        return requests[_getId(requester, identifier, timestamp, ancillaryData)];
    }

    function _computeBurnedBond(Request storage request) private view returns (uint256) {
        // burnedBond = floor(bond / 2)
        return request.bond.div(2);
    }

    function _validateLiveness(uint256 _liveness) private pure {
        require(_liveness < 5200 weeks, "Liveness too large");
        require(_liveness > 0, "Liveness cannot be 0");
    }

    function _getState(
        address requester,
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData
    ) internal view returns (State) {
        Request storage request = _getRequest(requester, identifier, timestamp, ancillaryData);

        if (address(request.currency) == address(0)) {
            return State.Invalid;
        }

        if (request.proposer == address(0)) {
            return State.Requested;
        }

        if (request.settled) {
            return State.Settled;
        }

        if (request.disputer == address(0)) {
            return request.expirationTime <= getCurrentTime() ? State.Expired : State.Proposed;
        }

        return
            _getOracle().hasPrice(identifier, timestamp, _stampAncillaryData(ancillaryData, requester))
                ? State.Resolved
                : State.Disputed;
    }

    function _getOracle() internal view returns (OracleAncillaryInterface) {
        return OracleAncillaryInterface(finder.getImplementationAddress(OracleInterfaces.Oracle));
    }

    function _getCollateralWhitelist() internal view returns (AddressWhitelist) {
        return AddressWhitelist(finder.getImplementationAddress(OracleInterfaces.CollateralWhitelist));
    }

    function _getStore() internal view returns (StoreInterface) {
        return StoreInterface(finder.getImplementationAddress(OracleInterfaces.Store));
    }

    function _getIdentifierWhitelist() internal view returns (IdentifierWhitelistInterface) {
        return IdentifierWhitelistInterface(finder.getImplementationAddress(OracleInterfaces.IdentifierWhitelist));
    }

    /**
     * @dev We don't handle specifically the case where `ancillaryData` is not already readily translateable in utf8.
     * For those cases, we assume that the client will be able to strip out the utf8-translateable part of the
     * ancillary data that this contract stamps.
     */
    function _stampAncillaryData(bytes memory ancillaryData, address requester) internal pure returns (bytes memory) {
        // Since this contract will be the one to formally submit DVM price requests, its useful for voters to know who
        // the original requester was.
        return AncillaryData.appendKeyValueAddress(ancillaryData, "ooRequester", requester);
    }

    function getCurrentTime() public view override(Testable, OptimisticOracleInterface) returns (uint256) {
        return Testable.getCurrentTime();
    }
}

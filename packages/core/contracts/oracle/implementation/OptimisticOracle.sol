// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

import "../interfaces/StoreInterface.sol";
import "../interfaces/OracleInterface.sol";
import "../interfaces/FinderInterface.sol";
import "../interfaces/IdentifierWhitelistInterface.sol";
import "./Constants.sol";

import "../../common/implementation/Testable.sol";
import "../../common/implementation/Lockable.sol";
import "../../common/implementation/FixedPoint.sol";
import "../../common/implementation/AddressWhitelist.sol";

interface OptimisticRequester {
    function priceProposed(bytes32 identifier, uint256 timestamp) external;

    function priceDisputed(
        bytes32 identifier,
        uint256 timestamp,
        uint256 refund
    ) external;

    function priceSettled(
        bytes32 identifier,
        uint256 timestamp,
        int256 price
    ) external;
}

contract OptimisticOracle is Testable, Lockable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    event RequestPrice(
        address indexed requester,
        bytes32 identifier,
        uint256 timestamp,
        address currency,
        uint256 reward,
        uint256 finalFee
    );
    event ProposePrice(
        address indexed requester,
        address indexed proposer,
        bytes32 identifier,
        uint256 timestamp,
        int256 proposedPrice
    );
    event DisputePrice(
        address indexed requester,
        address indexed proposer,
        address indexed disputer,
        bytes32 identifier,
        uint256 timestamp
    );
    event Settle(
        address indexed requester,
        address indexed proposer,
        address indexed disputer,
        bytes32 identifier,
        uint256 timestamp,
        int256 price,
        uint256 payout
    );

    enum State {
        Invalid, // Never requested.
        Requested, // Requested, no other actions taken.
        Proposed, // Proposed, but not expired or disputed yet.
        Expired, // Proposed, not disputed, past liveness.
        Disputed, // Disputed, but no DVM price returned yet.
        Resolved, // Disputed and DVM price is available.
        Settled // Final price has been set in the contract (can get here from Expired or Resolved).
    }

    struct Request {
        address proposer;
        address disputer;
        IERC20 currency;
        bool settled;
        bool refundOnDispute;
        int256 proposedPrice;
        int256 resolvedPrice;
        uint256 expirationTime;
        uint256 reward;
        uint256 finalFee;
        uint256 bond;
        uint256 customLiveness;
    }

    mapping(bytes32 => Request) public requests;

    FinderInterface public finder;
    uint256 public defaultLiveness;

    constructor(
        uint256 _liveness,
        address _finderAddress,
        address _timerAddress
    ) public Testable(_timerAddress) {
        finder = FinderInterface(_finderAddress);
        _validateLiveness(_liveness);
        defaultLiveness = _liveness;
    }

    function requestPrice(
        bytes32 identifier,
        uint256 timestamp,
        IERC20 currency,
        uint256 reward
    ) external nonReentrant() returns (uint256 totalBond) {
        require(getState(msg.sender, identifier, timestamp) == State.Invalid, "requestPrice: Invalid");
        require(_getIdentifierWhitelist().isIdentifierSupported(identifier), "Unsupported identifier");
        require(_getCollateralWhitelist().isOnWhitelist(address(currency)), "Unsupported currency");
        uint256 finalFee = _getStore().computeFinalFee(address(currency)).rawValue;
        requests[_getId(msg.sender, identifier, timestamp)] = Request({
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

        emit RequestPrice(msg.sender, identifier, timestamp, address(currency), reward, finalFee);

        // The total bond is the final fee + the default bond, which is set to the final fee. So the total bond is
        // 2x the final fee.
        return finalFee.mul(2);
    }

    function setBond(
        bytes32 identifier,
        uint256 timestamp,
        uint256 bond
    ) external nonReentrant() returns (uint256 totalBond) {
        require(getState(msg.sender, identifier, timestamp) == State.Requested, "setBond: Requested");
        Request storage request = _getRequest(msg.sender, identifier, timestamp);
        request.bond = bond;

        // Total bond is the final fee + the newly set bond.
        return bond.add(request.finalFee);
    }

    function setRefundOnDispute(bytes32 identifier, uint256 timestamp) external nonReentrant() {
        require(getState(msg.sender, identifier, timestamp) == State.Requested, "setRefundOnDispute: Requested");
        _getRequest(msg.sender, identifier, timestamp).refundOnDispute = true;
    }

    function setCustomLiveness(
        bytes32 identifier,
        uint256 timestamp,
        uint256 customLiveness
    ) external nonReentrant() {
        require(getState(msg.sender, identifier, timestamp) == State.Requested, "setCustomLiveness: Requested");
        _validateLiveness(customLiveness);
        _getRequest(msg.sender, identifier, timestamp).customLiveness = customLiveness;
    }

    function proposePriceFor(
        address proposer,
        address requester,
        bytes32 identifier,
        uint256 timestamp,
        int256 proposedPrice
    ) public nonReentrant() returns (uint256 totalBond) {
        require(getState(requester, identifier, timestamp) == State.Requested, "proposePriceFor: Requested");
        Request storage request = _getRequest(requester, identifier, timestamp);
        request.proposer = proposer;
        request.proposedPrice = proposedPrice;
        // If a custom liveness has been set
        request.expirationTime = getCurrentTime().add(
            request.customLiveness != 0 ? request.customLiveness : defaultLiveness
        );

        totalBond = request.bond.add(request.finalFee);
        if (totalBond > 0) {
            request.currency.safeTransferFrom(msg.sender, address(this), totalBond);
        }

        // Event.
        emit ProposePrice(requester, proposer, identifier, timestamp, proposedPrice);

        // Callback.
        try OptimisticRequester(requester).priceProposed(identifier, timestamp) {} catch {}
    }

    function proposePrice(
        address requester,
        bytes32 identifier,
        uint256 timestamp,
        int256 proposedPrice
    ) external returns (uint256 totalBond) {
        // Note: re-entrancy guard is done in the inner call.
        return proposePriceFor(msg.sender, requester, identifier, timestamp, proposedPrice);
    }

    function disputePriceFor(
        address disputer,
        address requester,
        bytes32 identifier,
        uint256 timestamp
    ) public nonReentrant() returns (uint256 totalBond) {
        require(getState(requester, identifier, timestamp) == State.Proposed, "disputePriceFor: Proposed");
        Request storage request = _getRequest(requester, identifier, timestamp);
        request.disputer = disputer;

        uint256 finalFee = request.finalFee;
        totalBond = request.bond.add(finalFee);
        if (totalBond > 0) {
            request.currency.safeTransferFrom(msg.sender, address(this), totalBond);
        }

        StoreInterface store = _getStore();
        if (finalFee > 0) {
            request.currency.safeIncreaseAllowance(address(store), finalFee);
            _getStore().payOracleFeesErc20(address(request.currency), FixedPoint.Unsigned(finalFee));
        }

        _getOracle().requestPrice(identifier, timestamp);

        // Compute refund.
        uint256 refund = 0;
        if (request.reward > 0 && request.refundOnDispute) {
            refund = request.reward;
            request.reward = 0;
            request.currency.safeTransfer(requester, refund);
        }

        // Event.
        emit DisputePrice(requester, request.proposer, disputer, identifier, timestamp);

        // Callback.
        try OptimisticRequester(requester).priceDisputed(identifier, timestamp, refund) {} catch {}
    }

    function disputePrice(
        address requester,
        bytes32 identifier,
        uint256 timestamp
    ) external returns (uint256 totalBond) {
        // Note: re-entrancy guard is done in the inner call.
        return disputePriceFor(msg.sender, requester, identifier, timestamp);
    }

    function getPrice(bytes32 identifier, uint256 timestamp) external nonReentrant() returns (int256) {
        if (getState(msg.sender, identifier, timestamp) != State.Settled) {
            _settle(msg.sender, identifier, timestamp);
        }

        return _getRequest(msg.sender, identifier, timestamp).resolvedPrice;
    }

    function settle(
        address requester,
        bytes32 identifier,
        uint256 timestamp
    ) external nonReentrant() returns (uint256 payout) {
        return _settle(requester, identifier, timestamp);
    }

    function _getId(
        address requester,
        bytes32 identifier,
        uint256 timestamp
    ) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(requester, identifier, timestamp));
    }

    function _settle(
        address requester,
        bytes32 identifier,
        uint256 timestamp
    ) private returns (uint256 payout) {
        State state = getState(requester, identifier, timestamp);

        // Set it to settled so this function can never be entered again.
        Request storage request = _getRequest(requester, identifier, timestamp);
        request.settled = true;

        if (state == State.Expired) {
            // In the expiry case, just pay back the proposer's bond and final fee along with the reward.
            request.resolvedPrice = request.proposedPrice;
            payout = request.bond.add(request.finalFee).add(request.reward);
            request.currency.safeTransfer(request.proposer, payout);
        } else if (state == State.Resolved) {
            // In the Resolved case, pay either the disputer or the proposer the entire payout (+ bond and reward).
            request.resolvedPrice = _getOracle().getPrice(identifier, timestamp);
            bool disputeSuccess = request.resolvedPrice != request.proposedPrice;
            payout = request.bond.mul(2).add(request.finalFee).add(request.reward);
            request.currency.safeTransfer(disputeSuccess ? request.disputer : request.proposer, payout);
        } else {
            revert("_settle: not settleable");
        }

        // Event.
        emit Settle(
            requester,
            request.proposer,
            request.disputer,
            identifier,
            timestamp,
            request.resolvedPrice,
            payout
        );

        // Callback.
        try OptimisticRequester(requester).priceSettled(identifier, timestamp, request.resolvedPrice) {} catch {}
    }

    function getRequest(
        address requester,
        bytes32 identifier,
        uint256 timestamp
    ) public view returns (Request memory) {
        return _getRequest(requester, identifier, timestamp);
    }

    function _getRequest(
        address requester,
        bytes32 identifier,
        uint256 timestamp
    ) private view returns (Request storage) {
        return requests[_getId(requester, identifier, timestamp)];
    }

    function getState(
        address requester,
        bytes32 identifier,
        uint256 timestamp
    ) public view returns (State) {
        Request storage request = _getRequest(requester, identifier, timestamp);

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

        return _getOracle().hasPrice(identifier, timestamp) ? State.Resolved : State.Disputed;
    }

    function _validateLiveness(uint256 _liveness) private pure {
        require(_liveness < 5200 weeks, "Liveness too large");
        require(_liveness > 0, "Liveness cannot be 0");
    }

    function _getOracle() internal view returns (OracleInterface) {
        return OracleInterface(finder.getImplementationAddress(OracleInterfaces.Oracle));
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
}

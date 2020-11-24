// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/utils/SafeCast.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import "../../common/implementation/Lockable.sol";
import "../../common/implementation/FixedPoint.sol";
import "../../common/implementation/Testable.sol";

import "../../oracle/interfaces/StoreInterface.sol";
import "../../oracle/interfaces/FinderInterface.sol";
import "../../oracle/implementation/Constants.sol";

import "../funding-rate-store/implementation/OptimisticOracle.sol";

import "./FeePayer.sol";

/**
 * @title FundingRateApplier contract.
 * @notice Provides funding rate payment functionality for the Perpetual contract.
 */

abstract contract FundingRateApplier is FeePayer {
    using FixedPoint for FixedPoint.Unsigned;
    using FixedPoint for FixedPoint.Signed;
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    /****************************************
     * FUNDING RATE APPLIER DATA STRUCTURES *
     ****************************************/

    struct FundingRate {
        // Current funding rate value.
        FixedPoint.Signed rate;
        // Identifier to retrieve the funding rate.
        bytes32 identifier;
        // Per second reward paid to get funding rate proposers.
        FixedPoint.Unsigned rewardRate;
        // Tracks the cumulative funding payments that have been paid to the sponsors.
        // The multiplier starts at 1, and is updated by computing cumulativeFundingRateMultiplier * (1 + effectivePayment).
        // Put another way, the cumulativeFeeMultiplier is (1 + effectivePayment1) * (1 + effectivePayment2) ...
        // For example:
        // The cumulativeFundingRateMultiplier should start at 1.
        // If a 1% funding payment is paid to sponsors, the multiplier should update to 1.01.
        // If another 1% fee is charged, the multiplier should be 1.01^2 (1.0201).
        FixedPoint.Unsigned cumulativeMultiplier;
        // Most recent time that the funding rate was updated.
        uint256 updateTime;
        // The time for the active (if it exists) funding rate proposal. 0 otherwise.
        uint256 proposalTime;
        // Most recent time that the funding rate was applied and changed the cumulative multiplier.
        uint256 applicationTime;
    }

    FundingRate public fundingRate;

    /****************************************
     *                EVENTS                *
     ****************************************/

    event NewFundingRate(
        uint256 indexed newMultiplier,
        uint256 lastApplicationTime,
        uint256 applicationTime,
        uint256 indexed paymentPeriod,
        int256 indexed latestFundingRate,
        int256 periodRate
    );

    /****************************************
     *              MODIFIERS               *
     ****************************************/

    modifier updateFundingRate {
        _applyEffectiveFundingRate();
        _;
    }

    /**
     * @notice Constructs the FundingRateApplier contract. Called by child contracts.
     * @param _finderAddress Finder used to discover financial-product-related contracts.
     * @param _fundingRateRewardRate Reward rate to pay FundingRateStore.
     */
    constructor(
        FixedPoint.Unsigned memory _fundingRateRewardRate,
        bytes32 _fundingRateIdentifier,
        address _collateralAddress,
        address _finderAddress,
        address _timerAddress
    ) public FeePayer(_collateralAddress, _finderAddress, _timerAddress) {
        fundingRate.updateTime = getCurrentTime();

        // Seed the cumulative multiplier as 1, from which it will be scaled as funding rates are applied over time.
        fundingRate.cumulativeMultiplier = FixedPoint.fromUnscaledUint(1);

        fundingRate.rewardRate = _fundingRateRewardRate;
        fundingRate.identifier = _fundingRateIdentifier;
    }

    function proposeNewRate(FixedPoint.Signed memory rate, uint256 timestamp)
        external
        nonReentrant()
        updateFundingRate()
    {
        require(fundingRate.proposalTime == 0, "Proposal in progress");

        // Timestamp must be after the last funding rate update time, within the last 30 minutes, and it cannot be more than 90 seconds ahead of the block timestamp.
        uint256 currentTime = getCurrentTime();
        uint256 updateTime = fundingRate.updateTime;
        require(
            timestamp > updateTime && timestamp > currentTime.sub(30 minutes) && timestamp < currentTime.add(90),
            "Invalid proposal time"
        );

        OptimisticOracle optimisticOracle = _getOptimisticOracle();

        // Compute reward.
        FixedPoint.Unsigned memory reward = _pfc().mul(fundingRate.rewardRate).mul(timestamp.sub(updateTime));

        // Approve optmistic oracle to pull reward.
        collateralCurrency.safeIncreaseAllowance(address(optimisticOracle), reward.rawValue);

        // Set up optmistic oracle.
        bytes32 identifier = fundingRate.identifier;
        uint256 bondToPay = optimisticOracle.requestPrice(identifier, timestamp, collateralCurrency, reward.rawValue);
        optimisticOracle.setRefundOnDispute(identifier, timestamp);

        // TODO: set custom bond amount?

        // Pull bond from caller and send to optimistic oracle.
        collateralCurrency.safeTransferFrom(msg.sender, address(this), bondToPay);
        collateralCurrency.safeIncreaseAllowance(address(optimisticOracle), bondToPay);
        optimisticOracle.proposePriceFor(msg.sender, address(this), identifier, timestamp, rate.rawValue);
    }

    // Returns a token amount scaled by the current funding rate multiplier.
    // Note: if the contract has paid fees since it was deployed, the raw
    // value should be larger than the returned value.
    function _getFundingRateAppliedTokenDebt(FixedPoint.Unsigned memory rawTokenDebt)
        internal
        view
        returns (FixedPoint.Unsigned memory tokenDebt)
    {
        return rawTokenDebt.mul(fundingRate.cumulativeMultiplier);
    }

    function _getOptimisticOracle() internal view returns (OptimisticOracle) {
        return OptimisticOracle(finder.getImplementationAddress("OptimisticOracle"));
    }

    function _getLatestFundingRate() internal returns (FixedPoint.Signed memory) {
        if (fundingRate.proposalTime != 0) {
            // Attempt to update the funding rate.
            OptimisticOracle optimisticOracle = _getOptimisticOracle();
            OptimisticOracle.State state =
                optimisticOracle.getState(address(this), fundingRate.identifier, fundingRate.proposalTime);

            if (state == OptimisticOracle.State.Disputed) {
                // If disputed, gulp the refund and reset the proposal so new proposals can come in.
                fundingRate.proposalTime = 0;
                _gulp();
            } else if (state == OptimisticOracle.State.Resolved || state == OptimisticOracle.State.Expired) {
                // If resolved, pull in a new price.
                fundingRate.rate = FixedPoint.Signed(
                    optimisticOracle.getPrice(fundingRate.identifier, fundingRate.proposalTime)
                );
                fundingRate.proposalTime = 0;
            }
        }
        return fundingRate.rate;
    }

    // Fetches a funding rate from the Store, determines the period over which to compute an effective fee,
    // and multiplies the current multiplier by the effective fee.
    // A funding rate < 1 will reduce the multiplier, and a funding rate of > 1 will increase the multiplier.
    // Note: 1 is set as the neutral rate because there are no negative numbers in FixedPoint, so we decide to treat
    // values < 1 as "negative".
    function _applyEffectiveFundingRate() internal {
        uint256 currentTime = getCurrentTime();
        uint256 paymentPeriod = currentTime.sub(fundingRate.applicationTime);

        FixedPoint.Signed memory _latestFundingRatePerSecond = _getLatestFundingRate();

        FixedPoint.Signed memory periodRate;
        (fundingRate.cumulativeMultiplier, periodRate) = _calculateEffectiveFundingRate(
            paymentPeriod,
            _getLatestFundingRate(),
            fundingRate.cumulativeMultiplier
        );

        emit NewFundingRate(
            fundingRate.cumulativeMultiplier.rawValue,
            fundingRate.applicationTime,
            currentTime,
            paymentPeriod,
            _latestFundingRatePerSecond.rawValue,
            periodRate.rawValue
        );

        fundingRate.applicationTime = currentTime;
    }

    function _calculateEffectiveFundingRate(
        uint256 paymentPeriodSeconds,
        FixedPoint.Signed memory fundingRatePerSecond,
        FixedPoint.Unsigned memory currentCumulativeFundingRateMultiplier
    )
        internal
        pure
        returns (FixedPoint.Unsigned memory newCumulativeFundingRateMultiplier, FixedPoint.Signed memory periodRate)
    {
        // Note: this method uses named return variables to save a little bytecode.

        // The overall formula that this function is performing:
        //   newCumulativeFundingRateMultiplier =
        //   (1 + (fundingRatePerSecond * paymentPeriodSeconds)) * currentCumulativeFundingRateMultiplier.
        FixedPoint.Signed memory ONE = FixedPoint.fromUnscaledInt(1);

        // Multiply the per-second rate over the number of seconds that have elapsed to get the period rate.
        periodRate = fundingRatePerSecond.mul(SafeCast.toInt256(paymentPeriodSeconds));

        // Add one to create the multiplier to scale the existing fee multiplier.
        FixedPoint.Signed memory signedPeriodMultiplier = ONE.add(periodRate);

        // Max with 0 to ensure the multiplier isn't negative, then cast to an Unsigned.
        FixedPoint.Unsigned memory unsignedPeriodMultiplier =
            FixedPoint.fromSigned(FixedPoint.max(signedPeriodMultiplier, FixedPoint.fromUnscaledInt(0)));

        // Multiply the existing cumulative funding rate multiplier by the computed period multiplier to get the new
        // cumulative funding rate multiplier.
        newCumulativeFundingRateMultiplier = currentCumulativeFundingRateMultiplier.mul(unsignedPeriodMultiplier);
    }
}

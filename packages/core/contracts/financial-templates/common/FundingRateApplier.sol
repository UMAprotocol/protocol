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

import "../funding-rate-store/interfaces/FundingRateStoreInterface.sol";

/**
 * @title FundingRateApplier contract.
 * @notice Provides funding rate payment functionality for the Perpetual contract.
 */

abstract contract FundingRateApplier is Testable, Lockable {
    using FixedPoint for FixedPoint.Unsigned;
    using FixedPoint for FixedPoint.Signed;
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    /****************************************
     * FUNDING RATE APPLIER DATA STRUCTURES *
     ****************************************/

    // Locally stores the finder.
    // This is private because it is expected that another contract, like the FeePayer, will publicly expose the finder
    // address.
    FinderInterface private finder;

    // Last time the `cumulativeFundingRateMultiplier` was updated.
    uint256 public lastUpdateTime;

    // Tracks the cumulative funding payments that have been paid to the sponsors.
    // The multiplier starts at 1, and is updated by computing cumulativeFundingRateMultiplier * (1 + effectivePayment).
    // Put another way, the cumulativeFeeMultiplier is (1 + effectivePayment1) * (1 + effectivePayment2) ...
    // For example:
    // The cumulativeFundingRateMultiplier should start at 1.
    // If a 1% funding payment is paid to sponsors, the multiplier should update to 1.01.
    // If another 1% fee is charged, the multiplier should be 1.01^2 (1.0201).
    FixedPoint.Unsigned public cumulativeFundingRateMultiplier;

    /****************************************
     *                EVENTS                *
     ****************************************/

    event NewFundingRate(
        uint256 indexed newMultiplier,
        uint256 lastUpdateTime,
        uint256 updateTime,
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
    constructor(address _finderAddress, FixedPoint.Unsigned memory _fundingRateRewardRate) public {
        finder = FinderInterface(_finderAddress);

        lastUpdateTime = getCurrentTime();

        // Seed the initial funding rate in the cumulativeFundingRateMultiplier 1.
        cumulativeFundingRateMultiplier = FixedPoint.fromUnscaledUint(1);

        // Set funding rate reward rate for this contract.
        _getFundingRateStore().setRewardRate(address(this), _fundingRateRewardRate);
    }

    // Returns a token amount scaled by the current funding rate multiplier.
    // Note: if the contract has paid fees since it was deployed, the raw
    // value should be larger than the returned value.
    function _getFundingRateAppliedTokenDebt(FixedPoint.Unsigned memory rawTokenDebt)
        internal
        view
        returns (FixedPoint.Unsigned memory tokenDebt)
    {
        return rawTokenDebt.mul(cumulativeFundingRateMultiplier);
    }

    function _getFundingRateStore() internal view returns (FundingRateStoreInterface) {
        return FundingRateStoreInterface(finder.getImplementationAddress("FundingRateStore"));
    }

    function _getLatestFundingRate() internal view returns (FixedPoint.Signed memory) {
        return _getFundingRateStore().getFundingRateForContract(address(this));
    }

    // Fetches a funding rate from the Store, determines the period over which to compute an effective fee,
    // and multiplies the current multiplier by the effective fee.
    // A funding rate < 1 will reduce the multiplier, and a funding rate of > 1 will increase the multiplier.
    // Note: 1 is set as the neutral rate because there are no negative numbers in FixedPoint, so we decide to treat
    // values < 1 as "negative".
    function _applyEffectiveFundingRate() internal {
        uint256 currentTime = getCurrentTime();
        uint256 paymentPeriod = currentTime.sub(lastUpdateTime);

        FixedPoint.Signed memory _latestFundingRatePerSecond = _getLatestFundingRate();

        FixedPoint.Signed memory periodRate;
        (cumulativeFundingRateMultiplier, periodRate) = _calculateEffectiveFundingRate(
            paymentPeriod,
            _getLatestFundingRate(),
            cumulativeFundingRateMultiplier
        );

        emit NewFundingRate(
            cumulativeFundingRateMultiplier.rawValue,
            lastUpdateTime,
            currentTime,
            paymentPeriod,
            _latestFundingRatePerSecond.rawValue,
            periodRate.rawValue
        );

        lastUpdateTime = currentTime;
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

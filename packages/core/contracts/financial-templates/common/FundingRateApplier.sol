pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

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

contract FundingRateApplier is Testable, Lockable {
    using SafeMath for int256;
    using SafeMath for uint256;
    using FixedPoint for FixedPoint.Unsigned;
    using SafeERC20 for IERC20;

    /****************************************
     * FUNDING RATE APPLIER DATA STRUCTURES *
     ****************************************/

    // Points to financial product-related contracts like the funding rate store.
    FinderInterface public fpFinder;

    // Last time the `cumulativeFundingRateMultiplier` was updated.
    uint256 lastUpdateTime;

    // Identifier in funding rate store to query for.
    bytes32 identifier;

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

    // TODO: Decide which params to emit in this event.
    event NewFundingRate(
        uint256 indexed newMultiplier,
        uint256 indexed updateTime,
        uint256 indexed paymentPeriod,
        uint256 latestFundingRate,
        uint256 effectiveFundingRateForPaymentPeriod
    );

    /****************************************
     *              MODIFIERS               *
     ****************************************/

    // modifier that calls applyFundingRate().
    modifier updateFunding {
        _applyEffectiveFundingRate();
        _;
    }

    /**
     * @notice Constructs the FundingRateApplier contract. Called by child contracts.
     * @param _initialFundingRate Starting funding rate multiplier.
     * @param _fpFinderAddress Finder used to discover financial-product-related contracts.
     * @param _timerAddress Contract that stores the current time in a testing environment.
     * @param _identifier Unique identifier for DVM price feed ticker for child financial contract.
     * Must be set to 0x0 for production environments that use live time.
     */
    constructor(
        FixedPoint.Unsigned memory _initialFundingRate,
        address _fpFinderAddress,
        address _timerAddress,
        bytes32 _identifier
    ) public Testable(_timerAddress) nonReentrant() {
        // TODO: Should we constrain `_initialFundingRate > x && < y`?
        cumulativeFundingRateMultiplier = _initialFundingRate;
        fpFinder = FinderInterface(_fpFinderAddress);
        lastUpdateTime = getCurrentTime();
        identifier = _identifier;
    }

    /****************************************
     *         INTERNAL FUNCTIONS           *
     ****************************************/

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
        return FundingRateStoreInterface(fpFinder.getImplementationAddress("FundingRateStore"));
    }

    // Fetches a funding rate from the Store, determines the period over which to compute an effective fee,
    // and multiplies the current multiplier by the effective fee.
    // A funding rate < 1 will reduce the multiplier, and a funding rate of > 1 will increase the multiplier.
    // Note: 1 is set as the neutral rate because there are no negative numbers in FixedPoint, so we decide to treat
    // values < 1 as "negative".
    function _applyEffectiveFundingRate() internal {
        uint256 currentTime = getCurrentTime();
        uint256 paymentPeriod = currentTime.sub(lastUpdateTime);

        FundingRateStoreInterface fundingRateStore = _getFundingRateStore();
        FixedPoint.Unsigned memory _latestFundingRatePerSecond = fundingRateStore.getFundingRateForIdentifier(
            identifier
        );

        FixedPoint.Unsigned memory effectiveFundingRateForPeriod;
        (cumulativeFundingRateMultiplier, effectiveFundingRateForPeriod) = _calculateEffectiveFundingRate(
            paymentPeriod,
            _latestFundingRatePerSecond,
            cumulativeFundingRateMultiplier
        );
        lastUpdateTime = currentTime;

        emit NewFundingRate(
            cumulativeFundingRateMultiplier.rawValue,
            lastUpdateTime,
            paymentPeriod,
            _latestFundingRatePerSecond.rawValue,
            effectiveFundingRateForPeriod.rawValue
        );
    }

    function _calculateEffectiveFundingRate(
        uint256 paymentPeriodSeconds,
        FixedPoint.Unsigned memory fundingRatePerSecond,
        FixedPoint.Unsigned memory feeMultiplier
    ) internal pure returns (FixedPoint.Unsigned memory, FixedPoint.Unsigned memory) {
        // Determine whether `fundingRatePerSecond` implies a negative or positive funding rate,
        // and apply it over a pay period.
        FixedPoint.Unsigned memory ONE = FixedPoint.fromUnscaledUint(1);
        FixedPoint.Unsigned memory effectiveFundingRateForPeriod = ONE;

        // If `fundingRatePerSecond` == 1, then maintain the current multiplier.
        FixedPoint.Unsigned memory newFeeMultiplier = feeMultiplier;
        if (fundingRatePerSecond.isGreaterThan(ONE)) {
            // If `fundingRatePerSecond` > 1, then first scale the funding over the pay period:
            // (`fundingRatePerSecond` - 1) * payPeriod = effectiveFundingRate.
            // Next, multiply the current multipier by (1 + effectiveFundingRate).

            effectiveFundingRateForPeriod = ONE.add(fundingRatePerSecond.sub(ONE).mul(paymentPeriodSeconds));
            newFeeMultiplier = feeMultiplier.mul(effectiveFundingRateForPeriod);
        } else if (fundingRatePerSecond.isLessThan(ONE)) {
            // If `fundingRatePerSecond` < 1, then first scale the funding over the pay period:
            // (1 - `fundingRatePerSecond`) * payPeriod = effectiveFundingRate.
            // Next, multiply the current multipier by (1 - effectiveFundingRate).

            effectiveFundingRateForPeriod = ONE.sub(ONE.sub(fundingRatePerSecond).mul(paymentPeriodSeconds));
            newFeeMultiplier = feeMultiplier.mul(effectiveFundingRateForPeriod);
        }

        return (newFeeMultiplier, effectiveFundingRateForPeriod);
    }
}

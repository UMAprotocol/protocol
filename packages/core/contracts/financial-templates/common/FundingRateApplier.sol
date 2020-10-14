pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import "../../common/implementation/Lockable.sol";
import "../../common/implementation/FixedPoint.sol";
import "../../common/implementation/Timer.sol";

import "../../oracle/interfaces/StoreInterface.sol";
import "../../oracle/interfaces/FinderInterface.sol";
import "../../oracle/implementation/Constants.sol";

import "../funding-rate-store/interfaces/FundingRateStoreInterface.sol";


/**
 * @title FundingRateApplier contract.
 * @notice Provides funding rate payment functionality for the Perpetual contract.
 */

contract FundingRateApplier is Lockable {
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
    bytes32 priceIdentifier;

    // Tracks the cumulative funding payments that have been paid to the sponsors.
    // The multiplier starts at 1, and is updated by computing cumulativeFundingRateMultiplier * (1 + effectivePayment).
    // Put another way, the cumulativeFeeMultiplier is (1 + effectivePayment1) * (1 + effectivePayment2) ...
    // For example:
    // The cumulativeFundingRateMultiplier should start at 1.
    // If a 1% funding payment is paid to sponsors, the multiplier should update to 1.01.
    // If another 1% fee is charged, the multiplier should be 1.01^2 (1.0201).
    FixedPoint.Unsigned public cumulativeFundingRateMultiplier;

    Timer timer;

    /****************************************
     *                EVENTS                *
     ****************************************/

    // TODO: Decide which params to emit in this event.
    event NewFundingRate(
        uint256 indexed newMultiplier,
        uint256 indexed lastUpdateTime,
        uint256 indexed updateTime,
        uint256 paymentPeriod,
        uint256 effectiveFundingRateForPaymentPeriod
    );

    /****************************************
     *              MODIFIERS               *
     ****************************************/

    modifier updateFundingRate {
        _applyEffectiveFundingRatePerToken();
        _;
    }

    constructor(
        FixedPoint.Unsigned memory _initialFundingRate,
        address _fpFinderAddress,
        bytes32 _priceIdentifier,
        address _timerAddress
    ) public nonReentrant() {
        cumulativeFundingRateMultiplier = _initialFundingRate;
        fpFinder = FinderInterface(_fpFinderAddress);
        lastUpdateTime = timer.getCurrentTime();
        priceIdentifier = _priceIdentifier;

        timer = Timer(_timerAddress);
    }

    function _getFundingRateAppliedTokenDebt(FixedPoint.Unsigned memory rawTokenDebt)
        internal
        view
        returns (FixedPoint.Unsigned memory tokenDebt)
    {
        return rawTokenDebt.mul(cumulativeFundingRateMultiplier);
    }

    /****************************************
     *         PUBLIC FUNCTIONS           *
     ****************************************/

    function applyFundingRate() external {
        _applyEffectiveFundingRatePerToken();
    }

    /****************************************
     *         INTERNAL FUNCTIONS           *
     ****************************************/

    function _getFundingRateStore() internal view returns (FundingRateStoreInterface) {
        return FundingRateStoreInterface(fpFinder.getImplementationAddress("FundingRateStore"));
    }

    function _getLatestFundingRate() internal view returns (FixedPoint.Unsigned memory) {
        FundingRateStoreInterface fundingRateStore = _getFundingRateStore();
        return fundingRateStore.getFundingRateForIdentifier(priceIdentifier);
    }

    function _applyEffectiveFundingRatePerToken() internal {
        uint256 currentTime = timer.getCurrentTime();
        uint256 paymentPeriod = currentTime.sub(lastUpdateTime);
        FixedPoint.Unsigned memory _latestFundingRatePerSecondPerToken = _getLatestFundingRate();

        // Determine whether `_latestFundingRate` implies a negative or positive funding rate,
        // and apply it over a pay period.
        FixedPoint.Unsigned memory effectiveFundingRateForPeriodPerToken;
        FixedPoint.Unsigned memory ONE = FixedPoint.fromUnscaledUint(1);

        // This if else logic is needed to keep the calculations strictly positive to accommodate FixedPoint.Unsigned
        if (_latestFundingRatePerSecondPerToken.isEqual(ONE)) {
            effectiveFundingRateForPeriodPerToken = ONE;
        } else if (_latestFundingRatePerSecondPerToken.isGreaterThan(ONE)) {
            // effectiveFundingRateForPeriodPerToken = 1 + (_latestFundingRatePerSecondPerToken - 1) * paymentPeriod
            effectiveFundingRateForPeriodPerToken = ONE.add(
                _latestFundingRatePerSecondPerToken.sub(ONE).mul(paymentPeriod)
            );
            cumulativeFundingRateMultiplier = cumulativeFundingRateMultiplier.mul(
                effectiveFundingRateForPeriodPerToken
            );
        } else {
            // effectiveFundingRateForPeriodPerToken = 1 - (1 - _latestFundingRatePerSecondPerToken) * paymentPeriod
            effectiveFundingRateForPeriodPerToken = ONE.sub(
                ONE.sub(_latestFundingRatePerSecondPerToken).mul(paymentPeriod)
            );
            cumulativeFundingRateMultiplier = cumulativeFundingRateMultiplier.mul(
                effectiveFundingRateForPeriodPerToken
            );
        }

        emit NewFundingRate(
            cumulativeFundingRateMultiplier.rawValue,
            currentTime,
            lastUpdateTime,
            paymentPeriod,
            effectiveFundingRateForPeriodPerToken.rawValue
        );

        lastUpdateTime = currentTime;
    }
}

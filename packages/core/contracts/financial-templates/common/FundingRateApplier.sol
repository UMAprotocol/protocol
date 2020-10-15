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
    uint256 public lastUpdateTime;

    // Identifier in funding rate store to query for.
    bytes32 public priceIdentifier;

    // Expiry price pulled from the DVM in the case of an emergency shutdown.
    FixedPoint.Unsigned public emergencyShutdownPrice;

    // Timestamp used in case of emergency shutdown.
    uint256 public emergencyShutdownTimestamp;

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

    event NewFundingRate(
        uint256 indexed newMultiplier,
        uint256 lastUpdateTime,
        uint256 indexed updateTime,
        uint256 indexed paymentPeriod,
        uint256 latestFundingRate,
        uint256 effectiveFundingRateForPaymentPeriod
    );

    /****************************************
     *              MODIFIERS               *
     ****************************************/

    modifier updateFundingRate {
        _applyEffectiveFundingRatePerToken();
        _;
    }

    modifier notEmergencyShutdown() {
        _notEmergencyShutdown();
        _;
    }

    modifier isEmergencyShutdown() {
        _isEmergencyShutdown();
        _;
    }

    /**
     * @notice Constructs the FundingRateApplier contract. Called by child contracts.
     * @param _initialFundingRate Starting funding rate multiplier.
     * @param _fpFinderAddress Finder used to discover financial-product-related contracts.
     * @param _priceIdentifier Unique identifier for DVM price feed ticker for child financial contract.
     * @param _timerAddress Contract that stores the current time in a testing environment.
     * Must be set to 0x0 for production environments that use live time.
     */
    constructor(
        FixedPoint.Unsigned memory _initialFundingRate,
        address _fpFinderAddress,
        bytes32 _priceIdentifier,
        address _timerAddress
    ) public nonReentrant() {
        cumulativeFundingRateMultiplier = _initialFundingRate;
        fpFinder = FinderInterface(_fpFinderAddress);
        priceIdentifier = _priceIdentifier;

        timer = Timer(_timerAddress);
        lastUpdateTime = timer.getCurrentTime();
    }

    /****************************************
     *         PUBLIC FUNCTIONS           *
     ****************************************/

    /**
     * @notice Fetches the latest funding rate from the Store, scales it over the time period since the last update,
     * and uses this effective rate to set a new funding rate multiplier.
     * @dev A funding rate of 1.0 reported by the Store implies a neutral funding rate, meaning that the current multiplier
     * should not change.
     */
    function applyFundingRate() public {
        _applyEffectiveFundingRatePerToken();
    }

    // Returns a token amount scaled by the current funding rate multiplier.
    // Note: if the contract has paid fees since it was deployed, the raw value should be larger than the returned value.
    function _getFundingRateAppliedTokenDebt(FixedPoint.Unsigned memory rawTokenDebt)
        public
        view
        returns (FixedPoint.Unsigned memory tokenDebt)
    {
        return rawTokenDebt.mul(cumulativeFundingRateMultiplier);
    }

    /****************************************
     *         INTERNAL FUNCTIONS           *
     ****************************************/

    function _getFundingRateStore() internal view returns (FundingRateStoreInterface) {
        return FundingRateStoreInterface(fpFinder.getImplementationAddress("FundingRateStore"));
    }

    function _getLatestFundingRate() internal view returns (FixedPoint.Unsigned memory) {
        FundingRateStoreInterface fundingRateStore = _getFundingRateStore();
        return fundingRateStore.getLatestFundingRateForIdentifier(priceIdentifier);
    }

    // Fetches a funding rate from the Store, determines the period over which to compute an effective fee,
    // and multiplies the current multiplier by the effective fee.
    // A funding rate < 1 will reduce the multiplier, and a funding rate of > 1 will increase the multiplier.
    // Note: 1 is set as the neutral rate because there are no negative numbers in FixedPoint, so we decide to treat
    // values < 1 as "negative".
    function _applyEffectiveFundingRatePerToken() internal notEmergencyShutdown() {
        uint256 currentTime = timer.getCurrentTime();
        uint256 paymentPeriod = currentTime.sub(lastUpdateTime);
        FixedPoint.Unsigned memory _latestFundingRatePerSecondPerToken = _getLatestFundingRate();

        // Determine whether `_latestFundingRate` implies a negative or positive funding rate,
        // and apply it over a pay period.
        FixedPoint.Unsigned memory effectiveFundingRateForPeriodPerToken;
        FixedPoint.Unsigned memory ONE = FixedPoint.fromUnscaledUint(1);

        // This if else logic is needed to keep the calculations strictly positive to accommodate FixedPoint.Unsigned
        if (_latestFundingRatePerSecondPerToken.isEqual(ONE)) {
            // If `_latestFundingRate` == 1, then maintain the current multiplier.

            effectiveFundingRateForPeriodPerToken = ONE;
        } else if (_latestFundingRatePerSecondPerToken.isGreaterThan(ONE)) {
            // If `_latestFundingRate` > 1, then first scale the funding over the pay period:
            // (`_latestFundingRate` - 1) * payPeriod = effectiveFundingRate.
            // Next, multiply the current multipier by (1 + effectiveFundingRate).

            effectiveFundingRateForPeriodPerToken = ONE.add(
                _latestFundingRatePerSecondPerToken.sub(ONE).mul(paymentPeriod)
            );
            cumulativeFundingRateMultiplier = cumulativeFundingRateMultiplier.mul(
                effectiveFundingRateForPeriodPerToken
            );
        } else {
            // If `_latestFundingRate` < 1, then first scale the funding over the pay period:
            // (1 - `_latestFundingRate`) * payPeriod = effectiveFundingRate.
            // Next, multiply the current multipier by (1 - effectiveFundingRate).

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
            _latestFundingRatePerSecondPerToken.rawValue,
            effectiveFundingRateForPeriodPerToken.rawValue
        );

        lastUpdateTime = currentTime;
    }

    function _notEmergencyShutdown() internal view {
        require(emergencyShutdownTimestamp == 0, "Contract emergency shutdown");
    }

    function _isEmergencyShutdown() internal view {
        require(emergencyShutdownTimestamp != 0, "Contract not emergency shutdown");
    }
}

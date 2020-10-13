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
    bytes32 identifer;

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
        uint256 effectiveFundingRateForPaymentPeriod
    );

    /****************************************
     *              MODIFIERS               *
     ****************************************/

    modifier updateFunding {
        _applyEffectiveFundingRatePerToken();
        _;
    }

    constructor(
        FixedPoint.Unsigned memory _initialFundingRate,
        address _fpFinderAddress,
        address _timerAddress,
        bytes32 _identifer
    ) public Testable(_timerAddress) nonReentrant() {
        cumulativeFundingRateMultiplier = _initialFundingRate;
        fpFinder = FinderInterface(_fpFinderAddress);
        lastUpdateTime = getCurrentTime();
        identifer = _identifer;
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

    function _applyEffectiveFundingRatePerToken() internal {
        uint256 currentTime = getCurrentTime();
        uint256 paymentPeriod = currentTime.sub(lastUpdateTime);

        FundingRateStoreInterface fundingRateStore = _getFundingRateStore();
        FixedPoint.Unsigned memory _latestFundingRatePerSecondPerToken = fundingRateStore.getFundingRateForIdentifier(
            identifer
        );

        // Determine whether `_latestFundingRate` implies a negative or positive funding rate,
        // and apply it over a pay period.
        FixedPoint.Unsigned memory effectiveFundingRateForPeriodPerToken;
        FixedPoint.Unsigned memory ONE = FixedPoint.fromUnscaledUint(1);

        if (_latestFundingRatePerSecondPerToken.isEqual(ONE)) {
            effectiveFundingRateForPeriodPerToken = ONE;
        } else if (_latestFundingRatePerSecondPerToken.isGreaterThan(ONE)) {
            effectiveFundingRateForPeriodPerToken = ONE.add(
                _latestFundingRatePerSecondPerToken.sub(ONE).mul(paymentPeriod)
            );
            cumulativeFundingRateMultiplier = cumulativeFundingRateMultiplier.mul(
                effectiveFundingRateForPeriodPerToken
            );
        } else {
            effectiveFundingRateForPeriodPerToken = ONE.sub(
                ONE.sub(_latestFundingRatePerSecondPerToken).mul(paymentPeriod)
            );
            cumulativeFundingRateMultiplier = cumulativeFundingRateMultiplier.mul(
                effectiveFundingRateForPeriodPerToken
            );
        }

        lastUpdateTime = currentTime;

        emit NewFundingRate(
            cumulativeFundingRateMultiplier.rawValue,
            lastUpdateTime,
            paymentPeriod,
            effectiveFundingRateForPeriodPerToken.rawValue
        );
    }
}

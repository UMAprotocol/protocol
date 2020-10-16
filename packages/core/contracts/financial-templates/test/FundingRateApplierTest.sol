pragma solidity ^0.6.0;

pragma experimental ABIEncoderV2;

import "../common/FundingRateApplier.sol";


// Implements FundingRateApplier internal methods to enable unit testing.
contract FundingRateApplierTest is FundingRateApplier {
    constructor(
        FixedPoint.Unsigned memory _initialFundingRate,
        address _fpFinderAddress,
        bytes32 _priceIdentifier,
        address _timerAddress
    ) public FundingRateApplier(_initialFundingRate, _fpFinderAddress, _priceIdentifier, _timerAddress) {}

    function applyFundingRate() public {
        _applyEffectiveFundingRate();
    }

    function calculateEffectiveFundingRate(
        uint256 paymentPeriodSeconds,
        FixedPoint.Unsigned memory fundingRatePerSecond,
        FixedPoint.Unsigned memory feeMultiplier
    ) public pure returns (FixedPoint.Unsigned memory, FixedPoint.Unsigned memory) {
        return _calculateEffectiveFundingRate(paymentPeriodSeconds, fundingRatePerSecond, feeMultiplier);
    }
}

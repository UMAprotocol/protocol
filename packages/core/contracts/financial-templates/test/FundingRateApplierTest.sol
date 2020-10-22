pragma solidity ^0.6.0;

pragma experimental ABIEncoderV2;

import "../common/FundingRateApplier.sol";


// Implements FundingRateApplier internal methods to enable unit testing.
contract FundingRateApplierTest is FundingRateApplier {
    constructor(
        address _fpFinderAddress,
        bytes32 _fundingRateIdentifier,
        address _timerAddress
    ) public FundingRateApplier(_fpFinderAddress, _fundingRateIdentifier, _timerAddress) {}

    function applyFundingRate() public {
        _applyEffectiveFundingRate();
    }

    function calculateEffectiveFundingRate(
        uint256 paymentPeriodSeconds,
        FixedPoint.Signed memory fundingRatePerSecond,
        FixedPoint.Unsigned memory currentCumulativeFundingRateMultiplier
    ) public pure returns (FixedPoint.Unsigned memory, FixedPoint.Signed memory) {
        return
            _calculateEffectiveFundingRate(
                paymentPeriodSeconds,
                fundingRatePerSecond,
                currentCumulativeFundingRateMultiplier
            );
    }
}

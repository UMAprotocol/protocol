pragma solidity ^0.6.0;

pragma experimental ABIEncoderV2;

import "../common/FundingRateApplier.sol";


// A mock oracle used for testing.
contract MockFundingRateApplier is FundingRateApplier {
    constructor(
        FixedPoint.Unsigned memory _initialFundingRate,
        address _fpFinderAddress,
        address _timerAddress,
        bytes32 _identifier
    ) public FundingRateApplier(_initialFundingRate, _fpFinderAddress, _timerAddress, _identifier) {}

    function applyFundingRate() public {
        _applyEffectiveFundingRatePerToken();
    }

    function calculateEffectiveFundingRatePerToken(
        uint256 paymentPeriodSeconds,
        FixedPoint.Unsigned memory fundingRatePerSecondPerToken,
        FixedPoint.Unsigned memory feeMultiplier
    ) public pure returns (FixedPoint.Unsigned memory, FixedPoint.Unsigned memory) {
        return
            _calculateEffectiveFundingRatePerToken(paymentPeriodSeconds, fundingRatePerSecondPerToken, feeMultiplier);
    }
}

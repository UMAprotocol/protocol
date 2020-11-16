// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.6.0;

pragma experimental ABIEncoderV2;

import "../common/FundingRateApplier.sol";

// Implements FundingRateApplier internal methods to enable unit testing.
contract FundingRateApplierTest is FundingRateApplier {
    constructor(
        address _fpFinderAddress,
        address _timerAddress,
        FixedPoint.Unsigned memory _rewardRate
    ) public Testable(_timerAddress) FundingRateApplier(_fpFinderAddress, _rewardRate) {}

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

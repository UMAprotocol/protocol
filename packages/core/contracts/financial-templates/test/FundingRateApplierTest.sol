// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.6.0;

pragma experimental ABIEncoderV2;

import "../common/FundingRateApplier.sol";

// Implements FundingRateApplier internal methods to enable unit testing.
contract FundingRateApplierTest is FundingRateApplier {
    constructor(
        FixedPoint.Unsigned memory _fundingRateBondPercentage,
        FixedPoint.Unsigned memory _rewardRate,
        bytes32 _fundingRateIdentifier,
        address _collateralAddress,
        address _finderAddress,
        address _timerAddress
    )
        public
        FundingRateApplier(
            _fundingRateBondPercentage,
            _rewardRate,
            _fundingRateIdentifier,
            _collateralAddress,
            _finderAddress,
            _timerAddress
        )
    {}

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

    // Required overrides.
    function _pfc() internal view virtual override returns (FixedPoint.Unsigned memory currentPfc) {
        return FixedPoint.Unsigned(collateralCurrency.balanceOf(address(this)));
    }

    function emergencyShutdown() external override {}

    function remargin() external override {}
}

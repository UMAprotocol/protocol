// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../common/FundingRateApplier.sol";
import "../../common/implementation/FixedPoint.sol";

// Implements FundingRateApplier internal methods to enable unit testing.
contract FundingRateApplierTest is FundingRateApplier {
    constructor(
        bytes32 _fundingRateIdentifier,
        address _collateralAddress,
        address _finderAddress,
        address _configStoreAddress,
        FixedPoint.Unsigned memory _tokenScaling,
        address _timerAddress
    )
        FundingRateApplier(
            _fundingRateIdentifier,
            _collateralAddress,
            _finderAddress,
            _configStoreAddress,
            _tokenScaling,
            _timerAddress
        )
    {}

    function calculateEffectiveFundingRate(
        uint256 paymentPeriodSeconds,
        FixedPoint.Signed memory fundingRatePerSecond,
        FixedPoint.Unsigned memory currentCumulativeFundingRateMultiplier
    ) public pure returns (FixedPoint.Unsigned memory) {
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

    function _getTokenAddress() internal view override returns (address) {
        return address(collateralCurrency);
    }
}

// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;
import "../common/financial-product-libraries/long-short-pair-libraries/LongShortPairFinancialProductLibrary.sol";

// Implements a simple FinancialProductLibrary to test price and collateral requirement transoformations.
contract LongShortPairFinancialProjectLibraryTest is LongShortPairFinancialProductLibrary {
    using FixedPoint for FixedPoint.Unsigned;

    uint256 public valueToReturn;

    function setValueToReturn(uint256 value) public {
        valueToReturn = value;
    }

    function percentageLongCollateralAtExpiry(
        int256 /*expiryPrice*/
    ) public view override returns (uint256) {
        return valueToReturn;
    }
}

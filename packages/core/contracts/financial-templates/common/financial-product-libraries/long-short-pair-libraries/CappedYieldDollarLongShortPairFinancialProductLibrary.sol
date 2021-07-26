// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/math/Math.sol";

import "./LongShortPairFinancialProductLibrary.sol";
import "../../../../common/implementation/Lockable.sol";

/**
 * @title Capped Yield Dollar Long Short Pair Financial Product Library
 * @notice Adds settlement logic to create Yield Dollar LSPs. A range bond is the combination of a Yield dollar and short
 * put option enabling the token sponsor to issue structured products to unlock DeFi treasuries. This library is like
 * a Range Bond, but with no embedded call option.
 * A Capped Yield Dollar is defined as = Yield Dollar - Put Option. In order for the Capped Yield Dollar to be fully
 * collateralized and non-liquidatable, there is a low price for the collateral token below which the Capped Yield Dollar
 * will be worth < $1.
 * Numerically this is found using:
 * N = Notional of bond
 * P = price of token
 * T = number of tokens
 * R1 = low price range
 * C = collateral per pair, should be N/R1
 * T = min(1,(R1/P)*C)
 * If you want a yield dollar denominated as N = $1, you should set C to 1/R1. In that case, T = min(1,1/P).
 * - At any price below the low price range (R1) the long side effectively holds a fixed number of collateral equal to
 * collateralPerPair from the LSP with the value of expiryPercentLong = 1. This is the max payout in collateral.
 * - Any price equal to or above R1 gives a payout equivalent to a yield dollar (bond) of notional N. In this range the
 * expiryPercentLong shifts to keep the payout in dollar terms equal to the bond notional.
 * With this equation, the contract deployer does not need to specify the bond notional N. The notional can be calculated
 * by taking R1*collateralPerPair from the LSP.
 */
contract CappedYieldDollarLongShortPairFinancialProductLibrary is LongShortPairFinancialProductLibrary, Lockable {
    using FixedPoint for FixedPoint.Unsigned;

    mapping(address => uint256) public lowPriceRanges;

    /**
     * @notice Enables any address to set the low price range for an associated financial product.
     * @param longShortPair address of the LSP contract.
     * @param lowPriceRange low price range below which the payout transforms from a yield dollar to a short put option.
     * @dev above the lowPriceRange the contract will payout a fixed amount of
     * lowPriceRange*collateralPerPair (i.e the "notional" of the yield dollar).
     * @dev Note: a) Any address can set these parameters b) existing LSP parameters for address not set.
     * c) low price range can only be set once to prevent the deployer from changing the parameters after the fact.
     * d) For safety, a low price range should be set before depositing any synthetic tokens in a liquidity pool.
     * e) longShortPair must expose an expirationTimestamp method to validate it is correctly deployed.
     */
    function setLongShortPairParameters(address longShortPair, uint256 lowPriceRange) public nonReentrant() {
        require(ExpiringContractInterface(longShortPair).expirationTimestamp() != 0, "Invalid LSP address");
        require(lowPriceRanges[longShortPair] == 0, "Parameters already set");

        lowPriceRanges[longShortPair] = lowPriceRange;
    }

    /**
     * @notice Returns a number between 0 and 1e18 to indicate how much collateral each long and short token are
     * entitled to per collateralPerPair.
     * @param expiryPrice price from the optimistic oracle for the LSP price identifier.
     * @return expiryPercentLong to indicate how much collateral should be sent between long and short tokens.
     */
    function percentageLongCollateralAtExpiry(int256 expiryPrice)
        public
        view
        override
        nonReentrantView()
        returns (uint256)
    {
        uint256 contractLowPriceRange = lowPriceRanges[msg.sender];
        require(contractLowPriceRange != 0, "Params not set for calling LSP");

        // This function returns a value between 0 and 1e18 to be used in conjunction with the LSP collateralPerPair
        // that allocates collateral between the short and long tokens on expiry. This can be simplified by considering
        // the price in two discrete ranges: 1) below the low price range, 2) above the low price range.
        uint256 positiveExpiryPrice = expiryPrice > 0 ? uint256(expiryPrice) : 0;

        // For expiry prices below lower bound, return expiryPercentLong = 1 (full position)
        if (positiveExpiryPrice <= contractLowPriceRange) return FixedPoint.fromUnscaledUint(1).rawValue;
        // For expiry prices above lower bound. For example, if the lower bound of Sushi is $4, collateral per pair
        // is 0.25, and the expiry price is $12, the payout will be (4/12)*0.25, or .08333 Sushi. With Sushi at $12,
        // .08333 Sushi is equal to $1.
        return FixedPoint.Unsigned(contractLowPriceRange).div(FixedPoint.Unsigned(positiveExpiryPrice)).rawValue;
    }
}

// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/math/SignedSafeMath.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

import "./LongShortPairFinancialProductLibrary.sol";
import "../../../../common/implementation/Lockable.sol";

/**
 * @title Range Bond Long Short Pair Financial Product Library
 * @notice Adds settlement logic to create range bond LSPs. A range bond is the combination of a Yield dollar, short put
 * option and long call option enabling the token sponsor to issue structured products to unlock DeFi treasuries.
 * A range bond is defined as = Yield Dollar - Put Option + Call option. Numerically this is found using:
 * N = Notional of bond
 * P = price of token
 * T = number of tokens
 * R1 = low price range
 * R2 = high price range
 * T = min(N/P,N/R1) + max((N/R2*(P-R2))/P,0)
 * - At any price below the low price range (R1) the long side effectively holds a fixed number of collateral equal to
 * collateralPerPair from the LSP with the value of expiryPercentLong = 1. This is the max payout in collateral.
 * - Any price between R1 and R2 gives a payout equivalent to a yield dollar (bond) of notional N. In this range the
 * expiryPercentLong shifts to keep the payout in dollar terms equal to the bond notional.
 * - At any price above R2 the long holders are entitled to a fixed, minimum number of collateral equal to N/R2 with a
 * expiryPercentLong=(N/R2)/collateralPerPair.
 * The expression for the number of tokens paid out to the long side (T above) can be algebraically simplified,
 * transformed to remove the notional and reframed to express the expiryPercentLong as [min(max(1/R2,1/P),1/R1)]/(1/R1)
 * With this equation, the contract deployer does not need to specify the bond notional N. The notional can be calculated
 * by taking R1*collateralPerPair from the LSP.
 */
contract RangeBondLongShortPairFinancialProductLibrary is LongShortPairFinancialProductLibrary, Lockable {
    using FixedPoint for FixedPoint.Unsigned;
    using SignedSafeMath for int256;

    struct RangeBondLongShortPairParameters {
        uint256 highPriceRange;
        uint256 lowPriceRange;
    }

    mapping(address => RangeBondLongShortPairParameters) public longShortPairParameters;

    /**
     * @notice Enables any address to set the parameters price for an associated financial product.
     * @param longShortPair address of the LSP contract.
     * @param highPriceRange high price range after which the payout transforms from a yield dollar to a call option.
     * @param lowPriceRange low price range below which the payout transforms from a yield dollar to a short put option.
     * @dev between highPriceRange and lowPriceRange the contract will payout a fixed amount of
     * lowPriceRange*collateralPerPair (i.e the "notional" of the yield dollar).
     * @dev Note: a) Any address can set these parameters b) existing LSP parameters for address not set.
     * c) highPriceRange > lowPriceRange.
     * d) parameters price can only be set once to prevent the deployer from changing the parameters after the fact.
     * e) For safety, a parameters should be set before depositing any synthetic tokens in a liquidity pool.
     * f) longShortPair must expose an expirationTimestamp method to validate it is correctly deployed.
     */
    function setLongShortPairParameters(
        address longShortPair,
        uint256 highPriceRange,
        uint256 lowPriceRange
    ) public nonReentrant() {
        require(ExpiringContractInterface(longShortPair).expirationTimestamp() != 0, "Invalid LSP address");

        require(highPriceRange > lowPriceRange, "Invalid bounds");

        RangeBondLongShortPairParameters memory params = longShortPairParameters[longShortPair];
        require(params.highPriceRange == 0 && params.lowPriceRange == 0, "Parameters already set");

        longShortPairParameters[longShortPair] = RangeBondLongShortPairParameters({
            highPriceRange: highPriceRange,
            lowPriceRange: lowPriceRange
        });
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
        RangeBondLongShortPairParameters memory params = longShortPairParameters[msg.sender];
        require(params.highPriceRange != 0 || params.lowPriceRange != 0, "Params not set for calling LSP");

        // This function returns a value between 0 and 1e18 to be used in conjunction with the LSP collateralPerPair
        // that allocates collateral between the short and long tokens on expiry. This can be simplified by considering
        // the price in three discrete ranges: 1) below the low price range, 2) between low and high range and 3) above
        // the high price range.
        uint256 positiveExpiryPrice = expiryPrice > 0 ? uint256(expiryPrice) : 0;

        // 1) The long position is entitled to the full position in this range. The short token is worth 0.
        if (positiveExpiryPrice <= params.lowPriceRange) return FixedPoint.fromUnscaledUint(1).rawValue;
        // 2) Within the range, the long position is entitled to the bond notional value which is equal to
        // (collateral tokens * lowPriceRange).
        if (positiveExpiryPrice <= params.highPriceRange)
            return FixedPoint.Unsigned(params.lowPriceRange).div(FixedPoint.Unsigned(positiveExpiryPrice)).rawValue;
        // 3) Above the range, the long position is entitled to a fixed number of tokens.
        return FixedPoint.Unsigned(params.lowPriceRange).div(FixedPoint.Unsigned(params.highPriceRange)).rawValue;
    }
}

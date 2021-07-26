// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "./LongShortPairFinancialProductLibrary.sol";
import "../../../../common/implementation/Lockable.sol";

/**
 * @title Simple Success Token Long Short Pair Financial Product Library.
 * @notice Adds settlement logic to create success token LSPs. A success token pays out 50% of collateral as a
 * floor, with the remaining 50% functioning like an embedded covered call.
 * If the settlement is below the strike price then longs are worth 50% of collateral.
 * If the settlement is above the strike then the payout is equal to:
 * 0.5 + (0.5 * (expiryPrice - strikePrice) / expiryPrice)
 * For example, consider a covered call option collateralized in SUSHI, with a strike a price of $20,
 * and collateralPerPair of 2.
 * - If the price is less than $20 then the each long is worth 0.5 collateralPerPair and each short is worth 0.5
 * collateralPerPair. i.e., each long is worth 1 SUSHI (calls expire worthless).
 * - If the price is more than $20 then each long is worth 0.5 collateralPerPair plus 0.5 times the fraction of
 * collateralPerPair that was in the money, and each short is worth the remaining collateralPerPair.
 * - Say settlement price is $30.  Then expiryPercentLong = 0.5 + (0.5 * (30 - 20) / 30) = 0.6667.
 * If the collateralPerPair is 2, that means the long payout is 0.6667*2 = 1.3333 $SUSHI, which at a settlement
 * price of $30 is worth $40. This is equivalent to the value of 1 $SUSHI plus the value of the $20 strike
 * embedded call.
 */
contract SimpleSuccessTokenLongShortPairFinancialProductLibrary is LongShortPairFinancialProductLibrary, Lockable {
    using FixedPoint for FixedPoint.Unsigned;

    mapping(address => uint256) public longShortPairStrikePrices;
    uint256 basePercentage = 500000000000000000; // 0.5 with 18 decimals
    uint256 variablePercentage = uint256(1000000000000000000) - basePercentage;

    /**
     * @notice Enables any address to set the strike price for an associated LSP.
     * @param longShortPair address of the LSP.
     * @param strikePrice the strike price for the covered call for the associated LSP.
     * @dev Note: a) Any address can set the initial strike price b) A strike price cannot be 0.
     * c) A strike price can only be set once to prevent the deployer from changing the strike after the fact.
     * d) For safety, a strike price should be set before depositing any synthetic tokens in a liquidity pool.
     * e) longShortPair must expose an expirationTimestamp method to validate it is correctly deployed.
     */
    function setLongShortPairParameters(address longShortPair, uint256 strikePrice) public nonReentrant() {
        require(ExpiringContractInterface(longShortPair).expirationTimestamp() != 0, "Invalid LSP address");
        require(longShortPairStrikePrices[longShortPair] == 0, "Parameters already set");

        longShortPairStrikePrices[longShortPair] = strikePrice;
    }

    /**
     * @notice Returns a number between 0 and 1e18 to indicate how much collateral each long and short token are entitled
     * to per collateralPerPair.
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
        uint256 contractStrikePrice = longShortPairStrikePrices[msg.sender];
        require(contractStrikePrice != 0, "Params not set for calling LSP");

        // If the expiry price is less than the strike price then the long options expire worthless (out of the money).
        // In this case, return of value of 50% (half of collateral goes to long)
        // Note we do not consider negative expiry prices in this call option implementation.
        uint256 positiveExpiryPrice = expiryPrice > 0 ? uint256(expiryPrice) : 0;
        if (positiveExpiryPrice == 0 || uint256(positiveExpiryPrice) <= contractStrikePrice) return basePercentage;

        // Else, token expires to be worth the 0.5 of the collateral plus 0.5 * the fraction of a collateral token
        // that's in the money.
        // eg if SUSHI is $30 and strike is $20, long token is redeemable for 0.5 + 0.5*(30-20)/30 = 0.6667% which if the
        // collateralPerPair is 2, is worth 1.3333 $SUSHI, which is worth $40 if 1 $SUSHI is worth $30.
        // This return value is strictly < 1, tending to 1 as the expiryPrice tends to infinity.
        return
            (
                FixedPoint.Unsigned(basePercentage).add(
                    FixedPoint
                        .Unsigned(variablePercentage)
                        .mul(
                        FixedPoint.Unsigned(uint256(positiveExpiryPrice)).sub(FixedPoint.Unsigned(contractStrikePrice))
                    )
                        .div(FixedPoint.Unsigned(uint256(positiveExpiryPrice)))
                )
            )
                .rawValue;
    }
}

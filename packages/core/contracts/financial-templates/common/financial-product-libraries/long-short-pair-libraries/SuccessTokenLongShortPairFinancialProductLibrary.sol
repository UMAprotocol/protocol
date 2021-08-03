// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "./LongShortPairFinancialProductLibrary.sol";
import "../../../../common/implementation/Lockable.sol";

/**
 * @title Success Token Long Short Pair Financial Product Library.
 * @notice Adds settlement logic to create success token LSPs. A success token pays out a fixed amount of
 * collateral as a floor, with the remaining amount functioning like an embedded option. The embedded
 * option in this case uses payout logic that resembles a covered call. I.e., the token expires to be worth
 * basePercentage + (1 - basePercentage) * (expiryPrice - strikePrice).
 */
contract SuccessTokenLongShortPairFinancialProductLibrary is LongShortPairFinancialProductLibrary, Lockable {
    using FixedPoint for FixedPoint.Unsigned;

    struct SuccessTokenLongShortPairParameters {
        uint256 strikePrice;
        uint256 basePercentage;
    }

    mapping(address => SuccessTokenLongShortPairParameters) public longShortPairParameters;

    /**
     * @notice Enables any address to set the strike price for an associated LSP.
     * @param longShortPair address of the LSP.
     * @param strikePrice the strike price for the covered call for the associated LSP.
     * @param basePercentage the base percentage of collateral per pair paid out to long tokens, expressed
     * with 1e18 decimals. E.g., a 50% base percentage should be expressed 500000000000000000, or 0.5 with
     * 1e18 decimals. The base percentage cannot be set to 0.
     * @dev Note: a) Any address can set the initial strike price b) A strike price cannot be 0.
     * c) A strike price can only be set once to prevent the deployer from changing the strike after the fact.
     * d) For safety, a strike price should be set before depositing any synthetic tokens in a liquidity pool.
     * e) longShortPair must expose an expirationTimestamp method to validate it is correctly deployed.
     */
    function setLongShortPairParameters(
        address longShortPair,
        uint256 strikePrice,
        uint256 basePercentage
    ) public nonReentrant() {
        require(ExpiringContractInterface(longShortPair).expirationTimestamp() != 0, "Invalid LSP address");
        SuccessTokenLongShortPairParameters memory params = longShortPairParameters[longShortPair];
        require(params.strikePrice == 0 && params.basePercentage == 0, "Parameters already set");
        require(strikePrice != 0 && basePercentage != 0, "Base percentage and strike price cannot be set to 0");

        longShortPairParameters[longShortPair] = SuccessTokenLongShortPairParameters({
            strikePrice: strikePrice,
            basePercentage: basePercentage
        });
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
        SuccessTokenLongShortPairParameters memory params = longShortPairParameters[msg.sender];
        require(params.strikePrice != 0 || params.basePercentage != 0, "Params not set for calling LSP");

        // If the expiry price is less than the strike price then the long options expire worthless (out of the money).
        // In this case, return of value of the base percentage to the long tokenholders.
        // Note we do not consider negative expiry prices in this implementation.
        uint256 positiveExpiryPrice = expiryPrice > 0 ? uint256(expiryPrice) : 0;
        if (positiveExpiryPrice == 0 || positiveExpiryPrice <= params.strikePrice) return params.basePercentage;

        // Else, token expires to be worth basePercentage + (1 - basePercentage) * (expiryPrice - strikePrice).
        // E.g., if base percentage is 50%, $TOKEN is $30, and strike is $20, long token is redeemable for
        // 0.5 + 0.5*(30-20)/30 = 0.6667%, which if the collateralPerPair is 2, is worth 1.3333 $TOKEN, which is
        // worth $40 if 1 $TOKEN is worth $30. This return value is strictly < 1. The return value tends to 1 as
        // the expiryPrice tends to infinity. Due to rounding down and precision errors, this may return a very
        // slightly smaller value than expected.
        return
            (
                FixedPoint.Unsigned(params.basePercentage).add(
                    FixedPoint
                        .Unsigned(1e18 - params.basePercentage)
                        .mul(FixedPoint.Unsigned(positiveExpiryPrice).sub(FixedPoint.Unsigned(params.strikePrice)))
                        .div(FixedPoint.Unsigned(positiveExpiryPrice))
                )
            )
                .rawValue;
    }
}

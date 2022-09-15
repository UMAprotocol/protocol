// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/math/SignedSafeMath.sol";

import "./LongShortPairFinancialProductLibrary.sol";
import "../../../../common/implementation/Lockable.sol";

/**
 * @title Floored Linear Long Short Pair Financial Product Library.
 * @notice Adds settlement logic to create floored linear LSPs. The contract will payout a scaled amount of collateral
 * depending on where the settlement price lands within a price range between a lowerBound and an upperBound with
 * configured minimum floorPercentage payout for all prices below lowerBound. If settlement price is within the price
 * range then the expiryPercentLong is defined by (expiryPrice - lowerBound) / (upperBound - lowerBound) *
 * (1 - floorPercentage) + floorPercentage. This number represents the amount of collateral from the collateralPerPair
 * that will be sent to the long side. If the price is at or higher than the upperBound then expiryPercentLong = 1.
 * If the price is at or lower than the lowerBound then expiryPercentLong = floorPercentage. For example, consider a
 * floored linear LSP on the price of ETH collateralized in USDC with an upperBound = 4000, lowerBound = 2000 and
 * floorPercentage = 20% with a collateralPerPair of 1000 (i.e each pair of long and shorts is worth 1000 USDC). At
 * settlement the expiryPercentLong would equal 1 (each long worth 1000 and short worth 0) if ETH price was >= 4000 and
 * it would equal 0.2 if <= 2000 (each long is worth minimum 200 and each short is worth maximum 800). If between the
 * two (say 3500) then expiryPercentLong = (3500 - 2000) / (4000 - 2000) * (1 - 0.2) + 0.2 = 0.8. Therefore each long
 * is worth 800 and each short is worth 200.
 */
contract FlooredLinearLongShortPairFinancialProductLibrary is LongShortPairFinancialProductLibrary, Lockable {
    using FixedPoint for FixedPoint.Unsigned;
    using SignedSafeMath for int256;

    struct LinearLongShortPairParameters {
        int256 upperBound;
        int256 lowerBound;
        uint256 floorPercentage;
    }

    mapping(address => LinearLongShortPairParameters) public longShortPairParameters;

    /**
     * @notice Enables any address to set the parameters for an associated financial product.
     * @param longShortPair address of the LSP contract.
     * @param upperBound the upper price that the linear LSP will operate within.
     * @param lowerBound the lower price that the linear LSP will operate within.
     * @param floorPercentage the lowest possible payout percentage from collateralPerPair to each long token expressed
     * with 1e18 decimals. E.g., a 20% floor percentage should be expressed as 200000000000000000.
     * @dev Note: a) Any address can set these parameters b) existing LSP parameters for address not set.
     * c) upperBound > lowerBound.
     * d) floorPercentage <= 1e18 (no need to check >= 0 as floorPercentage is unsigned).
     * e) parameters can only be set once to prevent the deployer from changing the parameters after the fact.
     * f) For safety, parameters should be set before depositing any synthetic tokens in a liquidity pool.
     * g) longShortPair must expose an expirationTimestamp method to validate it is correctly deployed.
     */
    function setLongShortPairParameters(
        address longShortPair,
        int256 upperBound,
        int256 lowerBound,
        uint256 floorPercentage
    ) public nonReentrant() {
        require(ExpiringContractInterface(longShortPair).expirationTimestamp() != 0, "Invalid LSP address");
        require(upperBound > lowerBound, "Invalid bounds");
        require(floorPercentage <= 1e18, "Invalid floor percentage");

        LinearLongShortPairParameters memory params = longShortPairParameters[longShortPair];
        require(params.upperBound == 0 && params.lowerBound == 0, "Parameters already set");

        longShortPairParameters[longShortPair] = LinearLongShortPairParameters({
            upperBound: upperBound,
            lowerBound: lowerBound,
            floorPercentage: floorPercentage
        });
    }

    /**
     * @notice Returns a number between floorPercentage and 1e18 to indicate how much collateral each long and short
     * token is entitled to per collateralPerPair.
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
        LinearLongShortPairParameters memory params = longShortPairParameters[msg.sender];
        require(params.upperBound != 0 || params.lowerBound != 0, "Params not set for calling LSP");

        if (expiryPrice >= params.upperBound) return 1e18;

        if (expiryPrice <= params.lowerBound) return params.floorPercentage;

        // if not exceeding bounds, expiryPercentLong = (expiryPrice - lowerBound) / (upperBound - lowerBound) *
        // (1 - floorPercentage) + floorPercentage
        return
            FixedPoint
                .Unsigned(uint256(expiryPrice - params.lowerBound))
                .div(FixedPoint.Unsigned(uint256(params.upperBound - params.lowerBound)))
                .mul(FixedPoint.Unsigned(1e18 - params.floorPercentage))
                .add(FixedPoint.Unsigned(params.floorPercentage))
                .rawValue;
    }
}

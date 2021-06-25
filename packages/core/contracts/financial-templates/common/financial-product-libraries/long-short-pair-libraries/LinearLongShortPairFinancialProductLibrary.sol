// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/math/SignedSafeMath.sol";

import "./LongShortPairFinancialProductLibrary.sol";
import "../../../../common/implementation/Lockable.sol";

/**
 * @title Linear Long Short Pair Financial Product Library.
 * @notice Adds settlement logic to create linear LSPs. The contract will payout a scaled amount of collateral
 * depending on where the settlement price lands within a price range between an upperBound and a lowerBound. If
 * settlement price is within the price range then the expiryPercentLong is defined by
 * (expiryPrice - lowerBound) / (upperBound - lowerBound). This number represent the amount of collateral from the
 * collateralPerPair that will be sent to the long and short side. If the price is higher than the upperBound then
 * expiryPercentLong = 1. if the price is lower than the lower bound then expiryPercentLong = 0. For example, consider
 * a linear LSP on the price of ETH collateralized in USDC with an upperBound = 4000 and lowerBound = 2000 with a
 * collateralPerPair of 1000 (i.e each pair of long and shorts is worth 1000 USDC). At settlement the expiryPercentLong
 * would equal 1 (each long worth 1000 and short worth 0) if ETH price was > 4000 and it would equal 0 if < 2000
 * (each long is worthless and each short is worth 1000). If between the two (say 3500) then expiryPercentLong
 * = (3500 - 2000) / (4000 - 2000) = 0.75. Therefore each long is worth 750 and each short is worth 250.
 */
contract LinearLongShortPairFinancialProductLibrary is LongShortPairFinancialProductLibrary, Lockable {
    using FixedPoint for FixedPoint.Unsigned;
    using SignedSafeMath for int256;

    struct LinearLongShortPairParameters {
        int256 upperBound;
        int256 lowerBound;
    }

    mapping(address => LinearLongShortPairParameters) public longShortPairParameters;

    /**
     * @notice Enables any address to set the parameters for an associated financial product.
     * @param longShortPair address of the LSP contract.
     * @param upperBound the upper price that the linear LSP will operate within.
     * @param lowerBound the lower price that the linear LSP will operate within.
     * @dev Note: a) Any address can set these parameters b) existing LSP parameters for address not set.
     * c) upperBound > lowerBound.
     * d) parameters can only be set once to prevent the deployer from changing the parameters after the fact.
     * e) For safety, parameters should be set before depositing any synthetic tokens in a liquidity pool.
     * f) longShortPair must expose an expirationTimestamp method to validate it is correctly deployed.
     */
    function setLongShortPairParameters(
        address longShortPair,
        int256 upperBound,
        int256 lowerBound
    ) public nonReentrant() {
        require(ExpiringContractInterface(longShortPair).expirationTimestamp() != 0, "Invalid LSP address");
        require(upperBound > lowerBound, "Invalid bounds");

        LinearLongShortPairParameters memory params = longShortPairParameters[longShortPair];
        require(params.upperBound == 0 && params.lowerBound == 0, "Parameters already set");

        longShortPairParameters[longShortPair] = LinearLongShortPairParameters({
            upperBound: upperBound,
            lowerBound: lowerBound
        });
    }

    /**
     * @notice Returns a number between 0 and 1e18 to indicate how much collateral each long and short token is entitled
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
        LinearLongShortPairParameters memory params = longShortPairParameters[msg.sender];
        require(params.upperBound != 0 || params.lowerBound != 0, "Params not set for calling LSP");

        if (expiryPrice >= params.upperBound) return FixedPoint.fromUnscaledUint(1).rawValue;

        if (expiryPrice <= params.lowerBound) return FixedPoint.fromUnscaledUint(0).rawValue;

        // if not exceeding bounds, expiryPercentLong = (expiryPrice - lowerBound) / (upperBound - lowerBound)
        return
            FixedPoint
                .Unsigned(uint256(expiryPrice - params.lowerBound))
                .div(FixedPoint.Unsigned(uint256(params.upperBound - params.lowerBound)))
                .rawValue;
    }
}

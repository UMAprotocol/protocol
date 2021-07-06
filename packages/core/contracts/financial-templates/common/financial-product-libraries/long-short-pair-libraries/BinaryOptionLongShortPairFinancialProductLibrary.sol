// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";

import "./LongShortPairFinancialProductLibrary.sol";
import "../../../../common/implementation/Lockable.sol";

/**
 * @title Binary Option Long Short Pair Financial Product Library.
 * @notice Adds settlement logic to binary option LSPs. Binary options settle with all collateral allocated to
 * either the long or short side, depending on the settlement price. They can be used to make prediction markets or any
 * kind of binary bet. Settlement is defined using a strike price which informs which side of the bet was correct. If
 * settlement price is greater or equal to the strike then all value is sent to the long side. Otherwise, all value
 * is sent to the short side. The settlement price could be a scalar (like the price of ETH) or a binary bet with
 * settlement being 0 or 1 depending on the outcome.
 */
contract BinaryOptionLongShortPairFinancialProductLibrary is LongShortPairFinancialProductLibrary, Lockable {
    using FixedPoint for FixedPoint.Unsigned;
    using SafeMath for uint256;

    struct BinaryLongShortPairParameters {
        bool isSet;
        int256 strikePrice;
    }

    mapping(address => BinaryLongShortPairParameters) public longShortPairParameters;

    /**
     * @notice Enables any address to set the strike price for an associated binary option.
     * @param longShortPair address of the LSP.
     * @param strikePrice the strike price for the binary option.
     * @dev Note: a) Any address can set the initial strike price b) A strike can be 0.
     * c) A strike price can only be set once to prevent the deployer from changing the strike after the fact.
     * d) For safety, a strike price should be set before depositing any synthetic tokens in a liquidity pool.
     * e) longShortPair must expose an expirationTimestamp method to validate it is correctly deployed.
     */
    function setLongShortPairParameters(address longShortPair, int256 strikePrice) public nonReentrant() {
        require(ExpiringContractInterface(longShortPair).expirationTimestamp() != 0, "Invalid LSP address");
        require(!longShortPairParameters[longShortPair].isSet, "Parameters already set");

        longShortPairParameters[longShortPair] = BinaryLongShortPairParameters({
            isSet: true,
            strikePrice: strikePrice
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
        BinaryLongShortPairParameters memory params = longShortPairParameters[msg.sender];
        require(params.isSet, "Params not set for calling LSP");

        if (expiryPrice >= params.strikePrice) return FixedPoint.fromUnscaledUint(1).rawValue;
        else return FixedPoint.fromUnscaledUint(0).rawValue;
    }
}

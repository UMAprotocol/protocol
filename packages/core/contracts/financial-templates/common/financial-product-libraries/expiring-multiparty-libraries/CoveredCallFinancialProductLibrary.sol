// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;
import "./FinancialProductLibrary.sol";
import "../../../../common/implementation/Lockable.sol";

/**
 * @title Covered Call Financial Product Library.
 * @notice Adds custom price transformation logic to modify the behavior of the expiring multi party contract. The
 * contract holds say 1 WETH in collateral and pays out a portion of that, at expiry, if ETHUSD is above a set strike. If
 * ETHUSD is below that strike, the contract pays out 0. The fraction paid out if above the strike is defined by
 * (oraclePrice - strikePrice) / oraclePrice;
 * Example: expiry is DEC 31. Strike is $400. Each token is backed by 1 WETH.
 * If ETHUSD = $600 at expiry, the call is $200 in the money, and the contract pays out 0.333 WETH (worth $200).
 * If ETHUSD = $800 at expiry, the call is $400 in the money, and the contract pays out 0.5 WETH (worth $400).
 * If ETHUSD =< $400 at expiry, the call is out of the money, and the contract pays out 0 WETH.
 */
contract CoveredCallFinancialProductLibrary is FinancialProductLibrary, Lockable {
    using FixedPoint for FixedPoint.Unsigned;

    mapping(address => FixedPoint.Unsigned) private financialProductStrikes;

    /**
     * @notice Enables any address to set the strike price for an associated financial product.
     * @param financialProduct address of the financial product.
     * @param strikePrice the strike price for the covered call to be applied to the financial product.
     * @dev Note: a) Any address can set the initial strike price b) A strike price cannot be 0.
     * c) A strike price can only be set once to prevent the deployer from changing the strike after the fact.
     * d) For safety, a strike price should be set before depositing any synthetic tokens in a liquidity pool.
     * e) financialProduct must expose an expirationTimestamp method.
     */
    function setFinancialProductStrike(address financialProduct, FixedPoint.Unsigned memory strikePrice)
        public
        nonReentrant()
    {
        require(strikePrice.isGreaterThan(0), "Cant set 0 strike");
        require(financialProductStrikes[financialProduct].isEqual(0), "Strike already set");
        require(ExpiringContractInterface(financialProduct).expirationTimestamp() != 0, "Invalid EMP contract");
        financialProductStrikes[financialProduct] = strikePrice;
    }

    /**
     * @notice Returns the strike price associated with a given financial product address.
     * @param financialProduct address of the financial product.
     * @return strikePrice for the associated financial product.
     */
    function getStrikeForFinancialProduct(address financialProduct)
        public
        view
        nonReentrantView()
        returns (FixedPoint.Unsigned memory)
    {
        return financialProductStrikes[financialProduct];
    }

    /**
     * @notice Returns a transformed price by applying the call option payout structure.
     * @param oraclePrice price from the oracle to be transformed.
     * @param requestTime timestamp the oraclePrice was requested at.
     * @return transformedPrice the input oracle price with the price transformation logic applied to it.
     */
    function transformPrice(FixedPoint.Unsigned memory oraclePrice, uint256 requestTime)
        public
        view
        override
        nonReentrantView()
        returns (FixedPoint.Unsigned memory)
    {
        FixedPoint.Unsigned memory strike = financialProductStrikes[msg.sender];
        require(strike.isGreaterThan(0), "Caller has no strike");
        // If price request is made before expiry, return 1. Thus we can keep the contract 100% collateralized with
        // each token backed 1:1 by collateral currency.
        if (requestTime < ExpiringContractInterface(msg.sender).expirationTimestamp()) {
            return FixedPoint.fromUnscaledUint(1);
        }
        if (oraclePrice.isLessThanOrEqual(strike)) {
            return FixedPoint.fromUnscaledUint(0);
        } else {
            // Token expires to be worth the fraction of a collateral token that's in the money.
            // eg if ETHUSD is $500 and strike is $400, token is redeemable for 100/500 = 0.2 WETH (worth $100).
            // Note: oraclePrice cannot be 0 here because it would always satisfy the if above because 0 <= x is always
            // true.
            return (oraclePrice.sub(strike)).div(oraclePrice);
        }
    }

    /**
     * @notice Returns a transformed collateral requirement by applying the covered call payout structure.
     * @return transformedCollateralRequirement the input collateral requirement with the transformation logic applied to it.
     */
    function transformCollateralRequirement(FixedPoint.Unsigned memory, FixedPoint.Unsigned memory)
        public
        view
        override
        nonReentrantView()
        returns (FixedPoint.Unsigned memory)
    {
        FixedPoint.Unsigned memory strike = financialProductStrikes[msg.sender];
        require(strike.isGreaterThan(0), "Caller has no strike");

        // Always return 1 because option must be collateralized by 1 token.
        return FixedPoint.fromUnscaledUint(1);
    }
}

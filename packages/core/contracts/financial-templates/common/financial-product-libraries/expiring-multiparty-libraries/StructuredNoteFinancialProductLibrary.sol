// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;
import "./FinancialProductLibrary.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../../../../common/implementation/Lockable.sol";

/**
 * @title Structured Note Financial Product Library
 * @notice Adds custom price transformation logic to modify the behavior of the expiring multi party contract. The
 * contract holds say 1 WETH in collateral and pays out that 1 WETH if, at expiry, ETHUSD is below a set strike. If
 * ETHUSD is above that strike, the contract pays out a given dollar amount of ETH.
 * Example: expiry is DEC 31. Strike is $400. Each token is backed by 1 WETH
 * If ETHUSD < $400 at expiry, token is redeemed for 1 ETH.
 * If ETHUSD >= $400 at expiry, token is redeemed for $400 worth of ETH, as determined by the DVM.
 */
contract StructuredNoteFinancialProductLibrary is FinancialProductLibrary, Ownable, Lockable {
    using FixedPoint for FixedPoint.Unsigned;

    mapping(address => FixedPoint.Unsigned) financialProductStrikes;

    /**
     * @notice Enables the deployer of the library to set the strike price for an associated financial product.
     * @param financialProduct address of the financial product.
     * @param strikePrice the strike price for the structured note to be applied to the financial product.
     * @dev Note: a) Only the owner (deployer) of this library can set new strike prices b) A strike price cannot be 0.
     * c) A strike price can only be set once to prevent the deployer from changing the strike after the fact.
     * d)  financialProduct must exposes an expirationTimestamp method.
     */
    function setFinancialProductStrike(address financialProduct, FixedPoint.Unsigned memory strikePrice)
        public
        onlyOwner
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
     * @notice Returns a transformed price by applying the structured note payout structure.
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
        if (oraclePrice.isLessThan(strike)) {
            return FixedPoint.fromUnscaledUint(1);
        } else {
            // Token expires to be worth strike $ worth of collateral.
            // eg if ETHUSD is $500 and strike is $400, token is redeemable for 400/500 = 0.8 WETH.
            return strike.div(oraclePrice);
        }
    }

    /**
     * @notice Returns a transformed collateral requirement by applying the structured note payout structure. If the price
     * of the structured note is greater than the strike then the collateral requirement scales down accordingly.
     * @param oraclePrice price from the oracle to transform the collateral requirement.
     * @param collateralRequirement financial products collateral requirement to be scaled according to price and strike.
     * @return transformedCollateralRequirement the input collateral requirement with the transformation logic applied to it.
     */
    function transformCollateralRequirement(
        FixedPoint.Unsigned memory oraclePrice,
        FixedPoint.Unsigned memory collateralRequirement
    ) public view override nonReentrantView() returns (FixedPoint.Unsigned memory) {
        FixedPoint.Unsigned memory strike = financialProductStrikes[msg.sender];
        require(strike.isGreaterThan(0), "Caller has no strike");
        // If the price is less than the strike than the original collateral requirement is used.
        if (oraclePrice.isLessThan(strike)) {
            return collateralRequirement;
        } else {
            // If the price is more than the strike then the collateral requirement is scaled by the strike. For example
            // a strike of $400 and a CR of 1.2 would yield:
            // ETHUSD = $350, payout is 1 WETH. CR is multiplied by 1. resulting CR = 1.2
            // ETHUSD = $400, payout is 1 WETH. CR is multiplied by 1. resulting CR = 1.2
            // ETHUSD = $425, payout is 0.941 WETH (worth $400). CR is multiplied by 0.941. resulting CR = 1.1292
            // ETHUSD = $500, payout is 0.8 WETH (worth $400). CR multiplied by 0.8. resulting CR = 0.96
            return collateralRequirement.mul(strike.div(oraclePrice));
        }
    }
}

// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;
pragma abicoder v2;
import "./FinancialProductLibrary.sol";
import "../../../common/implementation/Lockable.sol";

/**
 * @title KPI Options Financial Product Library
 * @notice Adds custom tranformation logic to modify the price and collateral requirement behavior of the expiring multi party contract.
 * If a price request is made pre-expiry, the price should always be set to 2 and the collateral requirement should be set to 1.
 * Post-expiry, the collateral requirement is left as 1 and the price is left unchanged.
 */
contract KpiOptionsFinancialProductLibrary is FinancialProductLibrary, Lockable {
    using FixedPoint for FixedPoint.Unsigned;

    struct TransformedPrice {
        bool set;
        FixedPoint.Unsigned price;
    }

    mapping(address => TransformedPrice) public financialProductTransformedPrices;

    /**
     * @notice Enables any address to set the transformed price for an associated financial product.
     * @dev Note: a) Any address can set price transformations b) The price can't be set to blank.
     * c) A transformed price can only be set once to prevent the deployer from changing it after the fact.
     * d)  financialProduct must expose an expirationTimestamp method.
     * @param financialProduct address of the financial product.
     * @param transformedPrice the price for the financial product to be used if the contract is pre-expiration.
     */
    function setFinancialProductTransformedPrice(address financialProduct, FixedPoint.Unsigned memory transformedPrice)
        public
        nonReentrant()
    {
        require(financialProductTransformedPrices[financialProduct].set == false, "Price already set");
        require(ExpiringContractInterface(financialProduct).expirationTimestamp() != 0, "Invalid EMP contract");
        financialProductTransformedPrices[financialProduct].set = true;
        financialProductTransformedPrices[financialProduct].price = transformedPrice;
    }

    /**
     * @notice Returns a transformed price for pre-expiry price requests.
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
        TransformedPrice storage transformedPrice = financialProductTransformedPrices[msg.sender];
        require(transformedPrice.set == true, "Caller has no transformation");
        // If price request is made before expiry, return transformed price. Post-expiry, leave unchanged.
        if (requestTime < ExpiringContractInterface(msg.sender).expirationTimestamp()) {
            return transformedPrice.price;
        } else {
            return oraclePrice;
        }
    }

    /**
     * @notice Returns a transformed collateral requirement that is set to be equivalent to 2 tokens pre-expiry.
     * @param oraclePrice price from the oracle to transform the collateral requirement.
     * @param collateralRequirement financial products collateral requirement to be scaled to a flat rate.
     * @return transformedCollateralRequirement the input collateral requirement with the transformation logic applied to it.
     */
    function transformCollateralRequirement(
        FixedPoint.Unsigned memory oraclePrice,
        FixedPoint.Unsigned memory collateralRequirement
    ) public view override nonReentrantView() returns (FixedPoint.Unsigned memory) {
        // Always return 1.
        return FixedPoint.fromUnscaledUint(1);
    }
}

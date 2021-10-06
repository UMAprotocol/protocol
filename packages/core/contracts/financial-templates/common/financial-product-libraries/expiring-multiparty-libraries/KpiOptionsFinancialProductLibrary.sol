// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;
import "./FinancialProductLibrary.sol";
import "../../../../common/implementation/Lockable.sol";

/**
 * @title KPI Options Financial Product Library
 * @notice Adds custom tranformation logic to modify the price and collateral requirement behavior of the expiring multi party contract.
 * If a price request is made pre-expiry, the price should always be set to 2 and the collateral requirement should be set to 1.
 * Post-expiry, the collateral requirement is left as 1 and the price is left unchanged.
 */
contract KpiOptionsFinancialProductLibrary is FinancialProductLibrary, Lockable {
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
        // If price request is made before expiry, return 2. Thus we can keep the contract 100% collateralized with
        // each token backed 1:2 by collateral currency. Post-expiry, leave unchanged.
        if (requestTime < ExpiringContractInterface(msg.sender).expirationTimestamp()) {
            return FixedPoint.fromUnscaledUint(2);
        } else {
            return oraclePrice;
        }
    }

    /**
     * @notice Returns a transformed collateral requirement that is set to be equivalent to 2 tokens pre-expiry.
     * @return transformedCollateralRequirement the input collateral requirement with the transformation logic applied to it.
     */
    function transformCollateralRequirement(FixedPoint.Unsigned memory, FixedPoint.Unsigned memory)
        public
        view
        override
        nonReentrantView()
        returns (FixedPoint.Unsigned memory)
    {
        // Always return 1.
        return FixedPoint.fromUnscaledUint(1);
    }
}

// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;
import "../../../../common/implementation/FixedPoint.sol";

interface ExpiringContractInterface {
    function expirationTimestamp() external view returns (uint256);
}

/**
 * @title Financial product library contract
 * @notice Provides price and collateral requirement transformation interfaces that can be overridden by custom
 * Financial product library implementations.
 */
abstract contract FinancialProductLibrary {
    using FixedPoint for FixedPoint.Unsigned;

    /**
     * @notice Transforms a given oracle price using the financial product libraries transformation logic.
     * @param oraclePrice input price returned by the DVM to be transformed.
     * @return transformedOraclePrice input oraclePrice with the transformation function applied.
     */
    function transformPrice(FixedPoint.Unsigned memory oraclePrice, uint256)
        public
        view
        virtual
        returns (FixedPoint.Unsigned memory)
    {
        return oraclePrice;
    }

    /**
     * @notice Transforms a given collateral requirement using the financial product libraries transformation logic.
     * @param collateralRequirement input collateral requirement to be transformed.
     * @return transformedCollateralRequirement input collateral requirement with the transformation function applied.
     */
    function transformCollateralRequirement(
        FixedPoint.Unsigned memory,
        FixedPoint.Unsigned memory collateralRequirement
    ) public view virtual returns (FixedPoint.Unsigned memory) {
        return collateralRequirement;
    }

    /**
     * @notice Transforms a given price identifier using the financial product libraries transformation logic.
     * @param priceIdentifier input price identifier defined for the financial contract.
     * @return transformedPriceIdentifier input price identifier with the transformation function applied.
     */
    function transformPriceIdentifier(bytes32 priceIdentifier, uint256) public view virtual returns (bytes32) {
        return priceIdentifier;
    }
}

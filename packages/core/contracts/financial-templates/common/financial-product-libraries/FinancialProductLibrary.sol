pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;
import "../../../common/implementation/FixedPoint.sol";

/**
 * @title Financial product library contract
 * @notice Provides price and collateral requirement transformation interfaces that can be overridden by custom
 * Financial product library implementations.
 */
abstract contract FinancialProductLibrary {
    using FixedPoint for FixedPoint.Unsigned;

    /**
     * @notice Transforms a given oracle price using the financial product libraries transformation logic.
     * @param oraclePrice input price to be transformed.
     * @param requestTime timestamp the oraclePrice was requested at.
     * @return transformedPrice input oraclePrice with the transformation function applied.
     */
    function transformPrice(FixedPoint.Unsigned memory oraclePrice, uint256 requestTime)
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
    // TODO: integrate this function into liquidatable.
    function transformCollateralRequirement(FixedPoint.Unsigned memory collateralRequirement)
        public
        view
        virtual
        returns (FixedPoint.Unsigned memory)
    {
        return collateralRequirement;
    }
}

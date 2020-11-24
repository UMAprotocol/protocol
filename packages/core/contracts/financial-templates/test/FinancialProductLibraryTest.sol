pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;
import "../common/financial-product-libraries/FinancialProductLibrary.sol";

// Implements a simple FinancialProductLibrary to test price and collateral requirement transoformations.
contract FinancialProductLibraryTest is FinancialProductLibrary {
    FixedPoint.Unsigned public priceTransformationScalar;
    FixedPoint.Unsigned public collateralRequirementTransformationScalar;

    constructor(
        FixedPoint.Unsigned memory _priceTransformationScalar,
        FixedPoint.Unsigned memory _collateralRequirementTransformationScalar
    ) public {
        priceTransformationScalar = _priceTransformationScalar;
        collateralRequirementTransformationScalar = _collateralRequirementTransformationScalar;
    }

    // Create a simple price transformation function that scales the input price by the scalar for testing.
    function transformPrice(FixedPoint.Unsigned memory oraclePrice, uint256 requestTime)
        public
        view
        override
        returns (FixedPoint.Unsigned memory)
    {
        return oraclePrice.mul(priceTransformationScalar);
    }

    // Create a simple price transformCollateralRequirement that doubles the input collateralRequirement.
    function transformCollateralRequirement(
        FixedPoint.Unsigned memory price,
        FixedPoint.Unsigned memory collateralRequirement
    ) public view override returns (FixedPoint.Unsigned memory) {
        return collateralRequirement.mul(collateralRequirementTransformationScalar);
    }
}

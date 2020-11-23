pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;
import "../common/financial-product-libraries/FinancialProductLibrary.sol";

// Implements a simple FinancialProductLibrary to test price and collateral requirement transoformations.
contract FinancialProductLibraryTest is FinancialProductLibrary {
    FixedPoint.Unsigned public scalar;

    constructor(FixedPoint.Unsigned memory _scalar) public {
        scalar = _scalar;
    }

    // Create a simple price transformation function that scales the input price by the scalar for testing.
    function transformPrice(FixedPoint.Unsigned memory oraclePrice, uint256 requestTime)
        public
        view
        override
        returns (FixedPoint.Unsigned memory)
    {
        return oraclePrice.mul(scalar);
    }

    // Create a simple price transformation that doubles the input number.
    // TODO: add intergration to liquidatable for this method.
    function transformCollateralRequirement(FixedPoint.Unsigned memory collateralRequirement)
        public
        view
        override
        returns (FixedPoint.Unsigned memory)
    {
        return collateralRequirement.mul(scalar);
    }
}

pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;
import "../common/financial-product-libraries/FinancialProductLibrary.sol";

// Implements a simple FinancialProductLibrary to test price and collateral requirement transoformations.
contract FinancialProductLibraryTest is FinancialProductLibrary {
    FixedPoint.Unsigned public priceTransformationScalar;
    FixedPoint.Unsigned public collateralRequirementTransformationScalar;
    bytes32 public transformedPriceIdentifier;
    bool public shouldRevert;

    constructor(
        FixedPoint.Unsigned memory _priceTransformationScalar,
        FixedPoint.Unsigned memory _collateralRequirementTransformationScalar,
        bytes32 _transformedPriceIdentifier
    ) public {
        priceTransformationScalar = _priceTransformationScalar;
        collateralRequirementTransformationScalar = _collateralRequirementTransformationScalar;
        transformedPriceIdentifier = _transformedPriceIdentifier;
    }

    // Set the mocked methods to revert to test failed library computation.
    function setShouldRevert(bool _shouldRevert) public {
        shouldRevert = _shouldRevert;
    }

    // Create a simple price transformation function that scales the input price by the scalar for testing.
    function transformPrice(FixedPoint.Unsigned memory oraclePrice, uint256 requestTime)
        public
        view
        override
        returns (FixedPoint.Unsigned memory)
    {
        require(!shouldRevert, "set to always reverts");
        return oraclePrice.mul(priceTransformationScalar);
    }

    // Create a simple collateral requirement transformation that doubles the input collateralRequirement.
    function transformCollateralRequirement(
        FixedPoint.Unsigned memory price,
        FixedPoint.Unsigned memory collateralRequirement
    ) public view override returns (FixedPoint.Unsigned memory) {
        require(!shouldRevert, "set to always reverts");
        return collateralRequirement.mul(collateralRequirementTransformationScalar);
    }

    // Create a simple transformPriceIdentifier function that returns the transformed price identifier.
    function transformPriceIdentifier(bytes32 priceIdentifier, uint256 requestTime)
        public
        view
        override
        returns (bytes32)
    {
        require(!shouldRevert, "set to always reverts");
        return transformedPriceIdentifier;
    }
}

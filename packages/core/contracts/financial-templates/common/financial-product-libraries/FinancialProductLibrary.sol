pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;
import "../../../common/implementation/FixedPoint.sol";


abstract contract FinancialProductLibrary {
    using FixedPoint for FixedPoint.Unsigned;

    function transformPrice(FixedPoint.Unsigned memory oraclePrice)
        public
        virtual
        view
        returns (FixedPoint.Unsigned memory)
    {
        return oraclePrice;
    }

    // TODO: intergrate this function into liquidatable.
    function transformCollateralRequirement(FixedPoint.Unsigned memory collateralRequirement)
        public
        virtual
        view
        returns (FixedPoint.Unsigned memory)
    {
        return collateralRequirement;
    }
}

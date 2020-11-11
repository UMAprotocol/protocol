pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;
import "../../common/implementation/FixedPoint.sol";


abstract contract FinancialProductLibrary {
    using FixedPoint for FixedPoint.Unsigned;

    function transformPrice(int256 oraclePrice) public virtual view returns (int256) {
        return oraclePrice;
    }

    function transformCollateralRequirement(FixedPoint.Unsigned memory collateralRequirement)
        public
        virtual
        view
        returns (FixedPoint.Unsigned memory)
    {
        return collateralRequirement;
    }
}

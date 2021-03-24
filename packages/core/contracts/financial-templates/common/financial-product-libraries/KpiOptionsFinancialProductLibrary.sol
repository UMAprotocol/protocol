pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;
import "./FinancialProductLibrary.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../../../common/implementation/Lockable.sol";

/**
 * @title KPI Options Financial Product Library
 * @notice Returns a transformed collateral requirement. The collateralization requirement should
 * always be equivalent to being collateralized by 2 tokens, no matter what the price or expiration status is.
 */
contract KpiOptionsFinancialProductLibrary is FinancialProductLibrary, Ownable, Lockable {
    /**
     * @notice Returns a transformed collateral requirement that is always set to 2 tokens.
     * @param oraclePrice price from the oracle to transform the collateral requirement.
     * @param collateralRequirement financial products collateral requirement to be scaled to a flat rate.
     * @return transformedCollateralRequirement the input collateral requirement with the transformation logic applied to it.
     */
    function transformCollateralRequirement(
        FixedPoint.Unsigned memory oraclePrice,
        FixedPoint.Unsigned memory collateralRequirement
    ) public view override nonReentrantView() returns (FixedPoint.Unsigned memory) {
        // Always return 2 because the option must be collateralized by 2 tokens.
        return FixedPoint.fromUnscaledUint(2);
    }
}

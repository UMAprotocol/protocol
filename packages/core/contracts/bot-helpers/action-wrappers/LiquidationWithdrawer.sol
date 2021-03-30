pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "../../common/implementation/FixedPoint.sol";

contract LiquidationWithdrawer {
    function withdrawLiquidation(
        address financialContractAddress,
        uint256 liquidationId,
        address sponsor
    ) public returns (IFinancialContract.RewardsData memory) {
        return IFinancialContract(financialContractAddress).withdrawLiquidation(liquidationId, sponsor);
    }
}

interface IFinancialContract {
    struct RewardsData {
        FixedPoint.Unsigned payToSponsor;
        FixedPoint.Unsigned payToLiquidator;
        FixedPoint.Unsigned payToDisputer;
        FixedPoint.Unsigned paidToSponsor;
        FixedPoint.Unsigned paidToLiquidator;
        FixedPoint.Unsigned paidToDisputer;
    }

    function withdrawLiquidation(uint256 liquidationId, address sponsor) external returns (RewardsData memory);
}

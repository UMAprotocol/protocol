// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../../common/implementation/FixedPoint.sol";

// Simple contract used to withdraw liquidations using a DSProxy from legacy contracts (1.2.2 and below).
contract LiquidationWithdrawer {
    function withdrawLiquidation(
        address financialContractAddress,
        uint256 liquidationId,
        address sponsor
    ) public returns (FixedPoint.Unsigned memory) {
        return IFinancialContract(financialContractAddress).withdrawLiquidation(liquidationId, sponsor);
    }
}

interface IFinancialContract {
    function withdrawLiquidation(uint256 liquidationId, address sponsor)
        external
        returns (FixedPoint.Unsigned memory amountWithdrawn);
}

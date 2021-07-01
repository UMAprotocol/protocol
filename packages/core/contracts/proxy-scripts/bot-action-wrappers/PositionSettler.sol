// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../../common/implementation/FixedPoint.sol";

// Simple contract used to Settle expired positions using a DSProxy.
contract PositionSettler {
    function settle(address financialContractAddress) public returns (FixedPoint.Unsigned memory) {
        return IFinancialContract(financialContractAddress).settle();
    }
}

interface IFinancialContract {
    function settle() external returns (FixedPoint.Unsigned memory amountWithdrawn);
}

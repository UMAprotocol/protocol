pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "../../common/implementation/FixedPoint.sol";

/**
 * @notice External methods that any financial contract must implement.
 */
interface FinancialContractInterface {
    function pfc() external view returns (FixedPoint.Unsigned memory);
}

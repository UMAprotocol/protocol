/*
  StoreInterface contract.

  An interface that allows derivative contracts to pay fees.
*/
pragma solidity ^0.5.0;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";


// This interface allows derivative contracts to pay fees for their use of the system.
interface StoreInterface {
    function computeFees(uint startTime, uint endTime, uint pfc) external view returns (uint feeAmount);

    function payFees() external payable;

    function payFeesErc20(IERC20 erc20) external; 
}

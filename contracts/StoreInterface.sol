/*
  StoreInterface contract.

  An interface that allows derivative contracts to pay fees.
*/
pragma solidity ^0.5.0;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";


// This interface allows derivative contracts to pay fees for their use of the system.
interface StoreInterface {

    // Pays fees in ETH to the store. To be used by contracts whose margin currency is ETH.
    function payFees() external payable;

    // Pays fees in the margin currency, erc20Address, to the store. To be used if the margin currency is an ERC20 token
    // rather than ETH. All approved tokens are transfered.
    function payFeesErc20(address erc20Address) external; 

    // Computes the fees that a contract should pay for a period. `pfc` is the "profit from corruption", or the maximum
    // amount of margin currency that a token sponsor could extract from the contract through corrupting the price feed
    // in their favor.
    function computeFees(uint startTime, uint endTime, uint pfc) external view returns (uint feeAmount);
}

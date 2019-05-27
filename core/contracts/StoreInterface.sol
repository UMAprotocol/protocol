/*
  StoreInterface contract.

  An interface that allows derivative contracts to pay Oracle fees.
*/
pragma solidity ^0.5.0;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";


// This interface allows derivative contracts to pay Oracle fees for their use of the system.
interface StoreInterface {

    // Pays Oracle fees in ETH to the store. To be used by contracts whose margin currency is ETH.
    function payOracleFees() external payable;

    // Pays Oracle fees in the margin currency, erc20Address, to the store. To be used if the margin currency is an
    // ERC20 token rather than ETH. All approved tokens are transfered.
    function payOracleFeesErc20(address erc20Address) external; 

    // Computes the Oracle fees that a contract should pay for a period. `pfc` is the "profit from corruption", or the
    // maximum amount of margin currency that a token sponsor could extract from the contract through corrupting the
    // price feed in their favor.
    function computeOracleFees(uint startTime, uint endTime, uint pfc) external view returns (uint feeAmount);
}

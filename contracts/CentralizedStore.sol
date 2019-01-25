/*
  CentralizedStore implementation.
 
  An implementation of StoreInterface with a fee per second and withdraw functions for the owner.
*/
pragma solidity ^0.5.0;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import "./StoreInterface.sol";


// An implementation of StoreInterface that can accept Oracle fees in ETH or any arbitrary ERC20 token.
contract CentralizedStore is StoreInterface, Ownable {

    using SafeMath for uint;

    uint private fixedOracleFeePerSecond; // Percentage of 10^18. E.g., 1e18 is 100% Oracle fee.

    function payOracleFees() external payable {
        require(msg.value > 0);
    }

    function payOracleFeesErc20(address erc20Address) external {
        IERC20 erc20 = IERC20(erc20Address);
        uint authorizedAmount = erc20.allowance(msg.sender, address(this));
        require(authorizedAmount > 0);
        require(erc20.transferFrom(msg.sender, address(this), authorizedAmount));
    }

    // Withdraws ETH from the store.
    function withdraw(uint amount) external onlyOwner {
        msg.sender.transfer(amount);
    }

    // Withdraws ERC20 tokens from the store.
    function withdrawErc20(address erc20Address, uint amount) external onlyOwner {
        IERC20 erc20 = IERC20(erc20Address);
        require(erc20.transfer(msg.sender, amount));
    }

    // Sets a new Oracle fee per second.
    function setFixedOracleFeePerSecond(uint newOracleFee) external onlyOwner {
        // Oracle fees at or over 100% don't make sense.
        require(newOracleFee < 1 ether);
        fixedOracleFeePerSecond = newOracleFee;
    }

    function computeOracleFees(uint startTime, uint endTime, uint pfc) external view returns (uint oracleFeeAmount) {
        uint timeRange = endTime.sub(startTime);
        return pfc.mul(fixedOracleFeePerSecond).mul(timeRange).div(1 ether);
    }
}

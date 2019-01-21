/*
  CentralizedStore implementation.
 
  An implementation of StoreInterface with a fee per second and withdraw functions for the owner.
*/
pragma solidity ^0.5.0;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import "./StoreInterface.sol";


// An implementation of StoreInterface that can accept fees in ETH or any arbitrary ERC20 token.
contract CentralizedStore is StoreInterface, Ownable {

    using SafeMath for uint;

    uint private fixedFeePerSecond; // Percentage of 10^18. E.g., 1e18 is 100% fee.

    function payFees() external payable {
        require(msg.value > 0);
    }

    function payFeesErc20(address erc20Address) external {
        IERC20 erc20 = IERC20(erc20Address);
        uint authorizedAmount = erc20.allowance(msg.sender, address(this));
        require(erc20.transferFrom(msg.sender, address(this), authorizedAmount));
    }

    // Withdraws ETC from the store.
    function withdraw(uint amount) external onlyOwner {
        msg.sender.transfer(amount);
    }

    // Withdraws ERC20 tokens from the store.
    function withdrawErc20(address erc20Address, uint amount) external onlyOwner {
        IERC20 erc20 = IERC20(erc20Address);
        require(erc20.transfer(msg.sender, amount));
    }

    // Sets a new fee per second.
    function setFixedFeePerSecond(uint newFee) external onlyOwner {
        // Fees at or over 100% don't make sense.
        require(newFee < 1 ether);
        fixedFeePerSecond = newFee;
    }

    function computeFees(uint startTime, uint endTime, uint pfc) external view returns (uint feeAmount) {
        uint timeRange = endTime.sub(startTime);
        return pfc.mul(fixedFeePerSecond).mul(timeRange).div(1 ether);
    }
}

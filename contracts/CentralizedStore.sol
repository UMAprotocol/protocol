pragma solidity ^0.5.0;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import "./StoreInterface.sol";


contract CentralizedStore is StoreInterface, Ownable {

    using SafeMath for uint;

    uint private fixedFeePerSecond; // Percentage of 10^18. E.g., 1e18 is 100% fee.

    function computeFees(uint startTime, uint endTime, uint pfc) external view returns (uint feeAmount) {
        uint timeRange = endTime.sub(startTime);
        return pfc.mul(fixedFeePerSecond).mul(timeRange).div(1 ether);
    }

    function payFees() external payable {
    }

    function payFeesErc20(IERC20 erc20) external {
    }

    function withdraw(uint amount) external {
    }

    function withdrawErc20(address erc20, uint amount) external {
    }

    function setFixedFeePerSecond(uint newFee) external onlyOwner {
        // Fees at or over 100% don't make sense.
        require(newFee < 1 ether);
        fixedFeePerSecond = newFee;
    }
}

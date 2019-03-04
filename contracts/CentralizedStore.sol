/*
  CentralizedStore implementation.
 
  An implementation of StoreInterface with a fee per second and withdraw functions for the owner.
*/
pragma solidity ^0.5.0;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "./StoreInterface.sol";
import "./Withdrawable.sol";


// An implementation of StoreInterface that can accept Oracle fees in ETH or any arbitrary ERC20 token.
contract CentralizedStore is StoreInterface, Withdrawable {

    using SafeMath for uint;

    uint private fixedOracleFeePerSecond; // Percentage of 10^18. E.g., 1e18 is 100% Oracle fee.
    uint private constant FP_SCALING_FACTOR = 10**18;

    function payOracleFees() external payable {
        require(msg.value > 0);
    }

    function payOracleFeesErc20(address erc20Address) external {
        IERC20 erc20 = IERC20(erc20Address);
        uint authorizedAmount = erc20.allowance(msg.sender, address(this));
        require(authorizedAmount > 0);
        require(erc20.transferFrom(msg.sender, address(this), authorizedAmount));
    }

    // Sets a new Oracle fee per second.
    function setFixedOracleFeePerSecond(uint newOracleFee) external onlyOwner {
        // Oracle fees at or over 100% don't make sense.
        require(newOracleFee < FP_SCALING_FACTOR);
        fixedOracleFeePerSecond = newOracleFee;
        emit SetFixedOracleFeePerSecond(newOracleFee);
    }

    function computeOracleFees(uint startTime, uint endTime, uint pfc) external view returns (uint oracleFeeAmount) {
        uint timeRange = endTime.sub(startTime);

        // The oracle fees before being divided by the FP_SCALING_FACTOR.
        uint oracleFeesPreDivision = pfc.mul(fixedOracleFeePerSecond).mul(timeRange);
        oracleFeeAmount = oracleFeesPreDivision.div(FP_SCALING_FACTOR);

        // If there is any remainder, add 1. This causes the division to ceil rather than floor the result.
        if (oracleFeesPreDivision.mod(FP_SCALING_FACTOR) != 0) {
            oracleFeeAmount = oracleFeeAmount.add(1);
        }
    }

    event SetFixedOracleFeePerSecond(uint newOracleFee);
}

/*
  Store implementation.
 
  An implementation of StoreInterface with a fee per second and withdraw functions for the owner.
*/
pragma solidity ^0.5.0;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";
//import "./StoreInterface.sol";
import "./Withdrawable.sol";


// An implementation of StoreInterface that can accept Oracle fees in ETH or any arbitrary ERC20 token.
contract Store {

    using SafeMath for uint;

    uint private fixedOracleFeePerSecond; // Percentage of 10^18. E.g., 1e18 is 100% Oracle fee.
    uint private constant FP_SCALING_FACTOR = 10**18;

    uint weeklyDelayFee; //<-- governance vote?
    mapping(address => uint) finalFees;
    uint secondsPerWeek = 604800;

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
    //TODO change permissioning
    function setFixedOracleFeePerSecond(uint newOracleFee) external {
        // Oracle fees at or over 100% don't make sense.
        require(newOracleFee < FP_SCALING_FACTOR);
        fixedOracleFeePerSecond = newOracleFee;
        emit SetFixedOracleFeePerSecond(newOracleFee);
    }

    function computeRegularFee(uint startTime, uint endTime, uint pfc, bytes32 identifier) external view returns (uint regularFee, uint latePenalty) {
        uint timeDiff = endTime.sub(startTime);

        regularFee = pfc.mul(fixedOracleFeePerSecond.mul(timeDiff));
        latePenalty = pfc.mul(weeklyDelayFee.mul(timeDiff.div(secondsPerWeek)));

        return (regularFee, latePenalty);
    }

    function computeFinalFee(bytes32 identifier, address currency) external view returns (uint finalFee) {
        finalFee = finalFees[currency];
    }

    event SetFixedOracleFeePerSecond(uint newOracleFee);

}

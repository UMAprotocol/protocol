/*
  Store implementation.
 
  An implementation of StoreInterface with a fee per second and withdraw functions for the owner.
*/
pragma solidity ^0.5.0;
pragma experimental ABIEncoderV2;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "./StoreInterface.sol";
import "./Withdrawable.sol";
import "./FixedPoint.sol";


// An implementation of StoreInterface that can accept Oracle fees in ETH or any arbitrary ERC20 token.
contract Store {

    using SafeMath for uint;
    using FixedPoint for FixedPoint.Unsigned;
    using FixedPoint for uint;

    uint private fixedOracleFeePerSecond; // Percentage of 10^18. E.g., 1e18 is 100% Oracle fee.
    uint private constant FP_SCALING_FACTOR = 10**18;

    uint private constant WEEKLY_DELAY_FEE = 0; //<-- governance vote?
    mapping(address => FixedPoint.Unsigned) private finalFees;
    uint private constant SECONDS_PER_WEEK = 604800;

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

    function computeRegularFee(uint startTime, uint endTime, FixedPoint.Unsigned calldata pfc,
    bytes32 identifier) external view 
    returns (FixedPoint.Unsigned memory regularFee, 
    FixedPoint.Unsigned memory latePenalty) {
        uint timeDiff = endTime.sub(startTime);

        regularFee = pfc.mul(fixedOracleFeePerSecond).mul(timeDiff).div(FP_SCALING_FACTOR);
        latePenalty = pfc.mul(WEEKLY_DELAY_FEE.mul(timeDiff.div(SECONDS_PER_WEEK)));

        return (regularFee, latePenalty);
    }

    function computeFinalFee(address currency) external view 
    returns (FixedPoint.Unsigned memory finalFee) {
        finalFee = finalFees[currency];
    }

    event SetFixedOracleFeePerSecond(uint newOracleFee);

}

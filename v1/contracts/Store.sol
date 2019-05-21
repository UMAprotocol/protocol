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
import "./MultiRole.sol";


// An implementation of StoreInterface that can accept Oracle fees in ETH or any arbitrary ERC20 token.
contract Store is StoreInterface, MultiRole {

    using SafeMath for uint;
    using FixedPoint for FixedPoint.Unsigned;
    using FixedPoint for uint;

    enum Roles {
        Governance
    }

    uint private fixedOracleFeePerSecond; // Percentage of 10^18. E.g., 1e18 is 100% Oracle fee.
    uint private constant FP_SCALING_FACTOR = 10**18;

    uint private weeklyDelayFee;
    mapping(address => FixedPoint.Unsigned) private finalFees;
    uint private constant SECONDS_PER_WEEK = 604800;

    // TODO(roz): Used to make doubly sure that roles are initialized only once. 
    // Figure out what's going wrong with coverage to necessitate this hack.
    bool private rolesInitialized;

    constructor() public {
        initializeRolesOnce();
    }

    function payOracleFees() external payable {
        require(msg.value > 0);
    }

    function payOracleFeesErc20(address erc20Address) external {
        IERC20 erc20 = IERC20(erc20Address);
        uint authorizedAmount = erc20.allowance(msg.sender, address(this));
        require(authorizedAmount > 0);
        require(erc20.transferFrom(msg.sender, address(this), authorizedAmount));
    }

    // Sets a new Oracle fee per second
    function setFixedOracleFeePerSecond(FixedPoint.Unsigned calldata newOracleFee) 
        external 
        onlyRoleHolder(uint(Roles.Governance)) 
    {
        // Oracle fees at or over 100% don't make sense.
        require(newOracleFee.isLessThan(1));
        fixedOracleFeePerSecond = newOracleFee.value;
        emit SetFixedOracleFeePerSecond(newOracleFee);
    }

    function setFinalFee(address currency, uint finalFee) 
        external 
        onlyRoleHolder(uint(Roles.Governance))
    {
        finalFees[currency] = FixedPoint.Unsigned(finalFee);
    }

    function setWeeklyDelayFee(uint newWeeklyDelayFee) 
        external 
        onlyRoleHolder(uint(Roles.Governance)) 
    {
        weeklyDelayFee = newWeeklyDelayFee;
    }

    function computeRegularFee(uint startTime, uint endTime, FixedPoint.Unsigned calldata pfc, bytes32 identifier) 
        external 
        view 
        returns (FixedPoint.Unsigned memory regularFee, FixedPoint.Unsigned memory latePenalty) 
    {
        uint timeDiff = endTime.sub(startTime);

        regularFee = pfc.mul(fixedOracleFeePerSecond).mul(timeDiff).div(FP_SCALING_FACTOR);
        latePenalty = pfc.mul(weeklyDelayFee.mul(timeDiff.div(SECONDS_PER_WEEK)));

        return (regularFee, latePenalty);
    }

    function computeFinalFee(address currency) 
        external 
        view 
        returns (FixedPoint.Unsigned memory finalFee) 
    {
        finalFee = finalFees[currency];
    }
    
    /*
     * @notice Do not call this function externally.
     * @dev Only called from the constructor, and only extracted to a separate method to make the coverage tool work.
     * Will revert if called again.
     */
    function initializeRolesOnce() public {
        require(!rolesInitialized, "Only the constructor should call this method");
        rolesInitialized = true;
        _createExclusiveRole(uint(Roles.Governance), uint(Roles.Governance), msg.sender);
    }

    event SetFixedOracleFeePerSecond(FixedPoint.Unsigned newOracleFee);

}

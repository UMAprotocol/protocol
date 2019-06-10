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


/** 
 * @title An implementation of StoreInterface that can accept Oracle fees in ETH or any arbitrary ERC20 token.
 */
contract Store is StoreInterface, MultiRole, Withdrawable {

    using SafeMath for uint;
    using FixedPoint for FixedPoint.Unsigned;
    using FixedPoint for uint;

    enum Roles {
        Governance
    }

    FixedPoint.Unsigned private fixedOracleFeePerSecond; // Percentage of 1 E.g., .1 is 10% Oracle fee.

    FixedPoint.Unsigned private weeklyDelayFee; // Percentage of 1 E.g., .1 is 10% weekly delay fee.
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

    function computeRegularFee(uint startTime, uint endTime, FixedPoint.Unsigned calldata pfc) 
        external 
        view 
        returns (FixedPoint.Unsigned memory regularFee, FixedPoint.Unsigned memory latePenalty) 
    {
        uint timeDiff = endTime.sub(startTime);

        // Multiply by the unscaled `timeDiff` first, to get more accurate results.
        regularFee = pfc.mul(timeDiff).mul(fixedOracleFeePerSecond);
        // `weeklyDelayFee` is already scaled up.
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

    /**
     * @dev Sets a new oracle fee per second
     */ 
    function setFixedOracleFeePerSecond(FixedPoint.Unsigned memory newOracleFee) 
        public 
        onlyRoleHolder(uint(Roles.Governance)) 
    {
        // Oracle fees at or over 100% don't make sense.
        require(newOracleFee.isLessThan(1));
        fixedOracleFeePerSecond = newOracleFee;
        emit NewFixedOracleFeePerSecond(newOracleFee);
    }

    /**
     * @dev Sets a new weekly delay fee
     */ 
    function setWeeklyDelayFee(FixedPoint.Unsigned memory newWeeklyDelayFee) 
        public 
        onlyRoleHolder(uint(Roles.Governance)) 
    {
        weeklyDelayFee = newWeeklyDelayFee;
    }

    /**
     * @dev Sets a new final fee for a particular currency
     */ 
    function setFinalFee(address currency, FixedPoint.Unsigned memory finalFee) 
        public 
        onlyRoleHolder(uint(Roles.Governance))
    {
        finalFees[currency] = finalFee;
    }
    
    /**
     * @notice Do not call this function externally.
     * @dev Only called from the constructor, and only extracted to a separate method to make the coverage tool work.
     * Will revert if called again.
     */
    function initializeRolesOnce() public {
        require(!rolesInitialized, "Only the constructor should call this method");
        rolesInitialized = true;
        _createExclusiveRole(uint(Roles.Governance), uint(Roles.Governance), msg.sender);
    }

    event NewFixedOracleFeePerSecond(FixedPoint.Unsigned newOracleFee);

}

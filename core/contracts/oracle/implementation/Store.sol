pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "../../common/implementation/FixedPoint.sol";
import "../../common/implementation/MultiRole.sol";
import "../../common/implementation/Withdrawable.sol";
import "../interfaces/StoreInterface.sol";


/**
 * @title An implementation of StoreInterface that can accept Oracle fees in ETH or any arbitrary ERC20 token.
 */
contract Store is StoreInterface, MultiRole, Withdrawable {
    using SafeMath for uint;
    using FixedPoint for FixedPoint.Unsigned;
    using FixedPoint for uint;

    enum Roles { Owner, Withdrawer }

    FixedPoint.Unsigned public fixedOracleFeePerSecond; // Percentage of 1 E.g., .1 is 10% Oracle fee.

    FixedPoint.Unsigned public weeklyDelayFee; // Percentage of 1 E.g., .1 is 10% weekly delay fee.
    mapping(address => FixedPoint.Unsigned) public finalFees;
    uint public constant SECONDS_PER_WEEK = 604800;

    event NewFixedOracleFeePerSecond(FixedPoint.Unsigned newOracleFee);

    constructor() public {
        _createExclusiveRole(uint(Roles.Owner), uint(Roles.Owner), msg.sender);
        createWithdrawRole(uint(Roles.Withdrawer), uint(Roles.Owner), msg.sender);
    }

    // TODO(#969) Remove once prettier-plugin-solidity can handle the "override" keyword
    // prettier-ignore
    function payOracleFees() external override payable {
        require(msg.value > 0);
    }

    // TODO(#969) Remove once prettier-plugin-solidity can handle the "override" keyword
    // prettier-ignore
    function payOracleFeesErc20(address erc20Address) external override {
        IERC20 erc20 = IERC20(erc20Address);
        uint authorizedAmount = erc20.allowance(msg.sender, address(this));
        require(authorizedAmount > 0);
        require(erc20.transferFrom(msg.sender, address(this), authorizedAmount));
    }

    // TODO(#969) Remove once prettier-plugin-solidity can handle the "override" keyword
    // prettier-ignore
    function computeRegularFee(uint startTime, uint endTime, FixedPoint.Unsigned calldata pfc)
        external
        override
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

    // TODO(#969) Remove once prettier-plugin-solidity can handle the "override" keyword
    // prettier-ignore
    function computeFinalFee(address currency) external override view returns (FixedPoint.Unsigned memory finalFee) {
        finalFee = finalFees[currency];
    }

    /**
     * @dev Sets a new oracle fee per second
     */

    function setFixedOracleFeePerSecond(FixedPoint.Unsigned memory newOracleFee)
        public
        onlyRoleHolder(uint(Roles.Owner))
    {
        // Oracle fees at or over 100% don't make sense.
        require(newOracleFee.isLessThan(1));
        fixedOracleFeePerSecond = newOracleFee;
        emit NewFixedOracleFeePerSecond(newOracleFee);
    }

    /**
     * @dev Sets a new weekly delay fee
     */

    function setWeeklyDelayFee(FixedPoint.Unsigned memory newWeeklyDelayFee) public onlyRoleHolder(uint(Roles.Owner)) {
        weeklyDelayFee = newWeeklyDelayFee;
    }

    /**
     * @dev Sets a new final fee for a particular currency
     */

    function setFinalFee(address currency, FixedPoint.Unsigned memory finalFee)
        public
        onlyRoleHolder(uint(Roles.Owner))
    {
        finalFees[currency] = finalFee;
    }
}

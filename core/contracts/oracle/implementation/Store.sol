pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "../../common/implementation/FixedPoint.sol";
import "../../common/implementation/MultiRole.sol";
import "../../common/implementation/Withdrawable.sol";
import "../interfaces/StoreInterface.sol";


/**
 * @title An implementation of Store that can accept Oracle fees in ETH or any arbitrary ERC20 token.
 */
contract Store is StoreInterface, Withdrawable {
    using SafeMath for uint;
    using FixedPoint for FixedPoint.Unsigned;
    using FixedPoint for uint;
    using SafeERC20 for IERC20;

    /****************************************
     *    INTERNAL VARIABLES AND STORAGE    *
     ****************************************/

    enum Roles { Owner, Withdrawer }

    FixedPoint.Unsigned public fixedOracleFeePerSecondPerPfc; // Percentage of 1 E.g., .1 is 10% Oracle fee.
    FixedPoint.Unsigned public weeklyDelayFeePerSecondPerPfc; // Percentage of 1 E.g., .1 is 10% weekly delay fee.

    mapping(address => FixedPoint.Unsigned) public finalFees;
    uint256 public constant SECONDS_PER_WEEK = 604800;

    /****************************************
     *                EVENTS                *
     ****************************************/

    event NewFixedOracleFeePerSecondPerPfc(FixedPoint.Unsigned newOracleFee);
    event NewWeeklyDelayFeePerSecondPerPfc(FixedPoint.Unsigned newWeeklyDelayFeePerSecondPerPfc);
    event NewFinalFee(FixedPoint.Unsigned newFinalFee);

    /**
     * @notice Construct the Store contract.
     */
    constructor() public {
        _createExclusiveRole(uint(Roles.Owner), uint(Roles.Owner), msg.sender);
        createWithdrawRole(uint(Roles.Withdrawer), uint(Roles.Owner), msg.sender);
    }

    /****************************************
     *  ORACLE FEE CALCULATION AND PAYMENT  *
     ****************************************/

    /**
     * @notice Pays Oracle fees in ETH to the store.
     * @dev To be used by contracts whose margin currency is ETH.
     */
    // TODO(#969) Remove once prettier-plugin-solidity can handle the "override" keyword
    // prettier-ignore
    function payOracleFees() external override payable {
        require(msg.value > 0);
    }

    /**
     * @notice Pays oracle fees in the margin currency, erc20Address, to the store.
     * @dev To be used if the margin currency is an ERC20 token rather than ETH.
     * All approved tokens are transferred.
     * @param erc20Address address of the ERC20 token used to pay the fee.
     */
    // TODO(#969) Remove once prettier-plugin-solidity can handle the "override" keyword
    // prettier-ignore
    function payOracleFeesErc20(address erc20Address) external override {
        IERC20 erc20 = IERC20(erc20Address);
        uint256 authorizedAmount = erc20.allowance(msg.sender, address(this));
        require(authorizedAmount > 0);
        erc20.safeTransferFrom(msg.sender, address(this), authorizedAmount);
    }

    /**
     * @notice Computes the regular oracle fees that a contract should pay for a period.
     * @param startTime defines the beginning time from which the fee is paid.
     * @param endTime end time until which the fee is paid.
     * @param pfc "profit from corruption", or the maximum amount of margin currency that a
     * token sponsor could extract from the contract through corrupting the price feed in their favor.
     * @return regularFee amount owed for the duration from start to end time for the given pfc.
     * @return latePenalty penalty percentage, if any, for paying the fee after the deadline.
     */
    // TODO(#969) Remove once prettier-plugin-solidity can handle the "override" keyword
    // prettier-ignore
    function computeRegularFee(uint256 startTime, uint256 endTime, FixedPoint.Unsigned calldata pfc)
        external
        override
        view
        returns (FixedPoint.Unsigned memory regularFee, FixedPoint.Unsigned memory latePenalty)
    {
        uint256 timeDiff = endTime.sub(startTime);

        // Multiply by the unscaled `timeDiff` first, to get more accurate results.
        regularFee = pfc.mul(timeDiff).mul(fixedOracleFeePerSecondPerPfc);
        // `weeklyDelayFeePerSecondPerPfc` is already scaled up.
        latePenalty = pfc.mul(weeklyDelayFeePerSecondPerPfc.mul(timeDiff.div(SECONDS_PER_WEEK)));

        return (regularFee, latePenalty);
    }

    /**
     * @notice Computes the final oracle fees that a contract should pay at settlement.
     * @param currency token used to pay the final fee.
     * @return finalFee amount due denominated in units of `currency`.
     */
    // TODO(#969) Remove once prettier-plugin-solidity can handle the "override" keyword
    // prettier-ignore
    function computeFinalFee(address currency) external override view returns (FixedPoint.Unsigned memory finalFee) {
        finalFee = finalFees[currency];
    }

    /****************************************
     *   ADMIN STATE MODIFYING FUNCTIONS    *
     ****************************************/

    /**
     * @notice Sets a new oracle fee per second.
     * @param newOracleFeePerSecondPerPfc new fee per second charged to use the oracle.
     */
    function setFixedOracleFeePerSecondPerPfc(FixedPoint.Unsigned memory newOracleFeePerSecondPerPfc)
        public
        onlyRoleHolder(uint(Roles.Owner))
    {
        // Oracle fees at or over 100% don't make sense.
        require(newOracleFeePerSecondPerPfc.isLessThan(1));
        fixedOracleFeePerSecondPerPfc = newOracleFeePerSecondPerPfc;
        emit NewFixedOracleFeePerSecondPerPfc(newOracleFeePerSecondPerPfc);
    }

    /**
     * @notice Sets a new weekly delay fee.
     * @param newWeeklyDelayFeePerSecondPerPfc fee escalation per week of late fee payment.
     */
    function setWeeklyDelayFeePerSecondPerPfc(FixedPoint.Unsigned memory newWeeklyDelayFeePerSecondPerPfc)
        public
        onlyRoleHolder(uint(Roles.Owner))
    {
        require(newWeeklyDelayFeePerSecondPerPfc.isLessThan(1), "weekly delay fee must be < 100%");
        weeklyDelayFeePerSecondPerPfc = newWeeklyDelayFeePerSecondPerPfc;
        emit NewWeeklyDelayFeePerSecondPerPfc(newWeeklyDelayFeePerSecondPerPfc);
    }

    /**
     * @notice Sets a new final fee for a particular currency.
     * @param currency defines the token currency used to pay the final fee.
     * @param newFinalFee final fee amount.
     */
    function setFinalFee(address currency, FixedPoint.Unsigned memory newFinalFee)
        public
        onlyRoleHolder(uint(Roles.Owner))
    {
        finalFees[currency] = newFinalFee;
        emit NewFinalFee(newFinalFee);
    }
}

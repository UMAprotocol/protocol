pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "../../common/implementation/FixedPoint.sol";
import "../../common/implementation/MultiRole.sol";
import "../../common/implementation/Withdrawable.sol";
import "../../common/implementation/Testable.sol";
import "../interfaces/StoreInterface.sol";


/**
 * @title An implementation of Store that can accept Oracle fees in ETH or any arbitrary ERC20 token.
 */
contract Store is StoreInterface, Withdrawable, Testable {
    using SafeMath for uint;
    using FixedPoint for FixedPoint.Unsigned;
    using FixedPoint for uint;
    using SafeERC20 for IERC20;

    /****************************************
     *    INTERNAL VARIABLES AND STORAGE    *
     ****************************************/

    enum Roles { Owner, Withdrawer }

    FixedPoint.Unsigned public fixedOracleFeePerSecond; // Percentage of 1 E.g., .1 is 10% Oracle fee.
    FixedPoint.Unsigned public weeklyDelayFee; // Percentage of 1 E.g., .1 is 10% weekly delay fee.

    mapping(address => FixedPoint.Unsigned) public finalFees;
    uint256 public constant SECONDS_PER_WEEK = 604800;

    /****************************************
     *                EVENTS                *
     ****************************************/

    event NewFixedOracleFeePerSecond(FixedPoint.Unsigned newOracleFee);
    event NewWeeklyDelayFee(FixedPoint.Unsigned newWeeklyDelayFee);
    event NewFinalFee(FixedPoint.Unsigned newFinalFee);

    /**
     * @notice Construct the Store contract.
     */
    constructor(address _timerAddress) public Testable(_timerAddress) {
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
        returns (FixedPoint.Unsigned memory, FixedPoint.Unsigned memory)
    {
        uint256 timeDiff = endTime.sub(startTime);

        // Multiply by the unscaled `timeDiff` first, to get more accurate results.
        FixedPoint.Unsigned regularFee = pfc.mul(timeDiff).mul(fixedOracleFeePerSecond);

        // Compute how long ago the start time was to compute the delay penalty.
        uint paymentDelay = getCurrentTime().sub(startTime);

        // Compute the additional percentage (per second) that will be charged because of the penalty.
        // Note: if less than a week has gone by since the startTime, paymentDelay / SECONDS_PER_WEEK will truncate to
        // 0, causing no penalty to be charged.
        FixedPoint.Unsigned memory penaltyPercentagePerSecond = weeklyDelayFee.mul(paymentDelay.div(SECONDS_PER_WEEK));

        // Apply the penaltyPercentagePerSecond to the payment period.
        FixedPoint.Unsigned latePenalty = pfc.mul(timeDiff).mul(penaltyPercentagePerSecond);

        return (regularFee, latePenalty);
    }

    /**
     * @notice Computes the final oracle fees that a contract should pay at settlement.
     * @param currency token used to pay the final fee.
     * @return finalFee amount due denominated in units of `currency`.
     */
    // TODO(#969) Remove once prettier-plugin-solidity can handle the "override" keyword
    // prettier-ignore
    function computeFinalFee(address currency) external override view returns (FixedPoint.Unsigned memory) {
        return finalFees[currency];
    }

    /****************************************
     *   ADMIN STATE MODIFYING FUNCTIONS    *
     ****************************************/

    /**
     * @notice Sets a new oracle fee per second.
     * @param newOracleFee new fee per second charged to use the oracle.
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
     * @notice Sets a new weekly delay fee.
     * @param newWeeklyDelayFee fee escalation per week of late fee payment.
     */
    function setWeeklyDelayFee(FixedPoint.Unsigned memory newWeeklyDelayFee) public onlyRoleHolder(uint(Roles.Owner)) {
        require(newWeeklyDelayFee.isLessThan(1), "weekly delay fee must be < 100%");
        weeklyDelayFee = newWeeklyDelayFee;
        emit NewWeeklyDelayFee(newWeeklyDelayFee);
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

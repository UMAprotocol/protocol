pragma solidity ^0.5.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "../../common/implementation/FixedPoint.sol";
import "../../common/implementation/MultiRole.sol";
import "../../common/implementation/Withdrawable.sol";
import "../interfaces/StoreInterface.sol";

/**
 * @title An implementation of Store that can accept Oracle fees in ETH or any arbitrary ERC20 token.
 */
contract Store is StoreInterface, MultiRole, Withdrawable {
    using SafeMath for uint;
    using FixedPoint for FixedPoint.Unsigned;
    using FixedPoint for uint;

    /****************************************
     *    INTERNAL VARIABLES AND STORAGE    *
     ****************************************/

    enum Roles { Owner, Withdrawer }

    FixedPoint.Unsigned public fixedOracleFeePerSecond; // Percentage of 1 E.g., .1 is 10% Oracle fee.
    FixedPoint.Unsigned public weeklyDelayFee; // Percentage of 1 E.g., .1 is 10% weekly delay fee.

    mapping(address => FixedPoint.Unsigned) public finalFees;
    uint public constant SECONDS_PER_WEEK = 604800;

    /****************************************
     *                EVENTS                *
     ****************************************/

    event NewFixedOracleFeePerSecond(FixedPoint.Unsigned newOracleFee);

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
    function payOracleFees() external payable {
        require(msg.value > 0);
    }

    /**
     * @notice Pays oracle fees in the margin currency, erc20Address, to the store.
     * @dev To be used if the margin currency is an ERC20 token rather than ETH.
     * All approved tokens are transferred.
     * @param erc20Address address of the ERC20 token used to pay the fee.
     */
    function payOracleFeesErc20(address erc20Address) external {
        IERC20 erc20 = IERC20(erc20Address);
        uint authorizedAmount = erc20.allowance(msg.sender, address(this));
        require(authorizedAmount > 0);
        require(erc20.transferFrom(msg.sender, address(this), authorizedAmount));
    }

    /**
     * @notice Computes the regular oracle fees that a contract should pay for a period.
     * @param startTime defines the beginning time from which the fee is paid.
     * @param endTime end time until which the fee is paid.
     * @param pfc` "profit from corruption", or the maximum amount of margin currency that a
     * token sponsor could extract from the contract through corrupting the price feed in their favor.
     * @return regularFee amount owed for the duration from start to end time for the given pfc.
     * @return latePenalty, if any, for paying the fee after the deadline.
     */
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

    /**
     * @notice Computes the final oracle fees that a contract should pay at settlement.
     * @param currency token used to pay the final fee.
     * @return finalFee amount due.
     */
    function computeFinalFee(address currency) external view returns (FixedPoint.Unsigned memory finalFee) {
        finalFee = finalFees[currency];
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
     * @notice Sets a new weekly delay fee
     * @param newWeeklyDelayFee fee escalation per week of late fee payment.
     */
    function setWeeklyDelayFee(FixedPoint.Unsigned memory newWeeklyDelayFee) public onlyRoleHolder(uint(Roles.Owner)) {
        weeklyDelayFee = newWeeklyDelayFee;
    }

    /**
     * @notice Sets a new final fee for a particular currency
     * @param currency defines the token currency used to pay the final fee.
     * @param finalFee final fee amount.
     */
    function setFinalFee(address currency, FixedPoint.Unsigned memory finalFee)
        public
        onlyRoleHolder(uint(Roles.Owner))
    {
        finalFees[currency] = finalFee;
    }
}

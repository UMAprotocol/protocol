// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../../../contracts/common/implementation/FixedPoint.sol";
import "../../../contracts/data-verification-mechanism/interfaces/StoreInterface.sol";

/**
 * @title An implementation of Store that can accept Oracle fees in ETH or any arbitrary ERC20 token.
 */
contract Store is StoreInterface {
    using SafeMath for uint256;
    using FixedPoint for FixedPoint.Unsigned;
    using FixedPoint for uint256;

    /****************************************
     *    INTERNAL VARIABLES AND STORAGE    *
     ****************************************/
    mapping(address => FixedPoint.Unsigned) public finalFees;

    /****************************************
     *                EVENTS                *
     ****************************************/

    /**
     * @notice Construct the Store contract.
     */
    constructor(){}

    /****************************************
     *  ORACLE FEE CALCULATION AND PAYMENT  *
     ****************************************/

    /**
     * @notice Pays Oracle fees in ETH to the store.
     * @dev To be used by contracts whose margin currency is ETH.
     */
    function payOracleFees() external payable override {
        require(msg.value > 0, "Value sent can't be zero");
    }

    /**
     * @notice Pays oracle fees in the margin currency, erc20Address, to the store.
     * @dev To be used if the margin currency is an ERC20 token rather than ETH.
     * @param erc20Address address of the ERC20 token used to pay the fee.
     * @param amount number of tokens to transfer. An approval for at least this amount must exist.
     */
    function payOracleFeesErc20(address erc20Address, FixedPoint.Unsigned calldata amount) external override {}

    function computeRegularFee(
        uint256,
        uint256,
        FixedPoint.Unsigned calldata pfc
    ) external view override returns (FixedPoint.Unsigned memory regularFee, FixedPoint.Unsigned memory latePenalty) {
        // Multiply by the unscaled `timeDiff` first, to get more accurate results.
        regularFee = pfc;

        // Apply the penaltyPercentagePerSecond to the payment period.
        latePenalty = pfc;
    }

    /**
     * @notice Computes the final oracle fees that a contract should pay at settlement.
     * @param currency token used to pay the final fee.
     * @return finalFee amount due denominated in units of `currency`.
     */
    function computeFinalFee(address currency) external view override returns (FixedPoint.Unsigned memory) {
        return finalFees[currency];
    }

    /****************************************
     *   ADMIN STATE MODIFYING FUNCTIONS    *
     ****************************************/

    /**
     * @notice Sets a new oracle fee per second.
     * @param newFixedOracleFeePerSecondPerPfc new fee per second charged to use the oracle.
     */
    function setFixedOracleFeePerSecondPerPfc(FixedPoint.Unsigned memory newFixedOracleFeePerSecondPerPfc)
        public {}

    /**
     * @notice Sets a new weekly delay fee.
     * @param newWeeklyDelayFeePerSecondPerPfc fee escalation per week of late fee payment.
     */
    function setWeeklyDelayFeePerSecondPerPfc(FixedPoint.Unsigned memory newWeeklyDelayFeePerSecondPerPfc)
        public{}

    /**
     * @notice Sets a new final fee for a particular currency.
     * @param currency defines the token currency used to pay the final fee.
     * @param newFinalFee final fee amount.
     */
    function setFinalFee(address currency, FixedPoint.Unsigned memory newFinalFee)
        public
    {
        finalFees[currency] = newFinalFee;
    }
}

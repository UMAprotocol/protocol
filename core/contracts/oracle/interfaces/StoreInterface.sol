pragma solidity ^0.5.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../common/implementation/FixedPoint.sol";

/**
 * @title Interface that allows derivative contracts to pay oracle fees for their use of the system.
 */
interface StoreInterface {
    /**
     * @notice Pays Oracle fees in ETH to the store.
     * @dev To be used by contracts whose margin currency is ETH.
     */
    function payOracleFees() external payable;

    /**
     * @notice Pays oracle fees in the margin currency, erc20Address, to the store.
     * @dev To be used if the margin currency is an ERC20 token rather than ETH.
     * All approved tokens are transferred.
     * @param erc20Address is the address of the ERC20 token used to pay the fee.
     */
    function payOracleFeesErc20(address erc20Address) external;

    /**
     * @notice Computes the regular oracle fees that a contract should pay for a period.
     * @param startTime defines the beginning time from which the fee is paid.
     * @param endTime defines the end time until which the fee is paid.
     * @param pfc` is the "profit from corruption", or the maximum amount of margin currency that a
     * token sponsor could extract from the contract through corrupting the price feed in their favor.
     * @return regularFee amount owed for the duration from start to end time for the given pfc.
     * @return latePenalty, if any, for paying the fee after the deadline.
     */
    function computeRegularFee(uint startTime, uint endTime, FixedPoint.Unsigned calldata pfc)
        external
        view
        returns (FixedPoint.Unsigned memory regularFee, FixedPoint.Unsigned memory latePenalty);

    /**
     * @notice Computes the final oracle fees that a contract should pay at settlement.
     * @param currency defines the token used to pay the final fee.
     * @return finalFee amount due.
     */
    function computeFinalFee(address currency) external view returns (FixedPoint.Unsigned memory finalFee);
}

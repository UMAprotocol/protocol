pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "../../../common/implementation/FixedPoint.sol";


/**
 * @title Funding Rate Store interface.
 * @dev Interface used by financial contracts to interact with a storage contract which sets and gets funding rates.
 */
interface FundingRateStoreInterface {
    /**
     * @notice Pays funding rate fees in the margin currency of the calling contract to the store.
     * @dev Intended to be called by a perpetual contract. This assumes that the caller has approved this contract
     * to transfer `amount` of its collateral currency.
     * @param amount number of tokens to transfer. An approval for at least this amount must exist.
     */
    function payFundingRateFees(FixedPoint.Unsigned calldata amount) external;

    /**
     * @notice Gets the latest funding rate for a perpetual contract.
     * @dev This method should never revert.
     * @param perpetual perpetual contract whose funding rate identifier that the calling contracts wants to get
     * a funding rate for.
     * @return FixedPoint.Signed representing the funding rate for the given contract. 0.01 would represent a funding
     * rate of 1% per second. -0.01 would represent a negative funding rate of -1% per second.
     */
    function getFundingRateForContract(address perpetual) external view returns (FixedPoint.Signed memory);

    /**
     * @notice Computes the funding rate fees that a contract should pay for a period.
     * @param startTime defines the beginning time from which the fee is paid.
     * @param endTime end time until which the fee is paid.
     * @param pfc "profit from corruption", or the maximum amount of margin currency that a
     * token sponsor could extract from the contract through corrupting the price feed in their favor.
     * @return fundingRateFee amount owed for the duration from start to end time for the given pfc.
     * @return latePenalty for paying the fee after the deadline.
     */
    function computeFundingRateFee(
        uint256 startTime,
        uint256 endTime,
        FixedPoint.Unsigned calldata pfc
    ) external view returns (FixedPoint.Unsigned memory fundingRateFee, FixedPoint.Unsigned memory latePenalty);
}

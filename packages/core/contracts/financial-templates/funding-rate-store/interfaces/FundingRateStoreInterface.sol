// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "../../../common/implementation/FixedPoint.sol";

/**
 * @title Funding Rate Store interface.
 * @dev Interface used by financial contracts to interact with a storage contract which sets and gets funding rates.
 */
interface FundingRateStoreInterface {
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
     * @notice Set the reward rate for a specific `perpetual` contract.
     * @dev Callable only by the Perpetual contract.
     */
    function setRewardRate(address perpetual, FixedPoint.Unsigned memory rewardRate) external;
}

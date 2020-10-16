pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "../../../common/implementation/FixedPoint.sol";


/**
 * @title Funding Rate Store interface.
 * @dev Interface used by financial contracts to interact with a storage contract which sets and gets funding rates.
 */
interface FundingRateStoreInterface {
    /**
     * @notice Gets the latest funding rate for `identifier`.
     * @dev This method should never revert.
     * @param identifier uniquely identifier that the calling contracts wants to get a funding rate for.
     * @return FixedPoint representing the funding rate for the given identifier. Rates > 1 represent "positive"
     * funding rates, and < 1 represent "negative" funding rates.
     */
    function getFundingRateForIdentifier(bytes32 identifier) external view returns (FixedPoint.Unsigned memory);
}

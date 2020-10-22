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
     * @return FixedPoint.Signed representing the funding rate for the given identifier. -1e16 implies a
     * funding rate of -1%, whereas 1e16 implies a funding rate of 1%.
     */
    function getFundingRateForIdentifier(bytes32 identifier) external view returns (FixedPoint.Signed memory);
}

pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "../../../common/implementation/FixedPoint.sol";


interface FundingRateStoreInterface {
    function getFundingRateForIdentifier(bytes32 identifier) external view returns (FixedPoint.Unsigned memory);
}

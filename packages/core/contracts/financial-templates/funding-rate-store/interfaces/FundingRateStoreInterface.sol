pragma solidity ^0.6.0;


interface FundingRateStoreInterface {
    function getLatestFundingRateForIdentifier(bytes32 identifier) external view returns (int256);
}

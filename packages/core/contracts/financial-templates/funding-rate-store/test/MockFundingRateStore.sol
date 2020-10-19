pragma solidity ^0.6.0;

pragma experimental ABIEncoderV2;

import "../interfaces/FundingRateStoreInterface.sol";
import "../../../common/implementation/Testable.sol";
import "../../../common/implementation/FixedPoint.sol";
import "../../../oracle/interfaces/FinderInterface.sol";
import "../../../oracle/implementation/Constants.sol";
import "../../../oracle/interfaces/IdentifierWhitelistInterface.sol";


// A mock funding rate store used for testing.
contract MockFundingRateStore is FundingRateStoreInterface, Testable {
    using FixedPoint for FixedPoint.Unsigned;

    struct FundingRate {
        // Represented in wei as a % of token amount charged per second.
        // e.g. fundingRate = 1.01 means 1% of token amount charged per second.
        FixedPoint.Unsigned fundingRate;
        // int256 fundingRate;
        uint256 timestamp; // Time the verified funding rate became available.
    }

    mapping(bytes32 => FundingRate[]) private fundingRates;

    constructor(address _timerAddress) public Testable(_timerAddress) {}

    // Sets the funding rate for a given identifier.
    function setFundingRate(
        bytes32 identifier,
        uint256 time,
        FixedPoint.Unsigned memory fundingRate
    ) external {
        fundingRates[identifier].push(FundingRate(fundingRate, time));
    }

    function getFundingRateForIdentifier(bytes32 identifier)
        external
        override
        view
        returns (FixedPoint.Unsigned memory)
    {
        if (fundingRates[identifier].length == 0) {
            return FixedPoint.fromUnscaledUint(1);
        }
        return fundingRates[identifier][fundingRates[identifier].length - 1].fundingRate;
    }
}

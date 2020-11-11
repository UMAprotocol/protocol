// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.6.0;

pragma experimental ABIEncoderV2;

import "../interfaces/FundingRateStoreInterface.sol";
import "../../../common/implementation/Testable.sol";
import "../../../common/implementation/FixedPoint.sol";
import "../../../oracle/interfaces/FinderInterface.sol";
import "../../../oracle/implementation/Constants.sol";
import "../../../oracle/interfaces/IdentifierWhitelistInterface.sol";
import "../../perpetual-multiparty/PerpetualInterface.sol";

// A mock funding rate store used for testing.
contract MockFundingRateStore is FundingRateStoreInterface, Testable {
    using FixedPoint for FixedPoint.Unsigned;

    struct FundingRate {
        // Represented in wei as a % of token amount charged per second.
        // e.g. fundingRate = 0.01 means 1% of token amount charged per second.
        FixedPoint.Signed fundingRate;
        uint256 timestamp; // Time the verified funding rate became available.
    }

    mapping(address => FundingRate[]) private fundingRates;

    constructor(address _timerAddress) public Testable(_timerAddress) {}

    // Sets the funding rate for a given identifier.
    function setFundingRate(
        address perpetual,
        uint256 time,
        FixedPoint.Signed memory fundingRate
    ) external {
        fundingRates[perpetual].push(FundingRate(fundingRate, time));
    }

    function getFundingRateForContract(address perpetual) external view override returns (FixedPoint.Signed memory) {
        if (fundingRates[perpetual].length == 0) {
            return FixedPoint.fromUnscaledInt(0);
        }
        return fundingRates[perpetual][fundingRates[perpetual].length - 1].fundingRate;
    }

    function chargeFundingRateFees(address perpetual, FixedPoint.Unsigned calldata amount) external {
        PerpetualInterface(perpetual).withdrawFundingRateFees(amount);
    }
}

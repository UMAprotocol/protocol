pragma solidity ^0.6.0;

pragma experimental ABIEncoderV2;

import "../interfaces/FundingRateStoreInterface.sol";
import "../../../common/implementation/Testable.sol";
import "../../../oracle/interfaces/FinderInterface.sol";
import "../../../oracle/implementation/Constants.sol";
import "../../../oracle/interfaces/IdentifierWhitelistInterface.sol";


// A mock funding rate store used for testing.
contract MockFundingRateStore is FundingRateStoreInterface, Testable {
    struct FundingRate {
        int256 fundingRate;
        uint256 timestamp; // Time the verified funding rate became available.
    }

    FinderInterface private fpFinder;
    FinderInterface private finder;

    mapping(bytes32 => FundingRate[]) private fundingRates;

    constructor(
        address _fpFinderAddress,
        address _finderAddress,
        address _timerAddress
    ) public Testable(_timerAddress) {
        fpFinder = FinderInterface(_fpFinderAddress);
        finder = FinderInterface(_finderAddress);
    }

    // Pushes the verified funding rate for a given identifier.
    function pushFundingRate(
        bytes32 identifier,
        uint256 time,
        int256 fundingRate
    ) external {
        require(_getIdentifierWhitelist().isIdentifierSupported(identifier), "Identifier not registered");
        fundingRates[identifier].push(FundingRate(fundingRate, time));
    }

    function getLatestFundingRateForIdentifier(bytes32 identifier) external override view returns (int256 fundingRate) {
        require(_getIdentifierWhitelist().isIdentifierSupported(identifier), "Identifier not registered");

        return fundingRates[identifier][fundingRates[identifier].length - 1].fundingRate;
    }

    function _getIdentifierWhitelist() private view returns (IdentifierWhitelistInterface supportedIdentifiers) {
        return IdentifierWhitelistInterface(finder.getImplementationAddress(OracleInterfaces.IdentifierWhitelist));
    }
}

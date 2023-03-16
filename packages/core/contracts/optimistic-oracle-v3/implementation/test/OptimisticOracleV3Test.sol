// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

import "../OptimisticOracleV3.sol";
import "../../../common/implementation/Testable.sol";

// Test contract used to manage the time for the contract in tests.
contract OptimisticOracleV3Test is OptimisticOracleV3, Testable {
    constructor(
        FinderInterface _finder,
        IERC20 _defaultCurrency,
        uint64 _defaultLiveness,
        address _timerAddress
    ) OptimisticOracleV3(_finder, _defaultCurrency, _defaultLiveness) Testable(_timerAddress) {}

    function getCurrentTime() public view override(OptimisticOracleV3, Testable) returns (uint256) {
        return uint256(Testable.getCurrentTime());
    }
}

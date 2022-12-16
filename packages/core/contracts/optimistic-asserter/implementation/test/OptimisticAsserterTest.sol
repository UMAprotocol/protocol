// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

import "../OptimisticAsserter.sol";
import "../../../common/implementation/Testable.sol";

// Test contract used to manage the time for the contract in tests.
contract OptimisticAsserterTest is OptimisticAsserter, Testable {
    constructor(
        FinderInterface _finder,
        IERC20 _defaultCurrency,
        uint64 _defaultLiveness,
        address _timerAddress
    ) OptimisticAsserter(_finder, _defaultCurrency, _defaultLiveness) Testable(_timerAddress) {}

    function getCurrentTime() public view override(OptimisticAsserter, Testable) returns (uint256) {
        return uint256(Testable.getCurrentTime());
    }
}

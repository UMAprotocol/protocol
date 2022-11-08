// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

import "../OptimisticAssertor.sol";
import "../../../common/implementation/Testable.sol";

// Test contract used to manage the time for the contract in tests.
contract OptimisticAssertorTest is OptimisticAssertor, Testable {
    constructor(
        FinderInterface _finder,
        IERC20 _defaultCurrency,
        uint256 _defaultBond,
        uint256 _defaultLiveness,
        address _timerAddress
    ) OptimisticAssertor(_finder, _defaultCurrency, _defaultBond, _defaultLiveness) Testable(_timerAddress) {}

    function getCurrentTime() public view override(OptimisticAssertor, Testable) returns (uint256) {
        return Testable.getCurrentTime();
    }
}

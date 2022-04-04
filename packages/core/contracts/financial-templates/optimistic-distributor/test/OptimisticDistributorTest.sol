// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../OptimisticDistributor.sol";
import "../../../common/implementation/Testable.sol";

// Test contract to add controllable timing to the OptimisticDistributor.
contract OptimisticDistributorTest is OptimisticDistributor, Testable {
    constructor(
        FinderInterface _finder,
        IERC20 _bondToken,
        address _timerAddress
    ) Testable(_timerAddress) OptimisticDistributor(_finder, _bondToken) {}

    function getCurrentTime() public view override(OptimisticDistributor, Testable) returns (uint256) {
        return Testable.getCurrentTime();
    }
}

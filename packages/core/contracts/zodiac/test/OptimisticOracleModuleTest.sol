// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../OptimisticOracleModule.sol";
import "../../common/implementation/Testable.sol";

// Test contract to add controllable timing to the OptimisticRewarder.
contract OptimisticOracleModuleTest is OptimisticOracleModule, Testable {
    constructor(
        address _finder,
        address _owner,
        address _collateral,
        uint256 _bond,
        string memory _rules,
        uint64 _liveness,
        address _timerAddress
    ) Testable(_timerAddress) OptimisticOracleModule(_finder, _owner, _collateral, _bond, _rules, _liveness) {}

    function getCurrentTime() public view override(OptimisticOracleModule, Testable) returns (uint256) {
        return Testable.getCurrentTime();
    }
}

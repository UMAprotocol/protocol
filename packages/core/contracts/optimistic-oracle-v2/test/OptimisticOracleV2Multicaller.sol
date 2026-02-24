// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../implementation/OptimisticOracleV2.sol";
import "../../common/implementation/MultiCaller.sol";

// Test contract that combines OptimisticOracleV2 with MultiCaller, mirroring ManagedOptimisticOracleV2.
contract OptimisticOracleV2Multicaller is OptimisticOracleV2, MultiCaller {
    constructor(
        uint256 _liveness,
        address _finderAddress,
        address _timerAddress
    ) OptimisticOracleV2(_liveness, _finderAddress, _timerAddress) {}
}

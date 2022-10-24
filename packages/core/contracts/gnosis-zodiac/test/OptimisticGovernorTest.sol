// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../implementation/OptimisticGovernor.sol";
import "../../common/implementation/Testable.sol";

// Test contract to add controllable timing to the OptimisticGovernor.
contract OptimisticGovernorTest is OptimisticGovernor, Testable {
    constructor(
        address _finder,
        address _owner,
        address _collateral,
        uint256 _bond,
        string memory _rules,
        bytes32 _identifier,
        uint64 _liveness,
        address _timerAddress
    ) Testable(_timerAddress) OptimisticGovernor(_finder, _owner, _collateral, _bond, _rules, _identifier, _liveness) {}

    function getCurrentTime() public view override(OptimisticGovernor, Testable) returns (uint256) {
        return Testable.getCurrentTime();
    }

    // When deployed as minimal proxy timer address is not initialized.
    function setTimer(address _timerAddress) public {
        timerAddress = _timerAddress;
    }
}

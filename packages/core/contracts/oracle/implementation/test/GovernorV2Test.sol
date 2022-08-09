// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../GovernorV2.sol";
import "../../../common/implementation/Testable.sol";

contract GovernorV2Test is GovernorV2, Testable {
    constructor(
        address _finderAddress,
        uint256 _startingId,
        address _timerAddress
    ) GovernorV2(_finderAddress, _startingId) Testable(_timerAddress) {}

    function getCurrentTime() public view override(GovernorV2, Testable) returns (uint256) {
        return Testable.getCurrentTime();
    }
}

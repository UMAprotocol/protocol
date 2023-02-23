// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

import "../EmergencyProposer.sol";
import "../../../common/implementation/Testable.sol";

contract EmergencyProposerTest is EmergencyProposer, Testable {
    constructor(
        IERC20 _token,
        uint256 _quorum,
        GovernorV2 _governor,
        address _executor,
        address _timerAddress,
        uint64 _minimumWaitTime
    ) EmergencyProposer(_token, _quorum, _governor, _executor, _minimumWaitTime) Testable(_timerAddress) {}

    function getCurrentTime() public view override(EmergencyProposer, Testable) returns (uint256) {
        return Testable.getCurrentTime();
    }
}

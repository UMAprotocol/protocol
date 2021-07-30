// Temp contract until we can use the canonical UMA testable once Optimism support solidity 0.8.
// No code was changed here. It is a direct copy paste from the UMA testable, simply with a modified solidity version.

// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity >=0.7.6;

import "./OVM_Timer.sol";

abstract contract OVM_Testable {
    address public timerAddress;

    constructor(address _timerAddress) {
        timerAddress = _timerAddress;
    }

    modifier onlyIfTest {
        require(timerAddress != address(0x0));
        _;
    }

    function setCurrentTime(uint256 time) external onlyIfTest {
        OVM_Timer(timerAddress).setCurrentTime(time);
    }

    function getCurrentTime() public view returns (uint256) {
        if (timerAddress != address(0x0)) {
            return OVM_Timer(timerAddress).getCurrentTime();
        } else {
            return block.timestamp; // solhint-disable-line not-rely-on-time
        }
    }
}

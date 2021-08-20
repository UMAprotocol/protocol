// Temp contract until we can use the canonical UMA testable once Optimism support solidity 0.8.

// SPDX-License-Identifier: AGPL-3.0-only

pragma solidity >=0.7.6;

contract OVM_Timer {
    uint256 private currentTime;

    constructor() {
        currentTime = block.timestamp; // solhint-disable-line not-rely-on-time
    }

    function setCurrentTime(uint256 time) external {
        currentTime = time;
    }

    function getCurrentTime() public view returns (uint256) {
        return currentTime;
    }
}

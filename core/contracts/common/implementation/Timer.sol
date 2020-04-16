pragma solidity ^0.6.0;


/**
 * @title Universal store of current contract time for testing environments.
 */
contract Timer {
    uint private currentTime;

    constructor() public {
        currentTime = now; // solhint-disable-line not-rely-on-time
    }

    /**
     * @notice Sets the current time.
     * @dev Will revert if not running in test mode.
     * @param _time timestamp to set current Tesable time to.
     */
    function setCurrentTime(uint _time) external {
        currentTime = _time;
    }

    /**
     * @notice Gets the current time. Will return the last time set in `setCurrentTime` if running in test mode.
     * Otherwise, it will return the block timestamp.
     * @return uint for the current Testable timestamp.
     */
    function getCurrentTime() public view returns (uint) {
        return currentTime;
    }
}

pragma solidity ^0.6.0;

import "./Timer.sol";


/**
 * @title Base class that provides time overrides, but only if being run in test mode.
 */
abstract contract Testable {
    // Is the contract being run on the test network. Note: this variable should be set on construction and never
    // modified.
    bool public isTest;

    Timer public timer;

    constructor(bool _isTest, address _timerAddress) internal {
        isTest = _isTest;
        timer = Timer(_timerAddress);
    }

    /**
     * @notice Reverts if not running in test mode.
     */
    modifier onlyIfTest {
        require(isTest);
        _;
    }

    /**
     * @notice Sets the current time.
     * @dev Will revert if not running in test mode.
     */
    function setCurrentTime(uint _time) external onlyIfTest {
        timer.setCurrentTime(_time);
    }

    /**
     * @notice Gets the current time. Will return the last time set in `setCurrentTime` if running in test mode.
     * Otherwise, it will return the block timestamp.
     */
    function getCurrentTime() public view returns (uint) {
        if (isTest) {
            return timer.getCurrentTime();
        } else {
            return now; // solhint-disable-line not-rely-on-time
        }
    }
}

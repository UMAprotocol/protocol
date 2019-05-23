/*
  Testable contract.

  Base class that provides time overrides, but only if being run in test mode.
*/

pragma solidity ^0.5.0;


contract Testable {
    // Is the contract being run on the test network. Note: this variable should be set on construction and never
    // modified.
    bool public isTest;

    uint private currentTime;

    constructor(bool _isTest) internal {
        isTest = _isTest;
        if (_isTest) {
            currentTime = now; // solhint-disable-line not-rely-on-time
        }
    }

    modifier onlyIfTest {
        require(isTest);
        _;
    }

    function setCurrentTime(uint _time) external onlyIfTest {
        currentTime = _time;
    }

    function getCurrentTime() public view returns (uint) {
        if (isTest) {
            return currentTime;
        } else {
            return now; // solhint-disable-line not-rely-on-time
        }
    }
}

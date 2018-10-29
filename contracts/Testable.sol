/*
  Testable contract.

  Base class that provides time overrides, but only if being run in test mode.
*/

pragma solidity ^0.4.24;

import "openzeppelin-solidity/contracts/ownership/Ownable.sol";


contract Testable is Ownable {

    // Is the contract being run on the test network. Note: this variable should be set on construction and never
    // modified.
    bool private isTest;

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

    function setCurrentTime(uint _time) external onlyOwner onlyIfTest {
        currentTime = _time;
    }

    function isTestMode() public constant returns (bool) {
        return isTest;
    }

    function getCurrentTime() public constant returns (uint) {
        if (isTest) {
            return currentTime;
        } else {
            return now; // solhint-disable-line not-rely-on-time
        }
    }
}

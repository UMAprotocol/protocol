pragma solidity ^0.6.0;

import "../implementation/Testable.sol";


// TestableTest is derived from the abstract contract Testable for testing purposes.
contract TestableTest is Testable {
    // solhint-disable-next-line no-empty-blocks
    constructor(bool _isTest, address _timerAddress) public Testable(_isTest, _timerAddress) {}

    function getTestableTimeAndBlockTime() external view returns (uint testableTime, uint blockTime) {
        // solhint-disable-next-line not-rely-on-time
        return (getCurrentTime(), now);
    }
}

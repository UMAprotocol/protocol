pragma solidity ^0.5.0;

import "../Testable.sol";


// TestableTest is derived from the abstract contract Testable for testing purposes.
contract TestableTest is Testable {
    // solhint-disable-next-line no-empty-blocks
    constructor(bool _isTest) public Testable(_isTest) {}

    function getTestableTimeAndBlockTime() external view returns (uint testableTime, uint blockTime) {
        // solhint-disable-next-line not-rely-on-time
        return (getCurrentTime(), now);
    }
}

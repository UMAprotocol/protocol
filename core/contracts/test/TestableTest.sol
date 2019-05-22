pragma solidity ^0.5.0;

import "../Testable.sol";

// TestableTest is derived from the abstract contract Testable for testing purposes.
contract TestableTest is Testable {
    constructor(bool _isTest) public Testable(_isTest) {}
}

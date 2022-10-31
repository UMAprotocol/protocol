// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "../../contracts/TestFoundryContract.sol";

import "forge-std/Test.sol";

contract ContractTest is Test {
    TestFoundryContract testContract = new TestFoundryContract();

    function setUp() public {}

    function testExample() public {
        assertTrue(true);
    }

    function testOwner() public {
        assertTrue(testContract.owner() == address(this));
    }
}

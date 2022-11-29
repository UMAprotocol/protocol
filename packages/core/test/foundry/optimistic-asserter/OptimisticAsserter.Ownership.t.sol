// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "./Common.sol";

contract OwnershipTest is Common {
    function setUp() public {
        _commonSetup();
    }

    function testOwnershipPermissions() public {
        assertEq(optimisticAsserter.owner(), TestAddress.owner);

        vm.expectRevert("Ownable: caller is not the owner");
        optimisticAsserter.transferOwnership(TestAddress.account1);

        vm.prank(TestAddress.owner); // Check that the owner can change the owner.
        optimisticAsserter.transferOwnership(TestAddress.account1);
        assertEq(optimisticAsserter.owner(), TestAddress.account1);
    }

    function testOwnershipFunctionality() public {
        vm.expectRevert("Ownable: caller is not the owner");
        optimisticAsserter.setAssertionDefaults(IERC20(TestAddress.random), 69);

        vm.prank(TestAddress.owner);
        optimisticAsserter.setAssertionDefaults(IERC20(TestAddress.random), 69);
        assertEq(address(optimisticAsserter.defaultCurrency()), TestAddress.random);
        assertEq(optimisticAsserter.defaultLiveness(), 69);
    }
}

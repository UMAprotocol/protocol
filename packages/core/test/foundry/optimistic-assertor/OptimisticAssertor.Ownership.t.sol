// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "./Common.sol";

contract OwnershipTest is Common {
    function setUp() public {
        _commonSetup();
    }

    function testOwnershipPermissions() public {
        assertEq(optimisticAssertor.owner(), TestAddress.owner);

        vm.expectRevert("Ownable: caller is not the owner");
        optimisticAssertor.transferOwnership(TestAddress.account1);

        vm.prank(TestAddress.owner); // Check that the owner can change the owner.
        optimisticAssertor.transferOwnership(TestAddress.account1);
        assertEq(optimisticAssertor.owner(), TestAddress.account1);
    }

    function testOwnershipFunctionality() public {
        vm.expectRevert("Ownable: caller is not the owner");
        optimisticAssertor.setAssertionDefaults(IERC20(TestAddress.random), 420, 69);

        vm.prank(TestAddress.owner);
        optimisticAssertor.setAssertionDefaults(IERC20(TestAddress.random), 420, 69);
        assertEq(address(optimisticAssertor.defaultCurrency()), TestAddress.random);
        assertEq(optimisticAssertor.defaultBond(), 420);
        assertEq(optimisticAssertor.defaultLiveness(), 69);
    }
}

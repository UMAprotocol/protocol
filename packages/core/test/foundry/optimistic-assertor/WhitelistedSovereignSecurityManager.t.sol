// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "forge-std/Test.sol";
import "../fixtures/common/TestAddress.sol";
import "../../../contracts/optimistic-assertor/implementation/sovereign-security-manager/WhitelistedSovereignSecurityManager.sol";
import "../../../contracts/optimistic-assertor/interfaces/OptimisticAssertorInterface.sol";

contract WhitelistedSovereignSecurityManagerTest is Test {
    WhitelistedSovereignSecurityManager ssm;
    address mockOptimisticAssertorAddress = address(0xff);
    address mockAssertingCallerAddress = address(0xffa);

    function setUp() public {
        ssm = new WhitelistedSovereignSecurityManager();
    }

    function test_AssertingCallerWhitelist() public {
        bytes32 assertionId = "test";

        // If the asserting caller is not whitelisted, then the assertion should not be allowed.
        _mockReadAssertionAssertingCaller(mockAssertingCallerAddress);
        vm.prank(mockOptimisticAssertorAddress);
        SovereignSecurityManagerInterface.AssertionPolicies memory policyNotWhitelisted =
            ssm.getAssertionPolicies(assertionId);
        assertEq(policyNotWhitelisted.allowAssertion, false);

        // If the asserting caller is whitelisted, then the assertion should be allowed.
        ssm.setAssertingCallerInWhitelist(mockAssertingCallerAddress, true);
        _mockReadAssertionAssertingCaller(mockAssertingCallerAddress);
        vm.prank(mockOptimisticAssertorAddress);
        SovereignSecurityManagerInterface.AssertionPolicies memory policyWhitelisted =
            ssm.getAssertionPolicies(assertionId);
        assertEq(policyWhitelisted.allowAssertion, true);
    }

    function test_RevertIf_NotOwner() public {
        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(TestAddress.account1);
        ssm.setAssertingCallerInWhitelist(TestAddress.account1, true);
    }

    function _mockReadAssertionAssertingCaller(address mockAssertingCaller) public {
        OptimisticAssertorInterface.Assertion memory assertion;
        assertion.assertingCaller = mockAssertingCaller;
        vm.mockCall(
            mockOptimisticAssertorAddress,
            abi.encodePacked(OptimisticAssertorInterface.readAssertion.selector),
            abi.encode(assertion)
        );
    }
}

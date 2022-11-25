// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "../Common.sol";
import "../../../../contracts/optimistic-asserter/implementation/sovereign-security/WhitelistCallerSovereignSecurity.sol";

contract WhitelistCallerSovereignSecurityTest is Common {
    WhitelistCallerSovereignSecurity sovereignSecurity;

    function setUp() public {
        sovereignSecurity = new WhitelistCallerSovereignSecurity();
    }

    function test_AssertingCallerWhitelist() public {
        bytes32 assertionId = "test";

        // If the asserting caller is not whitelisted, then the assertion should not be allowed.
        _mockReadAssertionAssertingCaller(mockAssertingCallerAddress, assertionId);
        vm.prank(mockOptimisticAsserterAddress);
        SovereignSecurityInterface.AssertionPolicies memory policyNotWhitelisted =
            sovereignSecurity.getAssertionPolicies(assertionId);
        assertFalse(policyNotWhitelisted.allowAssertion);

        // If the asserting caller is whitelisted, then the assertion should be allowed.
        sovereignSecurity.setAssertingCallerInWhitelist(mockAssertingCallerAddress, true);
        vm.prank(mockOptimisticAsserterAddress);
        SovereignSecurityInterface.AssertionPolicies memory policyWhitelisted =
            sovereignSecurity.getAssertionPolicies(assertionId);
        assertTrue(policyWhitelisted.allowAssertion);

        vm.clearMockedCalls();
    }

    function test_RevertIf_NotOwner() public {
        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(TestAddress.account1);
        sovereignSecurity.setAssertingCallerInWhitelist(TestAddress.account1, true);
    }

    function _mockReadAssertionAssertingCaller(address mockAssertingCaller, bytes32 assertionId) public {
        OptimisticAsserterInterface.Assertion memory assertion;
        assertion.ssSettings.assertingCaller = mockAssertingCaller;
        vm.mockCall(
            mockOptimisticAsserterAddress,
            abi.encodeWithSelector(OptimisticAsserterInterface.getAssertion.selector, assertionId),
            abi.encode(assertion)
        );
    }
}

// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "../Common.sol";
import "../../../../contracts/optimistic-asserter/implementation/sovereign-security/WhitelistAsserterSovereignSecurity.sol";

contract WhitelistAsserterSovereignSecurityTest is Common {
    WhitelistAsserterSovereignSecurity sovereignSecurity;

    bytes32 assertionId = "test";

    function setUp() public {
        sovereignSecurity = new WhitelistAsserterSovereignSecurity();
    }

    function test_RevertIf_NotOwner() public {
        vm.startPrank(TestAddress.account1);
        vm.expectRevert("Ownable: caller is not the owner");
        sovereignSecurity.setAsserterInWhitelist(TestAddress.account1, true);

        vm.expectRevert("Ownable: caller is not the owner");
        sovereignSecurity.setAssertingCaller(mockAssertingCallerAddress);
        vm.stopPrank();
    }

    function test_RevertIf_InvalidAssertingCaller() public {
        vm.expectRevert("Invalid asserting caller");
        sovereignSecurity.setAssertingCaller(address(0));
    }

    function test_SetAssertingCaller() public {
        vm.expectEmit(true, true, true, true);
        emit AssertingCallerSet(mockAssertingCallerAddress);
        sovereignSecurity.setAssertingCaller(mockAssertingCallerAddress);
        assertEq(sovereignSecurity.assertingCaller(), mockAssertingCallerAddress);
    }

    function test_RevertIf_RepeatSetAssertingCaller() public {
        sovereignSecurity.setAssertingCaller(mockAssertingCallerAddress);

        vm.expectRevert("Asserting caller already set");
        sovereignSecurity.setAssertingCaller(mockAssertingCallerAddress);
    }

    function test_AsserterNotOnWhitelist() public {
        sovereignSecurity.setAssertingCaller(mockAssertingCallerAddress);

        _mockGetAssertion(assertionId, mockAssertingCallerAddress, TestAddress.account1);

        // If the asserter is not whitelisted, then the assertion should not be allowed.
        assertFalse(sovereignSecurity.whitelistedAsserters(TestAddress.account1));
        vm.prank(mockOptimisticAsserterAddress);
        SovereignSecurityInterface.AssertionPolicy memory policy = sovereignSecurity.getAssertionPolicy(assertionId);
        assertFalse(policy.allowAssertion);

        vm.clearMockedCalls();
    }

    function test_AsserterOnWhitelist() public {
        sovereignSecurity.setAssertingCaller(mockAssertingCallerAddress);

        _mockGetAssertion(assertionId, mockAssertingCallerAddress, TestAddress.account1);

        // If the asserter is whitelisted, then the assertion should be allowed.
        sovereignSecurity.setAsserterInWhitelist(TestAddress.account1, true);
        assertTrue(sovereignSecurity.whitelistedAsserters(TestAddress.account1));
        vm.prank(mockOptimisticAsserterAddress);
        SovereignSecurityInterface.AssertionPolicy memory policy = sovereignSecurity.getAssertionPolicy(assertionId);
        assertTrue(policy.allowAssertion);

        vm.clearMockedCalls();
    }

    function test_BlockAssertingCallerNotSet() public {
        sovereignSecurity.setAsserterInWhitelist(TestAddress.account1, true);
        assertTrue(sovereignSecurity.whitelistedAsserters(TestAddress.account1));

        _mockGetAssertion(assertionId, TestAddress.account1, TestAddress.account1);

        vm.prank(mockOptimisticAsserterAddress);
        SovereignSecurityInterface.AssertionPolicy memory policy = sovereignSecurity.getAssertionPolicy(assertionId);
        assertFalse(policy.allowAssertion);
    }

    function _mockGetAssertion(
        bytes32 assertionId,
        address assertingCaller,
        address asserter
    ) internal {
        OptimisticAsserterInterface.Assertion memory assertion;
        assertion.ssSettings.assertingCaller = assertingCaller;
        assertion.asserter = asserter;
        vm.mockCall(
            mockOptimisticAsserterAddress,
            abi.encodeWithSelector(OptimisticAsserterInterface.getAssertion.selector, assertionId),
            abi.encode(assertion)
        );
    }
}

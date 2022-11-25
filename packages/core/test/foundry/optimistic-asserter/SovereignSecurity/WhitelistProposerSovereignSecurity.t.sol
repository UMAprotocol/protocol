// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "../Common.sol";
import "../../../../contracts/optimistic-asserter/implementation/sovereign-security/WhitelistProposerSovereignSecurity.sol";

contract WhitelistProposerSovereignSecurityTest is Common {
    WhitelistProposerSovereignSecurity sovereignSecurity;

    bytes32 assertionId = "test";

    function setUp() public {
        sovereignSecurity = new WhitelistProposerSovereignSecurity();
    }

    function test_RevertIf_NotOwner() public {
        vm.startPrank(TestAddress.account1);
        vm.expectRevert("Ownable: caller is not the owner");
        sovereignSecurity.setProposerInWhitelist(TestAddress.account1, true);

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

    function test_ProposerNotOnWhitelist() public {
        sovereignSecurity.setAssertingCaller(mockAssertingCallerAddress);

        _mockReadAssertion(assertionId, mockAssertingCallerAddress, TestAddress.account1);

        // If the proposer is not whitelisted, then the assertion should not be allowed.
        assertFalse(sovereignSecurity.whitelistedProposers(TestAddress.account1));
        vm.prank(mockOptimisticAsserterAddress);
        SovereignSecurityInterface.AssertionPolicies memory policy =
            sovereignSecurity.getAssertionPolicies(assertionId);
        assertFalse(policy.allowAssertion);

        vm.clearMockedCalls();
    }

    function test_ProposerOnWhitelist() public {
        sovereignSecurity.setAssertingCaller(mockAssertingCallerAddress);

        _mockReadAssertion(assertionId, mockAssertingCallerAddress, TestAddress.account1);

        // If the proposer is whitelisted, then the assertion should be allowed.
        sovereignSecurity.setProposerInWhitelist(TestAddress.account1, true);
        assertTrue(sovereignSecurity.whitelistedProposers(TestAddress.account1));
        vm.prank(mockOptimisticAsserterAddress);
        SovereignSecurityInterface.AssertionPolicies memory policy =
            sovereignSecurity.getAssertionPolicies(assertionId);
        assertTrue(policy.allowAssertion);

        vm.clearMockedCalls();
    }

    function test_BlockAssertingCallerNotSet() public {
        sovereignSecurity.setProposerInWhitelist(TestAddress.account1, true);
        assertTrue(sovereignSecurity.whitelistedProposers(TestAddress.account1));

        _mockReadAssertion(assertionId, TestAddress.account1, TestAddress.account1);

        vm.prank(mockOptimisticAsserterAddress);
        SovereignSecurityInterface.AssertionPolicies memory policy =
            sovereignSecurity.getAssertionPolicies(assertionId);
        assertFalse(policy.allowAssertion);
    }

    function _mockReadAssertion(
        bytes32 assertionId,
        address assertingCaller,
        address proposer
    ) internal {
        OptimisticAsserterInterface.Assertion memory assertion;
        assertion.ssSettings.assertingCaller = assertingCaller;
        assertion.proposer = proposer;
        vm.mockCall(
            mockOptimisticAsserterAddress,
            abi.encodeWithSelector(OptimisticAsserterInterface.readAssertion.selector, assertionId),
            abi.encode(assertion)
        );
    }
}

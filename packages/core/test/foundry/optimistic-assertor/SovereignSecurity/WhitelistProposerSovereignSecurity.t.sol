// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "../Common.sol";
import "../../../../contracts/optimistic-assertor/implementation/sovereign-security/WhitelistProposerSovereignSecurity.sol";

contract WhitelistProposerSovereignSecurityTest is Common {
    WhitelistProposerSovereignSecurity ss;

    bytes32 assertionId = "test";

    function setUp() public {
        ss = new WhitelistProposerSovereignSecurity();
    }

    function test_RevertIf_NotOwner() public {
        vm.startPrank(TestAddress.account1);
        vm.expectRevert("Ownable: caller is not the owner");
        ss.setProposerInWhitelist(TestAddress.account1, true);

        vm.expectRevert("Ownable: caller is not the owner");
        ss.setAssertingCaller(mockAssertingCallerAddress);
        vm.stopPrank();
    }

    function test_RevertIf_InvalidAssertingCaller() public {
        vm.expectRevert("Invalid asserting caller");
        ss.setAssertingCaller(address(0));
    }

    function test_SetAssertingCaller() public {
        vm.expectEmit(true, true, true, true);
        emit AssertingCallerSet(mockAssertingCallerAddress);
        ss.setAssertingCaller(mockAssertingCallerAddress);
        assertEq(ss.assertingCaller(), mockAssertingCallerAddress);
    }

    function test_RevertIf_RepeatSetAssertingCaller() public {
        ss.setAssertingCaller(mockAssertingCallerAddress);

        vm.expectRevert("Asserting caller already set");
        ss.setAssertingCaller(mockAssertingCallerAddress);
    }

    function test_ProposerNotOnWhitelist() public {
        ss.setAssertingCaller(mockAssertingCallerAddress);

        _mockReadAssertion(assertionId, mockAssertingCallerAddress, TestAddress.account1);

        // If the proposer is not whitelisted, then the assertion should not be allowed.
        assertFalse(ss.whitelistedProposers(TestAddress.account1));
        vm.prank(mockOptimisticAssertorAddress);
        SovereignSecurityInterface.AssertionPolicies memory policy = ss.getAssertionPolicies(assertionId);
        assertFalse(policy.allowAssertion);

        vm.clearMockedCalls();
    }

    function test_ProposerOnWhitelist() public {
        ss.setAssertingCaller(mockAssertingCallerAddress);

        _mockReadAssertion(assertionId, mockAssertingCallerAddress, TestAddress.account1);

        // If the proposer is whitelisted, then the assertion should be allowed.
        ss.setProposerInWhitelist(TestAddress.account1, true);
        assertTrue(ss.whitelistedProposers(TestAddress.account1));
        vm.prank(mockOptimisticAssertorAddress);
        SovereignSecurityInterface.AssertionPolicies memory policy = ss.getAssertionPolicies(assertionId);
        assertTrue(policy.allowAssertion);

        vm.clearMockedCalls();
    }

    function test_BlockAssertingCallerNotSet() public {
        ss.setProposerInWhitelist(TestAddress.account1, true);
        assertTrue(ss.whitelistedProposers(TestAddress.account1));

        _mockReadAssertion(assertionId, TestAddress.account1, TestAddress.account1);

        vm.prank(mockOptimisticAssertorAddress);
        SovereignSecurityInterface.AssertionPolicies memory policy = ss.getAssertionPolicies(assertionId);
        assertFalse(policy.allowAssertion);
    }

    function _mockReadAssertion(
        bytes32 assertionId,
        address assertingCaller,
        address proposer
    ) internal {
        OptimisticAssertorInterface.Assertion memory assertion;
        assertion.ssSettings.assertingCaller = assertingCaller;
        assertion.proposer = proposer;
        vm.mockCall(
            mockOptimisticAssertorAddress,
            abi.encodeWithSelector(OptimisticAssertorInterface.readAssertion.selector, assertionId),
            abi.encode(assertion)
        );
    }
}

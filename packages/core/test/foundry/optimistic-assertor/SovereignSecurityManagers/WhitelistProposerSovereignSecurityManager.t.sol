// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "../Common.sol";
import "../../../../contracts/optimistic-assertor/implementation/sovereign-security-manager/WhitelistProposerSovereignSecurityManager.sol";

contract WhitelistProposerSovereignSecurityManagerTest is Common {
    WhitelistProposerSovereignSecurityManager ssm;

    bytes32 assertionId = "test";

    function setUp() public {
        ssm = new WhitelistProposerSovereignSecurityManager();
    }

    function test_RevertIf_NotOwner() public {
        vm.startPrank(TestAddress.account1);
        vm.expectRevert("Ownable: caller is not the owner");
        ssm.setProposerInWhitelist(TestAddress.account1, true);

        vm.expectRevert("Ownable: caller is not the owner");
        ssm.setAssertingCaller(mockAssertingCallerAddress);
        vm.stopPrank();
    }

    function test_RevertIf_InvalidAssertingCaller() public {
        vm.expectRevert("Invalid asserting caller");
        ssm.setAssertingCaller(address(0));
    }

    function test_SetAssertingCaller() public {
        vm.expectEmit(true, true, true, true);
        emit AssertingCallerSet(mockAssertingCallerAddress);
        ssm.setAssertingCaller(mockAssertingCallerAddress);
        assertEq(ssm.assertingCaller(), mockAssertingCallerAddress);
    }

    function test_RevertIf_RepeatSetAssertingCaller() public {
        ssm.setAssertingCaller(mockAssertingCallerAddress);

        vm.expectRevert("Asserting caller already set");
        ssm.setAssertingCaller(mockAssertingCallerAddress);
    }

    function test_ProposerNotOnWhitelist() public {
        ssm.setAssertingCaller(mockAssertingCallerAddress);

        _mockReadAssertion(assertionId, mockAssertingCallerAddress, TestAddress.account1);

        // If the proposer is not whitelisted, then the assertion should not be allowed.
        assertFalse(ssm.whitelistedProposers(TestAddress.account1));
        vm.prank(mockOptimisticAssertorAddress);
        SovereignSecurityManagerInterface.AssertionPolicies memory policy = ssm.getAssertionPolicies(assertionId);
        assertFalse(policy.allowAssertion);

        vm.clearMockedCalls();
    }

    function test_ProposerOnWhitelist() public {
        ssm.setAssertingCaller(mockAssertingCallerAddress);

        _mockReadAssertion(assertionId, mockAssertingCallerAddress, TestAddress.account1);

        // If the proposer is whitelisted, then the assertion should be allowed.
        ssm.setProposerInWhitelist(TestAddress.account1, true);
        assertTrue(ssm.whitelistedProposers(TestAddress.account1));
        vm.prank(mockOptimisticAssertorAddress);
        SovereignSecurityManagerInterface.AssertionPolicies memory policy = ssm.getAssertionPolicies(assertionId);
        assertTrue(policy.allowAssertion);

        vm.clearMockedCalls();
    }

    function test_BlockAssertingCallerNotSet() public {
        ssm.setProposerInWhitelist(TestAddress.account1, true);
        assertTrue(ssm.whitelistedProposers(TestAddress.account1));

        _mockReadAssertion(assertionId, TestAddress.account1, TestAddress.account1);

        vm.prank(mockOptimisticAssertorAddress);
        SovereignSecurityManagerInterface.AssertionPolicies memory policy = ssm.getAssertionPolicies(assertionId);
        assertFalse(policy.allowAssertion);
    }

    function _mockReadAssertion(
        bytes32 assertionId,
        address assertingCaller,
        address proposer
    ) internal {
        OptimisticAssertorInterface.Assertion memory assertion;
        assertion.assertingCaller = assertingCaller;
        assertion.proposer = proposer;
        vm.mockCall(
            mockOptimisticAssertorAddress,
            abi.encodeWithSelector(OptimisticAssertorInterface.readAssertion.selector, assertionId),
            abi.encode(assertion)
        );
    }
}

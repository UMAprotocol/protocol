// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../CommonOptimisticOracleV3Test.sol";
import "../../../../contracts/optimistic-oracle-v3/implementation/escalation-manager/DisputeLimitingEscalationManager.sol";

contract DisputeLimitingEscalationManagerTest is CommonOptimisticOracleV3Test {
    DisputeLimitingEscalationManager escalationManager;

    bytes32 assertionId = "test";
    bytes32 disputedAssertionId = "disputed";

    function setUp() public {
        escalationManager = new DisputeLimitingEscalationManager(mockOptimisticOracleV3Address);
        assertEq(address(escalationManager.optimisticOracleV3()), mockOptimisticOracleV3Address);
    }

    function test_RevertIf_NotOwner() public {
        vm.prank(TestAddress.account1);
        vm.expectRevert("Ownable: caller is not the owner");
        escalationManager.setAssertingCaller(address(0));
    }

    function test_RevertIf_InvalidAssertingCaller() public {
        vm.expectRevert("Invalid asserting caller");
        escalationManager.setAssertingCaller(address(0));
    }

    function test_SetAssertingCaller() public {
        vm.expectEmit(true, true, true, true);
        emit AssertingCallerSet(TestAddress.account1);
        escalationManager.setAssertingCaller(TestAddress.account1);
        assertEq(escalationManager.assertingCaller(), TestAddress.account1);
    }

    function test_RevertIf_RepeatSetAssertingCaller() public {
        escalationManager.setAssertingCaller(TestAddress.account1);

        vm.expectRevert("Asserting caller already set");
        escalationManager.setAssertingCaller(TestAddress.account2);
    }

    function test_RevertIf_UnauthorizedCaller() public {
        vm.expectRevert("Not the Optimistic Oracle V3");
        escalationManager.assertionDisputedCallback(disputedAssertionId);

        vm.expectRevert("Not the Optimistic Oracle V3");
        escalationManager.assertionResolvedCallback(disputedAssertionId, false);
    }

    function test_BlockAssertingCallerNotSet() public {
        _mockGetAssertionAssertingCaller(TestAddress.account1, assertionId);

        vm.prank(mockOptimisticOracleV3Address);
        EscalationManagerInterface.AssertionPolicy memory policy = escalationManager.getAssertionPolicy(assertionId);
        assertTrue(policy.blockAssertion);
        assertFalse(policy.arbitrateViaEscalationManager);
        assertFalse(policy.discardOracle);
        assertFalse(policy.validateDisputers);
    }

    function test_AllowWithAssertingCallerSet() public {
        escalationManager.setAssertingCaller(TestAddress.account1);
        _mockGetAssertionAssertingCaller(TestAddress.account1, assertionId);

        vm.prank(mockOptimisticOracleV3Address);
        EscalationManagerInterface.AssertionPolicy memory policy = escalationManager.getAssertionPolicy(assertionId);
        assertFalse(policy.blockAssertion);
        assertFalse(policy.arbitrateViaEscalationManager);
        assertFalse(policy.discardOracle);
        assertFalse(policy.validateDisputers);
    }

    function test_DisputeBlocksAssertions() public {
        escalationManager.setAssertingCaller(TestAddress.account1);
        _mockGetAssertionAssertingCaller(TestAddress.account1, disputedAssertionId);
        _mockGetAssertionAssertingCaller(TestAddress.account1, assertionId);

        vm.startPrank(mockOptimisticOracleV3Address);
        escalationManager.assertionDisputedCallback(disputedAssertionId);
        assertEq(escalationManager.disputedAssertionId(), disputedAssertionId);

        // Any other assertion should be blocked.
        EscalationManagerInterface.AssertionPolicy memory policy = escalationManager.getAssertionPolicy(assertionId);
        assertTrue(policy.blockAssertion);
        vm.stopPrank();
    }

    function test_UnrelatedDisputeNotInterfering() public {
        escalationManager.setAssertingCaller(TestAddress.account1);

        // Dispute will be made on assertion created by different asserting caller.
        _mockGetAssertionAssertingCaller(TestAddress.account2, disputedAssertionId);
        _mockGetAssertionAssertingCaller(TestAddress.account1, assertionId);

        vm.prank(mockOptimisticOracleV3Address);
        escalationManager.assertionDisputedCallback(disputedAssertionId);
        assertEq(escalationManager.disputedAssertionId(), bytes32(0));

        // Assertion from asserting caller should not be blocked.
        EscalationManagerInterface.AssertionPolicy memory policy = escalationManager.getAssertionPolicy(assertionId);
        assertFalse(policy.blockAssertion);
    }

    function test_ResolvedDisputeUnblocksAssertions() public {
        escalationManager.setAssertingCaller(TestAddress.account1);
        _mockGetAssertionAssertingCaller(TestAddress.account1, disputedAssertionId);
        _mockGetAssertionAssertingCaller(TestAddress.account1, assertionId);

        vm.startPrank(mockOptimisticOracleV3Address);
        escalationManager.assertionDisputedCallback(disputedAssertionId);
        assertEq(escalationManager.disputedAssertionId(), disputedAssertionId);

        // Resolving dispute should unblock assertions.
        escalationManager.assertionResolvedCallback(disputedAssertionId, false);
        vm.stopPrank();
        assertEq(escalationManager.disputedAssertionId(), bytes32(0));
        EscalationManagerInterface.AssertionPolicy memory policy = escalationManager.getAssertionPolicy(assertionId);
        assertFalse(policy.blockAssertion);
    }

    function test_UnrelatedResolvedAssertionNotInterfering() public {
        escalationManager.setAssertingCaller(TestAddress.account1);
        _mockGetAssertionAssertingCaller(TestAddress.account1, disputedAssertionId);
        _mockGetAssertionAssertingCaller(TestAddress.account1, assertionId);

        vm.startPrank(mockOptimisticOracleV3Address);
        escalationManager.assertionDisputedCallback(disputedAssertionId);
        assertEq(escalationManager.disputedAssertionId(), disputedAssertionId);

        // Resolving any other assertion than the blocking dispute should not unblock assertions.
        escalationManager.assertionResolvedCallback(bytes32("other"), false);
        vm.stopPrank();
        assertEq(escalationManager.disputedAssertionId(), disputedAssertionId);
        EscalationManagerInterface.AssertionPolicy memory policy = escalationManager.getAssertionPolicy(assertionId);
        assertTrue(policy.blockAssertion);
    }
}

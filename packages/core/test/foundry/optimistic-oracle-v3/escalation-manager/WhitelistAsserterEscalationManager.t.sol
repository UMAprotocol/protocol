// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../CommonOptimisticOracleV3Test.sol";
import "../../../../contracts/optimistic-oracle-v3/implementation/escalation-manager/WhitelistAsserterEscalationManager.sol";

contract WhitelistAsserterEscalationManagerTest is CommonOptimisticOracleV3Test {
    WhitelistAsserterEscalationManager escalationManager;

    bytes32 assertionId = "test";

    function setUp() public {
        escalationManager = new WhitelistAsserterEscalationManager(mockOptimisticOracleV3Address);
    }

    function test_RevertIf_NotOwner() public {
        vm.startPrank(TestAddress.account1);
        vm.expectRevert("Ownable: caller is not the owner");
        escalationManager.setAsserterInWhitelist(TestAddress.account1, true);

        vm.expectRevert("Ownable: caller is not the owner");
        escalationManager.setAssertingCaller(mockAssertingCallerAddress);
        vm.stopPrank();
    }

    function test_RevertIf_InvalidAssertingCaller() public {
        vm.expectRevert("Invalid asserting caller");
        escalationManager.setAssertingCaller(address(0));
    }

    function test_SetAssertingCaller() public {
        vm.expectEmit(true, true, true, true);
        emit AssertingCallerSet(mockAssertingCallerAddress);
        escalationManager.setAssertingCaller(mockAssertingCallerAddress);
        assertEq(escalationManager.assertingCaller(), mockAssertingCallerAddress);
    }

    function test_RevertIf_RepeatSetAssertingCaller() public {
        escalationManager.setAssertingCaller(mockAssertingCallerAddress);

        vm.expectRevert("Asserting caller already set");
        escalationManager.setAssertingCaller(mockAssertingCallerAddress);
    }

    function test_AsserterNotOnWhitelist() public {
        escalationManager.setAssertingCaller(mockAssertingCallerAddress);

        _mockGetAssertion(assertionId, mockAssertingCallerAddress, TestAddress.account1);

        // If the asserter is not whitelisted, then the assertion should be blocked.
        assertFalse(escalationManager.whitelistedAsserters(TestAddress.account1));
        EscalationManagerInterface.AssertionPolicy memory policy = escalationManager.getAssertionPolicy(assertionId);
        assertTrue(policy.blockAssertion);

        vm.clearMockedCalls();
    }

    function test_AsserterOnWhitelist() public {
        escalationManager.setAssertingCaller(mockAssertingCallerAddress);

        _mockGetAssertion(assertionId, mockAssertingCallerAddress, TestAddress.account1);

        // If the asserter is whitelisted, then the assertion should not be blocked.
        escalationManager.setAsserterInWhitelist(TestAddress.account1, true);
        assertTrue(escalationManager.whitelistedAsserters(TestAddress.account1));
        EscalationManagerInterface.AssertionPolicy memory policy = escalationManager.getAssertionPolicy(assertionId);
        assertFalse(policy.blockAssertion);

        vm.clearMockedCalls();
    }

    function test_BlockAssertingCallerNotSet() public {
        escalationManager.setAsserterInWhitelist(TestAddress.account1, true);
        assertTrue(escalationManager.whitelistedAsserters(TestAddress.account1));

        _mockGetAssertion(assertionId, TestAddress.account1, TestAddress.account1);

        EscalationManagerInterface.AssertionPolicy memory policy = escalationManager.getAssertionPolicy(assertionId);
        assertTrue(policy.blockAssertion);
    }

    function _mockGetAssertion(
        bytes32 assertionId,
        address assertingCaller,
        address asserter
    ) internal {
        OptimisticOracleV3Interface.Assertion memory assertion;
        assertion.escalationManagerSettings.assertingCaller = assertingCaller;
        assertion.asserter = asserter;
        vm.mockCall(
            mockOptimisticOracleV3Address,
            abi.encodeWithSelector(OptimisticOracleV3Interface.getAssertion.selector, assertionId),
            abi.encode(assertion)
        );
    }
}

// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../CommonOptimisticAsserterTest.sol";
import "../../../../contracts/optimistic-asserter/implementation/escalation-manager/WhitelistCallerEscalationManager.sol";

contract WhitelistCallerEscalationManagerTest is CommonOptimisticAsserterTest {
    WhitelistCallerEscalationManager escalationManager;

    function setUp() public {
        escalationManager = new WhitelistCallerEscalationManager(mockOptimisticAsserterAddress);
    }

    function test_AssertingCallerWhitelist() public {
        bytes32 assertionId = "test";

        // If the asserting caller is not whitelisted, then the assertion should be blocked.
        _mockGetAssertionAssertingCaller(mockAssertingCallerAddress, assertionId);
        EscalationManagerInterface.AssertionPolicy memory policyNotWhitelisted =
            escalationManager.getAssertionPolicy(assertionId);
        assertTrue(policyNotWhitelisted.blockAssertion);

        // If the asserting caller is whitelisted, then the assertion should not be blocked.
        escalationManager.setAssertingCallerInWhitelist(mockAssertingCallerAddress, true);
        EscalationManagerInterface.AssertionPolicy memory policyWhitelisted =
            escalationManager.getAssertionPolicy(assertionId);
        assertFalse(policyWhitelisted.blockAssertion);

        vm.clearMockedCalls();
    }

    function test_RevertIf_NotOwner() public {
        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(TestAddress.account1);
        escalationManager.setAssertingCallerInWhitelist(TestAddress.account1, true);
    }
}

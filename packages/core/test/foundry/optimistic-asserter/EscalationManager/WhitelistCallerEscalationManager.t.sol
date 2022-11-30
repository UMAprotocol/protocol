// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "../Common.sol";
import "../../../../contracts/optimistic-asserter/implementation/escalation-manager/WhitelistCallerEscalationManager.sol";

contract WhitelistCallerEscalationManagerTest is Common {
    WhitelistCallerEscalationManager escalationManager;

    function setUp() public {
        escalationManager = new WhitelistCallerEscalationManager();
    }

    function test_AssertingCallerWhitelist() public {
        bytes32 assertionId = "test";

        // If the asserting caller is not whitelisted, then the assertion should be blocked.
        _mockGetAssertionAssertingCaller(mockAssertingCallerAddress, assertionId);
        vm.prank(mockOptimisticAsserterAddress);
        EscalationManagerInterface.AssertionPolicy memory policyNotWhitelisted =
            escalationManager.getAssertionPolicy(assertionId);
        assertTrue(policyNotWhitelisted.blockAssertion);

        // If the asserting caller is whitelisted, then the assertion should not be blocked.
        escalationManager.setAssertingCallerInWhitelist(mockAssertingCallerAddress, true);
        vm.prank(mockOptimisticAsserterAddress);
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

    function _mockGetAssertionAssertingCaller(address mockAssertingCaller, bytes32 assertionId) public {
        OptimisticAsserterInterface.Assertion memory assertion;
        assertion.escalationManagerSettings.assertingCaller = mockAssertingCaller;
        vm.mockCall(
            mockOptimisticAsserterAddress,
            abi.encodeWithSelector(OptimisticAsserterInterface.getAssertion.selector, assertionId),
            abi.encode(assertion)
        );
    }
}

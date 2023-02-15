// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "./FullPolicyEscalationManager.Common.t.sol";

contract FullPolicyEscalationManagerBlockDisputeTest is FullPolicyEscalationManagerCommon {
    function test_ValidateDisputersEnabled() public {
        // Disputes are allowed only by whitelisted dispute callers.
        FullPolicyEscalationManager(escalationManager).configureEscalationManager(false, false, true, false, false);
        bytes32 assertionId = _wrappedAssertWithCallbackRecipientAndSs(address(0), escalationManager);

        // Assertion should have validateDisputers enabled and check other Escalation Manager settings.
        OptimisticOracleV3Interface.Assertion memory assertion = optimisticOracleV3.getAssertion(assertionId);
        assertFalse(assertion.escalationManagerSettings.discardOracle);
        assertFalse(assertion.escalationManagerSettings.arbitrateViaEscalationManager);
        assertTrue(assertion.escalationManagerSettings.validateDisputers);
        assertEq(assertion.escalationManagerSettings.escalationManager, escalationManager);
        assertEq(assertion.escalationManagerSettings.assertingCaller, address(assertingCaller));
    }

    function test_RevertIf_DisputeCallerNotOnWhitelist() public {
        // Disputes are allowed only by whitelisted dispute callers.
        FullPolicyEscalationManager(escalationManager).configureEscalationManager(false, false, true, false, false);
        bytes32 assertionId = _wrappedAssertWithCallbackRecipientAndSs(address(0), escalationManager);

        // Fund Account2 for the dispute that should be blocked.
        vm.startPrank(TestAddress.account2);
        defaultCurrency.allocateTo(TestAddress.account2, defaultBond);
        defaultCurrency.approve(address(optimisticOracleV3), defaultBond);
        vm.expectRevert("Dispute not allowed");
        optimisticOracleV3.disputeAssertion(assertionId, TestAddress.account2);
        vm.stopPrank();
    }

    function test_DisputeCallerOnWhitelist() public {
        // Disputes are allowed only by whitelisted dispute callers.
        FullPolicyEscalationManager(escalationManager).configureEscalationManager(false, false, true, false, false);
        FullPolicyEscalationManager(escalationManager).setDisputeCallerInWhitelist(TestAddress.account2, true);
        bytes32 assertionId = _wrappedAssertWithCallbackRecipientAndSs(address(0), escalationManager);

        // Dispute callback should be triggered on the Escalation Manager.
        _expectAssertionDisputedCallback(escalationManager, assertionId);

        // Dispute should not be blocked.
        _disputeAndGetOracleRequest(assertionId, defaultBond);

        // Assertion now should be in a disputed state.
        OptimisticOracleV3Interface.Assertion memory assertion = optimisticOracleV3.getAssertion(assertionId);
        assertEq(assertion.disputer, TestAddress.account2);
    }
}

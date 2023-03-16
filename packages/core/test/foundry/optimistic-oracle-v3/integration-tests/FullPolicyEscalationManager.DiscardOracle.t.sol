// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "./FullPolicyEscalationManager.Common.t.sol";

contract FullPolicyEscalationManagerDiscardOracleTest is FullPolicyEscalationManagerCommon {
    function test_DiscardOracleEnabled() public {
        // Ignore Oracle (DVM or EM) resolution.
        FullPolicyEscalationManager(escalationManager).configureEscalationManager(false, false, false, false, true);
        bytes32 assertionId = _wrappedAssertWithCallbackRecipientAndSs(address(0), escalationManager);

        // Assertion should have arbitrateViaEscalationManager enabled and check other Escalation Manager settings.
        OptimisticOracleV3Interface.Assertion memory assertion = optimisticOracleV3.getAssertion(assertionId);
        assertTrue(assertion.escalationManagerSettings.discardOracle);
        assertFalse(assertion.escalationManagerSettings.arbitrateViaEscalationManager);
        assertFalse(assertion.escalationManagerSettings.validateDisputers);
        assertEq(assertion.escalationManagerSettings.escalationManager, escalationManager);
        assertEq(assertion.escalationManagerSettings.assertingCaller, address(assertingCaller));
    }

    function test_AssertionNotTruthfulOnDispute() public {
        // Ignore Oracle (DVM or EM) resolution.
        FullPolicyEscalationManager(escalationManager).configureEscalationManager(false, false, false, false, true);
        bytes32 assertionId = _wrappedAssertWithCallbackRecipientAndSs(address(0), escalationManager);

        // Escalation Manager should receive both dispute and resolved callbacks on dispute.
        _expectAssertionDisputedCallback(escalationManager, assertionId);
        _expectAssertionResolvedCallback(escalationManager, assertionId, false);
        _disputeAndGetOracleRequest(assertionId, defaultBond);

        // Assertion result should be false after dispute.
        assertFalse(optimisticOracleV3.getAssertionResult(assertionId));
    }

    function test_TruthfulOracleResultDiscarded() public {
        // Ignore Oracle (DVM or EM) resolution.
        FullPolicyEscalationManager(escalationManager).configureEscalationManager(false, false, false, false, true);
        bytes32 assertionId = _wrappedAssertWithCallbackRecipientAndSs(address(0), escalationManager);

        // Dispute and resolve truthful on Oracle should still settle the assertion as not truthful.
        OracleRequest memory oracleRequest = _disputeAndGetOracleRequest(assertionId, defaultBond);
        _mockOracleResolved(address(mockOracle), oracleRequest, true);
        _defaultSaveBalancesBeforeSettle();
        assertFalse(optimisticOracleV3.settleAndGetAssertionResult(assertionId));

        // Asserter should still get double the bond less Oracle fees.
        _defaultCheckBalancesAfterSettle(true, true, true);
    }
}

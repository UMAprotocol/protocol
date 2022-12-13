// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "./FullPolicyEscalationManager.Common.t.sol";
import "../../../../contracts/optimistic-asserter/implementation/escalation-manager/FullPolicyEscalationManager.sol";

contract FullPolicyEscalationManagerDiscardOracleTest is FullPolicyEscalationManagerCommon {
    function test_DiscardOracleEnabled() public {
        // Ignore Oracle (DVM or EM) resolution.
        FullPolicyEscalationManager(escalationManager).configureEscalationManager(false, false, false, false, true);
        bytes32 assertionId = _wrappedAssertWithCallbackRecipientAndSs(address(0), escalationManager);

        // Assertion should have arbitrateViaEscalationManager enabled and check other Escalation Manager settings.
        OptimisticAsserterInterface.Assertion memory assertion = optimisticAsserter.getAssertion(assertionId);
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
        assertFalse(optimisticAsserter.getAssertionResult(assertionId));
    }

    function test_TruthfulOracleResultDiscarded() public {
        // Ignore Oracle (DVM or EM) resolution.
        FullPolicyEscalationManager(escalationManager).configureEscalationManager(false, false, false, false, true);
        bytes32 assertionId = _wrappedAssertWithCallbackRecipientAndSs(address(0), escalationManager);

        // Dispute and resolve truthful on Oracle should still settle the assertion as not truthful.
        OracleRequest memory oracleRequest = _disputeAndGetOracleRequest(assertionId, defaultBond);
        _mockOracleResolved(address(mockOracle), oracleRequest, true);
        assertFalse(optimisticAsserter.settleAndGetAssertionResult(assertionId));
    }
}

// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "./FullPolicyEscalationManager.Common.t.sol";

contract FullPolicyEscalationManagerArbitrateTest is FullPolicyEscalationManagerCommon {
    function test_ArbitrateViaEscalationManagerEnabled() public {
        // Arbitration should be resolved via the Escalation Manager.
        FullPolicyEscalationManager(escalationManager).configureEscalationManager(false, false, false, true, false);
        bytes32 assertionId = _wrappedAssertWithCallbackRecipientAndSs(address(0), escalationManager);

        // Assertion should have arbitrateViaEscalationManager enabled and check other Escalation Manager settings.
        OptimisticOracleV3Interface.Assertion memory assertion = optimisticOracleV3.getAssertion(assertionId);
        assertFalse(assertion.escalationManagerSettings.discardOracle);
        assertTrue(assertion.escalationManagerSettings.arbitrateViaEscalationManager);
        assertFalse(assertion.escalationManagerSettings.validateDisputers);
        assertEq(assertion.escalationManagerSettings.escalationManager, escalationManager);
        assertEq(assertion.escalationManagerSettings.assertingCaller, address(assertingCaller));
    }

    function test_RevertIf_ArbitrationResolutionNotSet() public {
        // Arbitration should be resolved via the Escalation Manager.
        FullPolicyEscalationManager(escalationManager).configureEscalationManager(false, false, false, true, false);
        bytes32 assertionId = _wrappedAssertWithCallbackRecipientAndSs(address(0), escalationManager);

        // Escalation manager should receive the price request on dispute.
        OptimisticOracleV3Interface.Assertion memory assertion = optimisticOracleV3.getAssertion(assertionId);
        OracleRequest memory expectedOracleRequest =
            OracleRequest({
                identifier: defaultIdentifier,
                time: assertion.assertionTime,
                ancillaryData: optimisticOracleV3.stampAssertion(assertionId)
            });
        _expectOraclePriceRequest(escalationManager, expectedOracleRequest);
        _disputeAndGetOracleRequest(assertionId, defaultBond);

        vm.expectRevert("Arbitration resolution not set");
        optimisticOracleV3.settleAndGetAssertionResult(assertionId);
    }

    function test_ResolveAssertionTruthfulViaEscalationManager() public {
        // Arbitration should be resolved via the Escalation Manager.
        FullPolicyEscalationManager(escalationManager).configureEscalationManager(false, false, false, true, false);
        bytes32 assertionId = _wrappedAssertWithCallbackRecipientAndSs(address(0), escalationManager);

        // Dispute and resolve truthful through Escalation Manager.
        OracleRequest memory oracleRequest = _disputeAndGetOracleRequest(assertionId, defaultBond);
        FullPolicyEscalationManager(escalationManager).setArbitrationResolution(
            oracleRequest.identifier,
            oracleRequest.time,
            oracleRequest.ancillaryData,
            true
        );

        // Escalation Manager should receive the callback and the assertion should be settled truthfully.
        _expectAssertionResolvedCallback(escalationManager, assertionId, true);
        _defaultSaveBalancesBeforeSettle();
        assertTrue(optimisticOracleV3.settleAndGetAssertionResult(assertionId));

        // Asserter should get double the bond less Oracle fees.
        _defaultCheckBalancesAfterSettle(true, true, true);
    }

    function test_ResolveAssertionNotTruthfulViaEscalationManager() public {
        // Arbitration should be resolved via the Escalation Manager.
        FullPolicyEscalationManager(escalationManager).configureEscalationManager(false, false, false, true, false);
        bytes32 assertionId = _wrappedAssertWithCallbackRecipientAndSs(address(0), escalationManager);

        // Dispute and resolve not truthful through Escalation Manager.
        OracleRequest memory oracleRequest = _disputeAndGetOracleRequest(assertionId, defaultBond);
        FullPolicyEscalationManager(escalationManager).setArbitrationResolution(
            oracleRequest.identifier,
            oracleRequest.time,
            oracleRequest.ancillaryData,
            false
        );

        // Escalation Manager should receive the callback and the assertion should be settled not being truthful.
        _expectAssertionResolvedCallback(escalationManager, assertionId, false);
        _defaultSaveBalancesBeforeSettle();
        assertFalse(optimisticOracleV3.settleAndGetAssertionResult(assertionId));

        // Disputer should get double the bond less Oracle fees.
        _defaultCheckBalancesAfterSettle(true, false, true);
    }
}

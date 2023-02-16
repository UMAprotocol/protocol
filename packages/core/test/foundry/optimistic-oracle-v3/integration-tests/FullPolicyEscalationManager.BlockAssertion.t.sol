// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "./FullPolicyEscalationManager.Common.t.sol";

contract FullPolicyEscalationManagerBlockAssertionTest is FullPolicyEscalationManagerCommon {
    function test_RevertIf_AssertingCallerNotOnWhitelist() public {
        // Assertions are allowed only by whitelisted asserting callers.
        FullPolicyEscalationManager(escalationManager).configureEscalationManager(true, false, false, false, false);
        vm.expectRevert("Assertion not allowed");
        _wrappedAssertWithCallbackRecipientAndSs(address(0), escalationManager);
    }

    function test_AssertingCallerOnWhitelist() public {
        // Assertions are allowed only by whitelisted asserting callers.
        FullPolicyEscalationManager(escalationManager).configureEscalationManager(true, false, false, false, false);
        FullPolicyEscalationManager(escalationManager).setWhitelistedAssertingCallers(address(assertingCaller), true);
        bytes32 assertionId = _wrappedAssertWithCallbackRecipientAndSs(address(0), escalationManager);

        // Assertion should have default settings and point to the Escalation Manager and wrapper contract.
        OptimisticOracleV3Interface.Assertion memory assertion = optimisticOracleV3.getAssertion(assertionId);
        assertFalse(assertion.escalationManagerSettings.discardOracle);
        assertFalse(assertion.escalationManagerSettings.arbitrateViaEscalationManager);
        assertFalse(assertion.escalationManagerSettings.validateDisputers);
        assertEq(assertion.escalationManagerSettings.escalationManager, escalationManager);
        assertEq(assertion.escalationManagerSettings.assertingCaller, address(assertingCaller));
    }

    function test_RevertIf_AssertingCallerAndAsserterNotOnWhitelist() public {
        // Assertions are allowed only by whitelisted asserting callers and asserters.
        FullPolicyEscalationManager(escalationManager).configureEscalationManager(true, true, false, false, false);
        vm.expectRevert("Assertion not allowed");
        _wrappedAssertWithCallbackRecipientAndSs(address(0), escalationManager);
    }

    function test_RevertIf_AssertingCallerOnWhitelistAndAsserterNotOnWhitelist() public {
        // Assertions are allowed only by whitelisted asserting callers and asserters.
        FullPolicyEscalationManager(escalationManager).configureEscalationManager(true, true, false, false, false);
        FullPolicyEscalationManager(escalationManager).setWhitelistedAssertingCallers(address(assertingCaller), true);
        vm.expectRevert("Assertion not allowed");
        _wrappedAssertWithCallbackRecipientAndSs(address(0), escalationManager);
    }

    function test_RevertIf_AssertingCallerNotOnWhitelistAndAsserterOnWhitelist() public {
        // Assertions are allowed only by whitelisted asserting callers and asserters.
        FullPolicyEscalationManager(escalationManager).configureEscalationManager(true, true, false, false, false);
        FullPolicyEscalationManager(escalationManager).setWhitelistedAsserters(TestAddress.account1, true);
        vm.expectRevert("Assertion not allowed");
        _wrappedAssertWithCallbackRecipientAndSs(address(0), escalationManager);
    }

    function test_AssertingCallerAndAsserterOnWhitelist() public {
        // Assertions are allowed only by whitelisted asserting callers and asserters.
        FullPolicyEscalationManager(escalationManager).configureEscalationManager(true, true, false, false, false);
        FullPolicyEscalationManager(escalationManager).setWhitelistedAssertingCallers(address(assertingCaller), true);
        FullPolicyEscalationManager(escalationManager).setWhitelistedAsserters(TestAddress.account1, true);
        bytes32 assertionId = _wrappedAssertWithCallbackRecipientAndSs(address(0), escalationManager);

        // Assertion should have default settings and point to the Escalation Manager and wrapper contract.
        OptimisticOracleV3Interface.Assertion memory assertion = optimisticOracleV3.getAssertion(assertionId);
        assertFalse(assertion.escalationManagerSettings.discardOracle);
        assertFalse(assertion.escalationManagerSettings.arbitrateViaEscalationManager);
        assertFalse(assertion.escalationManagerSettings.validateDisputers);
        assertEq(assertion.escalationManagerSettings.escalationManager, escalationManager);
        assertEq(assertion.escalationManagerSettings.assertingCaller, address(assertingCaller));
    }
}

// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../CommonOptimisticOracleV3Test.sol";
import "../../../../contracts/optimistic-oracle-v3/implementation/escalation-manager/BaseEscalationManager.sol";

contract BaseEscalationManagerTest is CommonOptimisticOracleV3Test {
    address escalationManager;

    function setUp() public virtual {
        _commonSetup();

        // Fund Account1 for making assertion through wrapper.
        vm.startPrank(TestAddress.account1);
        defaultCurrency.allocateTo(TestAddress.account1, defaultBond);
        defaultCurrency.approve(address(assertingCaller), defaultBond);
        vm.stopPrank();

        escalationManager = address(new BaseEscalationManager(address(optimisticOracleV3)));
    }

    function test_MakeAssertion() public {
        bytes32 assertionId = _wrappedAssertWithCallbackRecipientAndSs(address(0), escalationManager);

        // Assertion should have default settings and point to the Escalation Manager and wrapper contract.
        OptimisticOracleV3Interface.Assertion memory assertion = optimisticOracleV3.getAssertion(assertionId);
        assertFalse(assertion.escalationManagerSettings.discardOracle);
        assertFalse(assertion.escalationManagerSettings.arbitrateViaEscalationManager);
        assertFalse(assertion.escalationManagerSettings.validateDisputers);
        assertEq(assertion.escalationManagerSettings.escalationManager, escalationManager);
        assertEq(assertion.escalationManagerSettings.assertingCaller, address(assertingCaller));
    }

    function test_DisputeAssertion() public {
        bytes32 assertionId = _wrappedAssertWithCallbackRecipientAndSs(address(0), escalationManager);

        // Dispute callback should be triggered on the Escalation Manager.
        _expectAssertionDisputedCallback(escalationManager, assertionId);

        // Dispute should not be blocked.
        _disputeAndGetOracleRequest(assertionId, defaultBond);
    }

    function test_SettleWithoutDispute() public {
        bytes32 assertionId = _wrappedAssertWithCallbackRecipientAndSs(address(0), escalationManager);
        _defaultSaveBalancesBeforeSettle();

        // Move time forward to the end of the liveness period.
        timer.setCurrentTime(timer.getCurrentTime() + defaultLiveness);

        // Settlement should trigger callback with asserted truthfully.
        _expectAssertionResolvedCallback(escalationManager, assertionId, true);
        assertTrue(optimisticOracleV3.settleAndGetAssertionResult(assertionId));

        // Asserter should get its bond back.
        _defaultCheckBalancesAfterSettle(false, true, false);
    }

    function test_SettleWithRightDispute() public {
        bytes32 assertionId = _wrappedAssertWithCallbackRecipientAndSs(address(0), escalationManager);
        OracleRequest memory oracleRequest = _disputeAndGetOracleRequest(assertionId, defaultBond);
        _defaultSaveBalancesBeforeSettle();

        // Mock resolve assertion not truethful through Oracle and verify on resolve callback to Escalation Manager.
        _mockOracleResolved(address(mockOracle), oracleRequest, false);
        _expectAssertionResolvedCallback(escalationManager, assertionId, false);
        assertFalse(optimisticOracleV3.settleAndGetAssertionResult(assertionId));
        vm.clearMockedCalls();

        // Disputer should get double the bond less Oracle fees.
        _defaultCheckBalancesAfterSettle(true, false, true);
    }

    function test_SettleWithWrongDispute() public {
        bytes32 assertionId = _wrappedAssertWithCallbackRecipientAndSs(address(0), escalationManager);
        OracleRequest memory oracleRequest = _disputeAndGetOracleRequest(assertionId, defaultBond);
        _defaultSaveBalancesBeforeSettle();

        // Mock resolve assertion truethful through Oracle and verify on resolve callback to Escalation Manager.
        _mockOracleResolved(address(mockOracle), oracleRequest, true);
        _expectAssertionResolvedCallback(escalationManager, assertionId, true);
        assertTrue(optimisticOracleV3.settleAndGetAssertionResult(assertionId));
        vm.clearMockedCalls();

        // Asserter should get double the bond less Oracle fees.
        _defaultCheckBalancesAfterSettle(true, true, true);
    }
}

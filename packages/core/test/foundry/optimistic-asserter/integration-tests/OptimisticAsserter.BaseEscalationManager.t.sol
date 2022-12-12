// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "../Common.sol";
import "../../../../contracts/optimistic-asserter/implementation/escalation-manager/BaseEscalationManager.sol";

contract OptimisticAsserterWithBaseEscalationManagerTest is Common {
    BaseEscalationManager escalationManager;

    function setUp() public {
        _commonSetup();

        // Fund Account1 for making assertion.
        vm.startPrank(TestAddress.account1);
        defaultCurrency.allocateTo(TestAddress.account1, defaultBond);
        defaultCurrency.approve(address(optimisticAsserter), defaultBond);
        vm.stopPrank();

        escalationManager = new BaseEscalationManager();
    }

    function test_MakeAssertion() public {
        bytes32 assertionId = _assertWithCallbackRecipientAndSs(address(0), address(escalationManager));

        // Assertion should have default settings and point to the Escalation Manager.
        OptimisticAsserterInterface.Assertion memory assertion = optimisticAsserter.getAssertion(assertionId);
        assertFalse(assertion.escalationManagerSettings.discardOracle);
        assertFalse(assertion.escalationManagerSettings.arbitrateViaEscalationManager);
        assertFalse(assertion.escalationManagerSettings.validateDisputers);
        assertEq(assertion.escalationManagerSettings.escalationManager, address(escalationManager));
        assertEq(assertion.escalationManagerSettings.assertingCaller, TestAddress.account1);
    }

    function test_DisputeAssertion() public {
        bytes32 assertionId = _assertWithCallbackRecipientAndSs(address(0), address(escalationManager));

        // Dispute callback should be triggered on the Escalation Manager.
        _expectAssertionDisputedCallback(address(escalationManager), assertionId);

        // Dispute should not be blocked.
        _disputeAndGetOracleRequest(assertionId, defaultBond);
    }

    function test_SettleWithoutDispute() public {
        bytes32 assertionId = _assertWithCallbackRecipientAndSs(address(0), address(escalationManager));

        // Move time forward to the end of the liveness period.
        timer.setCurrentTime(timer.getCurrentTime() + defaultLiveness);

        // Settlement should trigger callback with asserted truthfully.
        _expectAssertionResolvedCallback(address(escalationManager), assertionId, true);
        assertTrue(optimisticAsserter.settleAndGetAssertionResult(assertionId));
    }

    function test_SettleWithRightDispute() public {
        bytes32 assertionId = _assertWithCallbackRecipientAndSs(address(0), address(escalationManager));
        OracleRequest memory oracleRequest = _disputeAndGetOracleRequest(assertionId, defaultBond);

        // Mock resolve assertion not truethful through Oracle and verify on resolve callback to Escalation Manager.
        _mockOracleResolved(address(mockOracle), oracleRequest, false);
        _expectAssertionResolvedCallback(address(escalationManager), assertionId, false);
        assertFalse(optimisticAsserter.settleAndGetAssertionResult(assertionId));
        vm.clearMockedCalls();
    }

    function test_SettleWithWrongDispute() public {
        bytes32 assertionId = _assertWithCallbackRecipientAndSs(address(0), address(escalationManager));
        OracleRequest memory oracleRequest = _disputeAndGetOracleRequest(assertionId, defaultBond);

        // Mock resolve assertion truethful through Oracle and verify on resolve callback to Escalation Manager.
        _mockOracleResolved(address(mockOracle), oracleRequest, true);
        _expectAssertionResolvedCallback(address(escalationManager), assertionId, true);
        assertTrue(optimisticAsserter.settleAndGetAssertionResult(assertionId));
        vm.clearMockedCalls();
    }
}

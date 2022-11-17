// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "./Common.sol";

contract SovereignSecurityManagerPoliciesEnforced is Common {
    function setUp() public {
        _commonSetup();

        // Fund Account1 for making assertion.
        vm.startPrank(TestAddress.account1);
        defaultCurrency.allocateTo(TestAddress.account1, defaultBond);
        defaultCurrency.approve(address(optimisticAssertor), defaultBond);
        vm.stopPrank();

        // Mocked callback recipiend code size should be > 0.
        vm.etch(mockedCallbackRecipient, new bytes(1));
    }

    function testDefaultPolicies() public {
        vm.prank(TestAddress.account1);
        bytes32 assertionId = optimisticAssertor.assertTruth(trueClaimAssertion);
        OptimisticAssertorInterface.Assertion memory assertion = optimisticAssertor.readAssertion(assertionId);
        assertTrue(assertion.useDisputeResolution);
        assertTrue(assertion.useDvmAsOracle);
    }

    function test_RevertIf_AssertionBlocked() public {
        // Block any assertion.
        _mockSsmPolicies(false, true, true);

        vm.expectRevert("Assertion not allowed");
        _assertWithCallbackRecipientAndSsm(address(0), mockedSovereignSecurityManager);
        vm.clearMockedCalls();
    }

    function test_DisableDvmAsOracle() public {
        // Use SSM as oracle.
        _mockSsmPolicies(true, false, true);
        _mockSsmDisputerCheck(true);

        bytes32 assertionId = _assertWithCallbackRecipientAndSsm(address(0), mockedSovereignSecurityManager);
        OptimisticAssertorInterface.Assertion memory assertion = optimisticAssertor.readAssertion(assertionId);
        assertFalse(assertion.useDvmAsOracle);

        // Dispute, mock resolve assertion truethful through SSM as Oracle and verify on Optimistic Assertor.
        OracleRequest memory oracleRequest = _disputeAndGetOracleRequest(assertionId);
        _mockOracleResolved(mockedSovereignSecurityManager, oracleRequest, true);
        assertTrue(optimisticAssertor.settleAndGetAssertion(assertionId));
        vm.clearMockedCalls();
    }

    function test_DisregardOracle() public {
        // Do not respect Oracle on dispute.
        _mockSsmPolicies(true, true, false);
        _mockSsmDisputerCheck(true);

        bytes32 assertionId = _assertWithCallbackRecipientAndSsm(address(0), mockedSovereignSecurityManager);
        OptimisticAssertorInterface.Assertion memory assertion = optimisticAssertor.readAssertion(assertionId);
        assertFalse(assertion.useDisputeResolution);

        // Dispute should make assertion false available immediately.
        OracleRequest memory oracleRequest = _disputeAndGetOracleRequest(assertionId);
        assertFalse(optimisticAssertor.getAssertion(assertionId));

        // Mock resolve assertion truethful through Oracle and verify it is settled false on Optimistic Assertor.
        _mockOracleResolved(address(mockOracle), oracleRequest, true);
        assertFalse(optimisticAssertor.settleAndGetAssertion(assertionId));
        vm.clearMockedCalls();
    }

    function test_CallbackOnExpired() public {
        // Assert with callback recipient.
        bytes32 assertionId = _assertWithCallbackRecipientAndSsm(mockedCallbackRecipient, address(0));

        // Move time forward to the end of the liveness period.
        timer.setCurrentTime(timer.getCurrentTime() + defaultLiveness);

        // Settlement should trigger callback with asserted truthfully.
        _expectAssertionResolvedCallback(assertionId, true);
        optimisticAssertor.settleAndGetAssertion(assertionId);
    }

    function test_CallbackOnResolvedTruth() public {
        // Assert with callback recipient.
        bytes32 assertionId = _assertWithCallbackRecipientAndSsm(mockedCallbackRecipient, address(0));

        // Dispute and verify on dispute callback.
        _expectAssertionDisputedCallback(assertionId);
        OracleRequest memory oracleRequest = _disputeAndGetOracleRequest(assertionId);

        // Mock resolve assertion truethful through Oracle and verify on resolve callback to Recipient.
        _mockOracleResolved(address(mockOracle), oracleRequest, true);
        _expectAssertionResolvedCallback(assertionId, true);
        optimisticAssertor.settleAndGetAssertion(assertionId);
        vm.clearMockedCalls();
    }

    function test_CallbackOnResolvedFalse() public {
        // Assert with callback recipient.
        bytes32 assertionId = _assertWithCallbackRecipientAndSsm(mockedCallbackRecipient, address(0));

        // Dispute and verify on dispute callback.
        _expectAssertionDisputedCallback(assertionId);
        OracleRequest memory oracleRequest = _disputeAndGetOracleRequest(assertionId);

        // Mock resolve assertion false through Oracle and verify on resolve callback to Recipient.
        _mockOracleResolved(address(mockOracle), oracleRequest, false);
        _expectAssertionResolvedCallback(assertionId, false);
        optimisticAssertor.settleAndGetAssertion(assertionId);
        vm.clearMockedCalls();
    }

    function test_CallbackOnDispute() public {
        // Assert with callback recipient and not respecting Oracle.
        _mockSsmPolicies(true, true, false);
        _mockSsmDisputerCheck(true);

        bytes32 assertionId =
            _assertWithCallbackRecipientAndSsm(mockedCallbackRecipient, mockedSovereignSecurityManager);

        // Dispute callback should be triggered.
        _expectAssertionDisputedCallback(assertionId);
        // Resolve callback should be made on dispute without settlement.
        _expectAssertionResolvedCallback(assertionId, false);
        _disputeAndGetOracleRequest(assertionId);
        vm.clearMockedCalls();
    }

    function test_DisputeAllowed() public {
        // Default SSM policies and allow disputes.
        _mockSsmPolicies(true, true, true);
        _mockSsmDisputerCheck(true);

        bytes32 assertionId = _assertWithCallbackRecipientAndSsm(address(0), mockedSovereignSecurityManager);

        _disputeAndGetOracleRequest(assertionId);
        vm.clearMockedCalls();
    }

    function test_RevertIf_DisputeNotAllowed() public {
        // Default SSM policies and disallow disputes.
        _mockSsmPolicies(true, true, true);
        _mockSsmDisputerCheck(false);

        bytes32 assertionId = _assertWithCallbackRecipientAndSsm(address(0), mockedSovereignSecurityManager);

        // Fund Account2 for making dispute.
        vm.startPrank(TestAddress.account2);
        defaultCurrency.allocateTo(TestAddress.account2, defaultBond);
        defaultCurrency.approve(address(optimisticAssertor), defaultBond);

        vm.expectRevert("Dispute not allowed");
        optimisticAssertor.disputeAssertionFor(assertionId, TestAddress.account2);
        vm.stopPrank();
        vm.clearMockedCalls();
    }
}

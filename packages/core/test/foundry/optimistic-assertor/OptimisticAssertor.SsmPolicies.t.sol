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

        bytes32 assertionId = _assertWithCallbackRecipientAndSsm(address(0), mockedSovereignSecurityManager);
        OptimisticAssertorInterface.Assertion memory assertion = optimisticAssertor.readAssertion(assertionId);
        assertFalse(assertion.useDvmAsOracle);

        // Dispute, mock resolve assertion truethful through SSM as Oracle and verify on Optimistic Asserter.
        OracleRequest memory oracleRequest = _disputeAndGetOracleRequest(assertionId);
        _mockOracleResolved(mockedSovereignSecurityManager, oracleRequest, true);
        assertTrue(optimisticAssertor.settleAndGetAssertion(assertionId));
        vm.clearMockedCalls();
    }

    function test_DisregardOracle() public {
        // Do not respect Oracle on dispute.
        _mockSsmPolicies(true, true, false);

        bytes32 assertionId = _assertWithCallbackRecipientAndSsm(address(0), mockedSovereignSecurityManager);
        OptimisticAssertorInterface.Assertion memory assertion = optimisticAssertor.readAssertion(assertionId);
        assertFalse(assertion.useDisputeResolution);

        // Dispute should make assertion false available immediately.
        OracleRequest memory oracleRequest = _disputeAndGetOracleRequest(assertionId);
        assertFalse(optimisticAssertor.getAssertion(assertionId));

        // Mock resolve assertion truethful through Oracle and verify it is settled false on Optimistic Asserter
        // while proposer should still receive the bond.
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
        _expectCallback(assertionId, true);
        optimisticAssertor.settleAndGetAssertion(assertionId);
    }

    function test_CallbackOnResolvedTruth() public {
        // Assert with callback recipient.
        bytes32 assertionId = _assertWithCallbackRecipientAndSsm(mockedCallbackRecipient, address(0));

        // Dispute, mock resolve assertion truethful through Oracle and verify on Callback Recipient.
        OracleRequest memory oracleRequest = _disputeAndGetOracleRequest(assertionId);
        _mockOracleResolved(address(mockOracle), oracleRequest, true);
        _expectCallback(assertionId, true);
        optimisticAssertor.settleAndGetAssertion(assertionId);
        vm.clearMockedCalls();
    }

    function test_CallbackOnResolvedFalse() public {
        // Assert with callback recipient.
        bytes32 assertionId = _assertWithCallbackRecipientAndSsm(mockedCallbackRecipient, address(0));

        // Dispute, mock resolve assertion false through Oracle and verify on Callback Recipient.
        OracleRequest memory oracleRequest = _disputeAndGetOracleRequest(assertionId);
        _mockOracleResolved(address(mockOracle), oracleRequest, false);
        _expectCallback(assertionId, false);
        optimisticAssertor.settleAndGetAssertion(assertionId);
        vm.clearMockedCalls();
    }

    function test_CallbackOnDispute() public {
        // Assert with callback recipient and not respecting Oracle.
        _mockSsmPolicies(true, true, false);
        bytes32 assertionId =
            _assertWithCallbackRecipientAndSsm(mockedCallbackRecipient, mockedSovereignSecurityManager);

        // Callback should be made on dispute without settlement.
        _expectCallback(assertionId, false);
        _disputeAndGetOracleRequest(assertionId);
        vm.clearMockedCalls();
    }
}

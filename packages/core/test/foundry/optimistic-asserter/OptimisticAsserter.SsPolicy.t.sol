// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "./Common.sol";

contract SovereignSecurityPolicyEnforced is Common {
    function setUp() public {
        _commonSetup();

        // Fund Account1 for making assertion.
        vm.startPrank(TestAddress.account1);
        defaultCurrency.allocateTo(TestAddress.account1, defaultBond);
        defaultCurrency.approve(address(optimisticAsserter), defaultBond);
        vm.stopPrank();
    }

    function testDefaultPolicy() public {
        vm.prank(TestAddress.account1);
        bytes32 assertionId = optimisticAsserter.assertTruth(trueClaimAssertion);
        OptimisticAsserterInterface.Assertion memory assertion = optimisticAsserter.getAssertion(assertionId);
        assertTrue(assertion.ssSettings.useDisputeResolution);
        assertTrue(assertion.ssSettings.useDvmAsOracle);
        assertFalse(assertion.ssSettings.validateDisputers);
    }

    function test_RevertIf_AssertionBlocked() public {
        // Block any assertion.
        _mockSsPolicy(false, true, true, false);

        vm.expectRevert("Assertion not allowed");
        _assertWithCallbackRecipientAndSs(address(0), mockedSovereignSecurity);
        vm.clearMockedCalls();
    }

    function test_DisableDvmAsOracle() public {
        // Use SS as oracle.
        _mockSsPolicy(true, false, true, false);
        _mockSsDisputerCheck(true);

        bytes32 assertionId = _assertWithCallbackRecipientAndSs(address(0), mockedSovereignSecurity);
        OptimisticAsserterInterface.Assertion memory assertion = optimisticAsserter.getAssertion(assertionId);
        assertFalse(assertion.ssSettings.useDvmAsOracle);

        // Dispute, mock resolve assertion truethful through SS as Oracle and verify on Optimistic Asserter.
        OracleRequest memory oracleRequest = _disputeAndGetOracleRequest(assertionId, defaultBond);
        _mockOracleResolved(mockedSovereignSecurity, oracleRequest, true);

        // As we are not using the DVM as the arbitration oracle the "winner" of the dispute should get back 2x the bond
        // and nothing should be burnt.
        uint256 proposerBalanceBeforeSettle = defaultCurrency.balanceOf(TestAddress.account1);
        uint256 storeBalanceBeforeSettle = defaultCurrency.balanceOf(address(store));

        assertTrue(optimisticAsserter.settleAndGetAssertionResult(assertionId));

        assertTrue(defaultCurrency.balanceOf(TestAddress.account1) - proposerBalanceBeforeSettle == defaultBond * 2);
        assertTrue(defaultCurrency.balanceOf(address(store)) == storeBalanceBeforeSettle);
        vm.clearMockedCalls();
    }

    function test_DisregardOracle() public {
        // Do not respect Oracle on dispute.
        _mockSsPolicy(true, true, false, false);
        _mockSsDisputerCheck(true);

        bytes32 assertionId = _assertWithCallbackRecipientAndSs(address(0), mockedSovereignSecurity);
        OptimisticAsserterInterface.Assertion memory assertion = optimisticAsserter.getAssertion(assertionId);
        assertFalse(assertion.ssSettings.useDisputeResolution);

        // Dispute should make assertion false available immediately.
        OracleRequest memory oracleRequest = _disputeAndGetOracleRequest(assertionId, defaultBond);
        assertFalse(optimisticAsserter.getAssertionResult(assertionId));

        // Mock resolve assertion truethful through Oracle and verify it is settled false on Optimistic Asserter.
        _mockOracleResolved(address(mockOracle), oracleRequest, true);
        assertFalse(optimisticAsserter.settleAndGetAssertionResult(assertionId));
        vm.clearMockedCalls();
    }

    function test_DoNotValidateDisputers() public {
        // Deafault SS policy do not validate disputers.
        _mockSsPolicy(true, true, true, false);

        bytes32 assertionId = _assertWithCallbackRecipientAndSs(address(0), mockedSovereignSecurity);

        _disputeAndGetOracleRequest(assertionId, defaultBond);
        vm.clearMockedCalls();
    }

    function test_ValidateAndAllowDispute() public {
        // Validate disputers in SS policy and allow disputes.
        _mockSsPolicy(true, true, true, true);
        _mockSsDisputerCheck(true);

        bytes32 assertionId = _assertWithCallbackRecipientAndSs(address(0), mockedSovereignSecurity);

        _disputeAndGetOracleRequest(assertionId, defaultBond);
        vm.clearMockedCalls();
    }

    function test_RevertIf_DisputeNotAllowed() public {
        // Validate disputers in SS policy and disallow disputes.
        _mockSsPolicy(true, true, true, true);
        _mockSsDisputerCheck(false);

        bytes32 assertionId = _assertWithCallbackRecipientAndSs(address(0), mockedSovereignSecurity);

        // Fund Account2 for making dispute.
        vm.startPrank(TestAddress.account2);
        defaultCurrency.allocateTo(TestAddress.account2, defaultBond);
        defaultCurrency.approve(address(optimisticAsserter), defaultBond);

        vm.expectRevert("Dispute not allowed");
        optimisticAsserter.disputeAssertionFor(assertionId, TestAddress.account2);
        vm.stopPrank();
        vm.clearMockedCalls();
    }
}

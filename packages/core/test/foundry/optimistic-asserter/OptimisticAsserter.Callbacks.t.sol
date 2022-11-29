// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "./Common.sol";

contract OptimisticAsserterCallbacks is Common {
    function setUp() public {
        _commonSetup();

        // Fund Account1 for making assertion.
        vm.startPrank(TestAddress.account1);
        defaultCurrency.allocateTo(TestAddress.account1, defaultBond);
        defaultCurrency.approve(address(optimisticAsserter), defaultBond);
        vm.stopPrank();

        // Mocked callback recipiend code size should be > 0.
        vm.etch(mockedCallbackRecipient, new bytes(1));
    }

    function test_CallbackRecipientOnExpired() public {
        // Assert with callback recipient.
        bytes32 assertionId = _assertWithCallbackRecipientAndSs(mockedCallbackRecipient, address(0));

        // Move time forward to the end of the liveness period.
        timer.setCurrentTime(timer.getCurrentTime() + defaultLiveness);

        // Settlement should trigger callback with asserted truthfully.
        _expectAssertionResolvedCallback(mockedCallbackRecipient, assertionId, true);
        optimisticAsserter.settleAndGetAssertionResult(assertionId);
    }

    function test_CallbackSovereignSecurityOnExpired() public {
        // Deafault SS policies.
        _mockSsPolicy(true, true, true, false);

        // Assert with Sovereign Security without a dedicated callback recipient.
        bytes32 assertionId = _assertWithCallbackRecipientAndSs(address(0), mockedSovereignSecurity);

        // Move time forward to the end of the liveness period.
        timer.setCurrentTime(timer.getCurrentTime() + defaultLiveness);

        // Settlement should trigger callback with asserted truthfully.
        _expectAssertionResolvedCallback(mockedSovereignSecurity, assertionId, true);
        optimisticAsserter.settleAndGetAssertionResult(assertionId);
    }

    function test_CallbackRecipientOnResolvedTruth() public {
        // Assert with callback recipient.
        bytes32 assertionId = _assertWithCallbackRecipientAndSs(mockedCallbackRecipient, address(0));

        // Dispute and verify on dispute callback.
        _expectAssertionDisputedCallback(mockedCallbackRecipient, assertionId);
        OracleRequest memory oracleRequest = _disputeAndGetOracleRequest(assertionId, defaultBond);

        // Mock resolve assertion truethful through Oracle and verify on resolve callback to Recipient.
        _mockOracleResolved(address(mockOracle), oracleRequest, true);
        _expectAssertionResolvedCallback(mockedCallbackRecipient, assertionId, true);
        optimisticAsserter.settleAndGetAssertionResult(assertionId);
        vm.clearMockedCalls();
    }

    function test_CallbackSovereignSecurityOnResolvedTruth() public {
        // Deafault SS policies.
        _mockSsPolicy(true, true, true, false);

        // Assert with Sovereign Security without a dedicated callback recipient.
        bytes32 assertionId = _assertWithCallbackRecipientAndSs(address(0), mockedSovereignSecurity);

        // Dispute and verify on dispute callback.
        _expectAssertionDisputedCallback(mockedSovereignSecurity, assertionId);
        OracleRequest memory oracleRequest = _disputeAndGetOracleRequest(assertionId, defaultBond);

        // Mock resolve assertion truethful through Oracle and verify on resolve callback to SS.
        _mockOracleResolved(address(mockOracle), oracleRequest, true);
        _expectAssertionResolvedCallback(mockedSovereignSecurity, assertionId, true);
        optimisticAsserter.settleAndGetAssertionResult(assertionId);
        vm.clearMockedCalls();
    }

    function test_CallbackRecipientOnResolvedFalse() public {
        // Assert with callback recipient.
        bytes32 assertionId = _assertWithCallbackRecipientAndSs(mockedCallbackRecipient, address(0));

        // Dispute and verify on dispute callback.
        _expectAssertionDisputedCallback(mockedCallbackRecipient, assertionId);
        OracleRequest memory oracleRequest = _disputeAndGetOracleRequest(assertionId, defaultBond);

        // Mock resolve assertion false through Oracle and verify on resolve callback to Recipient.
        _mockOracleResolved(address(mockOracle), oracleRequest, false);
        _expectAssertionResolvedCallback(mockedCallbackRecipient, assertionId, false);
        optimisticAsserter.settleAndGetAssertionResult(assertionId);
        vm.clearMockedCalls();
    }

    function test_CallbackSovereignSecurityOnResolvedFalse() public {
        // Deafault SS policies.
        _mockSsPolicy(true, true, true, false);

        // Assert with callback recipient.
        bytes32 assertionId = _assertWithCallbackRecipientAndSs(address(0), mockedSovereignSecurity);

        // Dispute and verify on dispute callback.
        _expectAssertionDisputedCallback(mockedSovereignSecurity, assertionId);
        OracleRequest memory oracleRequest = _disputeAndGetOracleRequest(assertionId, defaultBond);

        // Mock resolve assertion false through Oracle and verify on resolve callback to SS.
        _mockOracleResolved(address(mockOracle), oracleRequest, false);
        _expectAssertionResolvedCallback(mockedSovereignSecurity, assertionId, false);
        optimisticAsserter.settleAndGetAssertionResult(assertionId);
        vm.clearMockedCalls();
    }

    function test_CallbacksOnDispute() public {
        // Assert with callback recipient and not respecting Oracle.
        _mockSsPolicy(true, true, false, false);
        _mockSsDisputerCheck(true);

        bytes32 assertionId = _assertWithCallbackRecipientAndSs(mockedCallbackRecipient, mockedSovereignSecurity);

        // Dispute callback should be triggered both on callback recipient and SS.
        _expectAssertionDisputedCallback(mockedCallbackRecipient, assertionId);
        _expectAssertionDisputedCallback(mockedSovereignSecurity, assertionId);

        // Resolve callback should be made on dispute without settlement both on callback recipient and SS.
        _expectAssertionResolvedCallback(mockedCallbackRecipient, assertionId, false);
        _expectAssertionResolvedCallback(mockedSovereignSecurity, assertionId, false);

        _disputeAndGetOracleRequest(assertionId, defaultBond);
        vm.clearMockedCalls();
    }
}

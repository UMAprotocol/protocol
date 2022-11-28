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

    function test_CallbackOnExpired() public {
        // Assert with callback recipient.
        bytes32 assertionId = _assertWithCallbackRecipientAndSs(mockedCallbackRecipient, address(0));

        // Move time forward to the end of the liveness period.
        timer.setCurrentTime(timer.getCurrentTime() + defaultLiveness);

        // Settlement should trigger callback with asserted truthfully.
        _expectAssertionResolvedCallback(assertionId, true);
        optimisticAsserter.settleAndGetAssertion(assertionId);
    }

    function test_CallbackOnResolvedTruth() public {
        // Assert with callback recipient.
        bytes32 assertionId = _assertWithCallbackRecipientAndSs(mockedCallbackRecipient, address(0));

        // Dispute and verify on dispute callback.
        _expectAssertionDisputedCallback(assertionId);
        OracleRequest memory oracleRequest = _disputeAndGetOracleRequest(assertionId, defaultBond);

        // Mock resolve assertion truethful through Oracle and verify on resolve callback to Recipient.
        _mockOracleResolved(address(mockOracle), oracleRequest, true);
        _expectAssertionResolvedCallback(assertionId, true);
        optimisticAsserter.settleAndGetAssertion(assertionId);
        vm.clearMockedCalls();
    }

    function test_CallbackOnResolvedFalse() public {
        // Assert with callback recipient.
        bytes32 assertionId = _assertWithCallbackRecipientAndSs(mockedCallbackRecipient, address(0));

        // Dispute and verify on dispute callback.
        _expectAssertionDisputedCallback(assertionId);
        OracleRequest memory oracleRequest = _disputeAndGetOracleRequest(assertionId, defaultBond);

        // Mock resolve assertion false through Oracle and verify on resolve callback to Recipient.
        _mockOracleResolved(address(mockOracle), oracleRequest, false);
        _expectAssertionResolvedCallback(assertionId, false);
        optimisticAsserter.settleAndGetAssertion(assertionId);
        vm.clearMockedCalls();
    }

    function test_CallbackOnDispute() public {
        // Assert with callback recipient and not respecting Oracle.
        _mockSsPolicies(true, true, false, false);
        _mockSsDisputerCheck(true);

        bytes32 assertionId = _assertWithCallbackRecipientAndSs(mockedCallbackRecipient, mockedSovereignSecurity);

        // Dispute callback should be triggered.
        _expectAssertionDisputedCallback(assertionId);
        // Resolve callback should be made on dispute without settlement.
        _expectAssertionResolvedCallback(assertionId, false);
        _disputeAndGetOracleRequest(assertionId, defaultBond);
        vm.clearMockedCalls();
    }
}

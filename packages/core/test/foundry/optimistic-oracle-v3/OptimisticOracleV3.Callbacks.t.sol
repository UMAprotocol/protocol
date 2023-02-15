// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "./CommonOptimisticOracleV3Test.sol";

contract OptimisticOracleV3Callbacks is CommonOptimisticOracleV3Test {
    function setUp() public {
        _commonSetup();

        // Fund Account1 for making assertion.
        vm.startPrank(TestAddress.account1);
        defaultCurrency.allocateTo(TestAddress.account1, defaultBond);
        defaultCurrency.approve(address(optimisticOracleV3), defaultBond);
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
        optimisticOracleV3.settleAndGetAssertionResult(assertionId);
    }

    function test_CallbackEscalationManagerOnExpired() public {
        // Deafault SS policies.
        _mockSsPolicy(false, false, false, false);

        // Assert with Sovereign Security without a dedicated callback recipient.
        bytes32 assertionId = _assertWithCallbackRecipientAndSs(address(0), mockedEscalationManager);

        // Move time forward to the end of the liveness period.
        timer.setCurrentTime(timer.getCurrentTime() + defaultLiveness);

        // Settlement should trigger callback with asserted truthfully.
        _expectAssertionResolvedCallback(mockedEscalationManager, assertionId, true);
        optimisticOracleV3.settleAndGetAssertionResult(assertionId);
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
        optimisticOracleV3.settleAndGetAssertionResult(assertionId);
        vm.clearMockedCalls();
    }

    function test_CallbackEscalationManagerOnResolvedTruth() public {
        // Deafault SS policies.
        _mockSsPolicy(false, false, false, false);

        // Assert with Sovereign Security without a dedicated callback recipient.
        bytes32 assertionId = _assertWithCallbackRecipientAndSs(address(0), mockedEscalationManager);

        // Dispute and verify on dispute callback.
        _expectAssertionDisputedCallback(mockedEscalationManager, assertionId);
        OracleRequest memory oracleRequest = _disputeAndGetOracleRequest(assertionId, defaultBond);

        // Mock resolve assertion truethful through Oracle and verify on resolve callback to SS.
        _mockOracleResolved(address(mockOracle), oracleRequest, true);
        _expectAssertionResolvedCallback(mockedEscalationManager, assertionId, true);
        optimisticOracleV3.settleAndGetAssertionResult(assertionId);
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
        optimisticOracleV3.settleAndGetAssertionResult(assertionId);
        vm.clearMockedCalls();
    }

    function test_CallbackEscalationManagerOnResolvedFalse() public {
        // Deafault SS policies.
        _mockSsPolicy(false, false, false, false);

        // Assert with callback recipient.
        bytes32 assertionId = _assertWithCallbackRecipientAndSs(address(0), mockedEscalationManager);

        // Dispute and verify on dispute callback.
        _expectAssertionDisputedCallback(mockedEscalationManager, assertionId);
        OracleRequest memory oracleRequest = _disputeAndGetOracleRequest(assertionId, defaultBond);

        // Mock resolve assertion false through Oracle and verify on resolve callback to SS.
        _mockOracleResolved(address(mockOracle), oracleRequest, false);
        _expectAssertionResolvedCallback(mockedEscalationManager, assertionId, false);
        optimisticOracleV3.settleAndGetAssertionResult(assertionId);
        vm.clearMockedCalls();
    }

    function test_CallbacksOnDispute() public {
        // Assert with callback recipient and not respecting Oracle.
        _mockSsPolicy(false, false, true, false);
        _mockSsDisputerCheck(true);

        bytes32 assertionId = _assertWithCallbackRecipientAndSs(mockedCallbackRecipient, mockedEscalationManager);

        // Dispute callback should be triggered both on callback recipient and SS.
        _expectAssertionDisputedCallback(mockedCallbackRecipient, assertionId);
        _expectAssertionDisputedCallback(mockedEscalationManager, assertionId);

        // Resolve callback should be made on dispute without settlement both on callback recipient and SS.
        _expectAssertionResolvedCallback(mockedCallbackRecipient, assertionId, false);
        _expectAssertionResolvedCallback(mockedEscalationManager, assertionId, false);

        _disputeAndGetOracleRequest(assertionId, defaultBond);
        vm.clearMockedCalls();
    }
}

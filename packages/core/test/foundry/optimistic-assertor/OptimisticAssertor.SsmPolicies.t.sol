// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "../fixtures/optimistic-assertor/OptimisticAssertorFixture.sol";
import "../fixtures/common/TestAddress.sol";
import "../../../contracts/oracle/test/MockOracleAncillary.sol";

contract SovereignSecurityManagerPoliciesEnforced is Test {
    struct OracleRequest {
        bytes32 identifier;
        uint256 time;
        bytes ancillaryData;
    }

    OptimisticAssertor optimisticAssertor;
    MockOracleAncillary mockOracle;
    address mockedSovereignSecurityManager = address(0xff);
    address mockedCallbackRecipient = address(0xfe);
    TestnetERC20 defaultCurrency;
    Timer timer;
    uint256 defaultBond;
    uint256 defaultLiveness;
    string claimAssertion = 'q:"The sky is blue"';

    event AssertionSettled(
        bytes32 indexed assertionId,
        address indexed bondRecipient,
        bool disputed,
        bool settlementResolution
    );

    function setUp() public {
        OptimisticAssertorFixture.OptimisticAsserterContracts memory oaContracts =
            new OptimisticAssertorFixture().setUp();
        optimisticAssertor = oaContracts.optimisticAssertor;
        mockOracle = oaContracts.mockOracle;
        defaultCurrency = oaContracts.defaultCurrency;
        timer = oaContracts.timer;
        defaultBond = optimisticAssertor.defaultBond();
        defaultLiveness = optimisticAssertor.defaultLiveness();

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
        bytes32 assertionId = optimisticAssertor.assertTruth(bytes(claimAssertion));
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
        vm.expectEmit(true, true, true, true);
        emit AssertionSettled(assertionId, TestAddress.account1, true, false);
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
        bytes32 assertionId =
            _assertWithCallbackRecipientAndSsm(mockedCallbackRecipient, mockedSovereignSecurityManager);

        // Dispute callback should be triggered.
        _expectAssertionDisputedCallback(assertionId);
        // Resolve callback should be made on dispute without settlement.
        _expectAssertionResolvedCallback(assertionId, false);
        _disputeAndGetOracleRequest(assertionId);
        vm.clearMockedCalls();
    }

    function _mockSsmPolicies(
        bool allowAssertion,
        bool useDvmAsOracle,
        bool useDisputeResolution
    ) internal {
        // Mock getAssertionPolicies call to block assertion. No need to pass assertionId as mockCall uses loose matching.
        vm.mockCall(
            mockedSovereignSecurityManager,
            abi.encodePacked(SovereignSecurityManagerInterface.getAssertionPolicies.selector),
            abi.encode(
                SovereignSecurityManagerInterface.AssertionPolicies({
                    allowAssertion: allowAssertion,
                    useDvmAsOracle: useDvmAsOracle,
                    useDisputeResolution: useDisputeResolution
                })
            )
        );
    }

    function _mockOracleResolved(
        address oracle,
        OracleRequest memory oracleRequest,
        bool assertionTruthful
    ) internal {
        // Mock getPrice call based on desired response. Also works on Sovereign Security Manager.
        vm.mockCall(
            oracle,
            abi.encodeWithSelector(
                MockOracleAncillary.getPrice.selector,
                oracleRequest.identifier,
                oracleRequest.time,
                oracleRequest.ancillaryData
            ),
            abi.encode(assertionTruthful ? int256(1e18) : int256(0))
        );
    }

    function _assertWithCallbackRecipientAndSsm(address callbackRecipient, address sovereignSecurityManager)
        internal
        returns (bytes32)
    {
        vm.prank(TestAddress.account1);
        return
            optimisticAssertor.assertTruthFor(
                bytes(claimAssertion),
                address(0),
                callbackRecipient,
                sovereignSecurityManager,
                defaultCurrency,
                defaultBond,
                defaultLiveness
            );
    }

    function _disputeAndGetOracleRequest(bytes32 assertionId) internal returns (OracleRequest memory) {
        // Get expected oracle request on dispute.
        OptimisticAssertorInterface.Assertion memory assertion = optimisticAssertor.readAssertion(assertionId);
        OracleRequest memory oracleRequest =
            OracleRequest({
                identifier: optimisticAssertor.identifier(),
                time: assertion.assertionTime,
                ancillaryData: optimisticAssertor.stampAssertion(assertionId)
            });

        // Fund Account2 and make dispute.
        vm.startPrank(TestAddress.account2);
        defaultCurrency.allocateTo(TestAddress.account2, optimisticAssertor.defaultBond());
        defaultCurrency.approve(address(optimisticAssertor), optimisticAssertor.defaultBond());
        optimisticAssertor.disputeAssertionFor(assertionId, TestAddress.account2);
        vm.stopPrank();
        return oracleRequest;
    }

    function _expectAssertionResolvedCallback(bytes32 assertionId, bool assertedTruthfully) internal {
        vm.expectCall(
            mockedCallbackRecipient,
            abi.encodeWithSelector(
                OptimisticAsserterCallbackRecipientInterface.assertionResolved.selector,
                assertionId,
                assertedTruthfully
            )
        );
    }

    function _expectAssertionDisputedCallback(bytes32 assertionId) internal {
        vm.expectCall(
            mockedCallbackRecipient,
            abi.encodeWithSelector(OptimisticAsserterCallbackRecipientInterface.assertionDisputed.selector, assertionId)
        );
    }
}

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
    TestnetERC20 defaultCurrency;
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
        defaultBond = optimisticAssertor.defaultBond();
        defaultLiveness = optimisticAssertor.defaultLiveness();

        // Fund Account1 for making assertion.
        vm.startPrank(TestAddress.account1);
        defaultCurrency.allocateTo(TestAddress.account1, optimisticAssertor.defaultBond());
        defaultCurrency.approve(address(optimisticAssertor), optimisticAssertor.defaultBond());
        vm.stopPrank();
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
        _assertWithSsm();
        vm.clearMockedCalls();
    }

    function test_DisableDvmAsOracle() public {
        // Use SSM as oracle.
        _mockSsmPolicies(true, false, true);

        bytes32 assertionId = _assertWithSsm();
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

        bytes32 assertionId = _assertWithSsm();
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

    function _mockSsmPolicies(
        bool allowAssertion,
        bool useDvmAsOracle,
        bool useDisputeResolution
    ) internal {
        // Mock processAssertionPolicies call to block assertion. No need to pass assertionId as mockCall uses loose matching.
        vm.mockCall(
            mockedSovereignSecurityManager,
            abi.encodePacked(SovereignSecurityManagerInterface.processAssertionPolicies.selector),
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

    function _assertWithSsm() internal returns (bytes32) {
        vm.prank(TestAddress.account1);
        return
            optimisticAssertor.assertTruthFor(
                bytes(claimAssertion),
                address(0),
                address(0),
                mockedSovereignSecurityManager,
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
}

// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../CommonOptimisticOracleV3Test.sol";
import "../../../../contracts/optimistic-oracle-v3/implementation/escalation-manager/FullPolicyEscalationManager.sol";

contract FullPolicyEscalationManagerTest is CommonOptimisticOracleV3Test {
    FullPolicyEscalationManager escalationManager;
    bytes32 assertionId = bytes32(0);

    function setUp() public {
        escalationManager = new FullPolicyEscalationManager(address(mockOptimisticOracleV3Address));
    }

    function test_SetArbitrateResolution() public {
        bytes32 identifier = "test";
        uint256 time = 123;
        bytes memory ancillaryData = "ancillary";

        vm.expectRevert("Arbitration resolution not set");

        escalationManager.getPrice(identifier, time, ancillaryData);
        escalationManager.setArbitrationResolution(identifier, time, ancillaryData, true);
        assertTrue(escalationManager.getPrice(identifier, time, ancillaryData) == 1e18);

        vm.expectRevert("Arbitration already resolved"); // Can not re-set the resolution price once set.
        escalationManager.setArbitrationResolution(identifier, time, ancillaryData, false);

        escalationManager.setArbitrationResolution(identifier, time + 1, ancillaryData, false); // Can set for new time.
        assertTrue(escalationManager.getPrice(identifier, time + 1, ancillaryData) == 0);
    }

    function test_RevertIf_InvalidConfiguration() public {
        vm.expectRevert("Cannot block only by asserter");
        escalationManager.configureEscalationManager(false, true, true, true, true);
    }

    function test_ConfigureEscalationManager() public {
        _mockGetAssertion(assertionId, TestAddress.account1, TestAddress.account1);
        FullPolicyEscalationManager.AssertionPolicy memory policy = escalationManager.getAssertionPolicy(assertionId);
        assertFalse(policy.blockAssertion);
        assertFalse(policy.arbitrateViaEscalationManager);
        assertFalse(policy.discardOracle);
        assertFalse(policy.validateDisputers);

        escalationManager.configureEscalationManager(true, false, true, true, true);
        _mockGetAssertion(assertionId, TestAddress.account1, TestAddress.account1);
        policy = escalationManager.getAssertionPolicy(assertionId);

        assertTrue(policy.blockAssertion);
        assertTrue(policy.arbitrateViaEscalationManager);
        assertTrue(policy.discardOracle);
        assertTrue(policy.validateDisputers);
    }

    function test_BlockByAssertingCaller() public {
        escalationManager.configureEscalationManager(true, false, true, true, true);
        _mockGetAssertion(assertionId, TestAddress.account1, TestAddress.account1);
        FullPolicyEscalationManager.AssertionPolicy memory policy = escalationManager.getAssertionPolicy(assertionId);

        assertTrue(policy.blockAssertion);

        escalationManager.setWhitelistedAssertingCallers(TestAddress.account1, true);
        _mockGetAssertion(assertionId, TestAddress.account1, TestAddress.account1);
        policy = escalationManager.getAssertionPolicy(assertionId);

        assertFalse(policy.blockAssertion);
    }

    function test_BlockByAssertingCallerAndAsserter() public {
        escalationManager.configureEscalationManager(true, true, true, true, true);
        _mockGetAssertion(assertionId, TestAddress.account1, TestAddress.account1);
        FullPolicyEscalationManager.AssertionPolicy memory policy = escalationManager.getAssertionPolicy(assertionId);

        assertTrue(policy.blockAssertion);

        escalationManager.setWhitelistedAssertingCallers(TestAddress.account1, true);
        _mockGetAssertion(assertionId, TestAddress.account1, TestAddress.account1);
        policy = escalationManager.getAssertionPolicy(assertionId);

        assertTrue(policy.blockAssertion);

        escalationManager.setWhitelistedAsserters(TestAddress.account1, true);
        _mockGetAssertion(assertionId, TestAddress.account1, TestAddress.account1);
        policy = escalationManager.getAssertionPolicy(assertionId);

        assertFalse(policy.blockAssertion);
    }

    function test_DisputeCallerNotOnWhitelist() public {
        // If the dispute caller is not whitelisted, then the dispute should not be allowed.
        assertFalse(escalationManager.isDisputeAllowed(bytes32(0), TestAddress.account2));
    }

    function test_DisputeCallerOnWhitelist() public {
        // If the dispute caller is whitelisted, then the dispute should be allowed.
        escalationManager.setDisputeCallerInWhitelist(TestAddress.account2, true);
        assertTrue(escalationManager.isDisputeAllowed(bytes32(0), TestAddress.account2));
    }

    function test_RevertIf_NotOwner() public {
        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(TestAddress.account1);
        escalationManager.configureEscalationManager(true, true, true, true, true);

        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(TestAddress.account1);
        escalationManager.setArbitrationResolution(bytes32(""), 0, bytes(""), false);

        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(TestAddress.account1);
        escalationManager.setWhitelistedAsserters(TestAddress.account1, true);

        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(TestAddress.account1);
        escalationManager.setWhitelistedAssertingCallers(TestAddress.account1, true);
    }

    function _mockGetAssertion(
        bytes32 assertionId,
        address asserter,
        address assertingCaller
    ) internal {
        OptimisticOracleV3Interface.Assertion memory assertion;
        assertion.asserter = asserter;
        assertion.escalationManagerSettings.assertingCaller = assertingCaller;
        vm.mockCall(
            mockOptimisticOracleV3Address,
            abi.encodeWithSelector(OptimisticOracleV3Interface.getAssertion.selector, assertionId),
            abi.encode(assertion)
        );
    }
}

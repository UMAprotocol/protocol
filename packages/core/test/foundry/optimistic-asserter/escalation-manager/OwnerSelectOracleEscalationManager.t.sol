// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "../CommonOptimisticAsserterTestSetup.sol";
import "../../../../contracts/optimistic-asserter/implementation/escalation-manager/OwnerSelectOracleEscalationManager.sol";

contract OwnerSelectOracleEscalationManagerTest is CommonOptimisticAsserterTestSetup {
    OwnerSelectOracleEscalationManager escalationManager;

    function setUp() public {
        escalationManager = new OwnerSelectOracleEscalationManager();
    }

    function test_SetArbitrateResolution() public {
        bytes32 identifier = "test";
        uint256 time = 123;
        bytes memory ancillaryData = "ancillary";

        vm.expectRevert("Arbitration resolution not set");
        escalationManager.getPrice(identifier, time, ancillaryData);

        escalationManager.setArbitrationResolution(identifier, time, ancillaryData, true);
        assertTrue(escalationManager.getPrice(identifier, time, ancillaryData) == 1e18);

        escalationManager.setArbitrationResolution(identifier, time, ancillaryData, false);
        assertTrue(escalationManager.getPrice(identifier, time, ancillaryData) == 0);
    }

    function test_SetArbitrateViaSs() public {
        OwnerSelectOracleEscalationManager.AssertionPolicy memory policy =
            escalationManager.getAssertionPolicy(bytes32(0));
        assertFalse(policy.blockAssertion);
        assertFalse(policy.arbitrateViaEscalationManager);
        assertFalse(policy.discardOracle);
        assertFalse(policy.validateDisputers);

        escalationManager.setArbitrateViaSs(true);
        policy = escalationManager.getAssertionPolicy(bytes32(0));

        assertFalse(policy.blockAssertion);
        assertTrue(policy.arbitrateViaEscalationManager);
        assertFalse(policy.discardOracle);
        assertFalse(policy.validateDisputers);
    }

    function test_RevertIf_NotOwner() public {
        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(TestAddress.account1);
        escalationManager.setArbitrateViaSs(true);

        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(TestAddress.account1);
        escalationManager.setArbitrationResolution(bytes32(""), 0, bytes(""), false);
    }
}

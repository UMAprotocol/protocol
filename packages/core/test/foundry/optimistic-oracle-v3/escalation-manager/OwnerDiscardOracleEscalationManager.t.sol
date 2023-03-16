// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../CommonOptimisticOracleV3Test.sol";
import "../../../../contracts/optimistic-oracle-v3/implementation/escalation-manager/OwnerDiscardOracleEscalationManager.sol";

contract OwnerDiscardOracleEscalationManagerTest is CommonOptimisticOracleV3Test {
    OwnerDiscardOracleEscalationManager escalationManager;

    function setUp() public {
        escalationManager = new OwnerDiscardOracleEscalationManager(address(optimisticOracleV3));
    }

    function test_SetDiscardOracle() public {
        OwnerDiscardOracleEscalationManager.AssertionPolicy memory policy =
            escalationManager.getAssertionPolicy(bytes32(0));
        assertFalse(policy.blockAssertion);
        assertFalse(policy.arbitrateViaEscalationManager);
        assertFalse(policy.discardOracle);
        assertFalse(policy.validateDisputers);

        escalationManager.setDiscardOracle(true);
        policy = escalationManager.getAssertionPolicy(bytes32(0));

        assertFalse(policy.blockAssertion);
        assertFalse(policy.arbitrateViaEscalationManager);
        assertTrue(policy.discardOracle);
        assertFalse(policy.validateDisputers);
    }

    function test_RevertIf_NotOwner() public {
        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(TestAddress.account1);
        escalationManager.setDiscardOracle(true);
    }
}

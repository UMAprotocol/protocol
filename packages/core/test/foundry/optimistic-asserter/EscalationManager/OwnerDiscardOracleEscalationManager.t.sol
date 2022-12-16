// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "../Common.sol";
import "../../../../contracts/optimistic-asserter/implementation/escalation-manager/OwnerDiscardOracleEscalationManager.sol";

contract OwnerDiscardOracleEscalationManagerTest is Common {
    OwnerDiscardOracleEscalationManager escalationManager;

    function setUp() public {
        escalationManager = new OwnerDiscardOracleEscalationManager();
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

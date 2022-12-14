// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "../CommonOptimisticAsserterTestSetup.sol";
import "../../../../contracts/optimistic-asserter/implementation/escalation-manager/WhitelistDisputerEscalationManager.sol";

contract WhitelistDisputerEscalationManagerTest is CommonOptimisticAsserterTestSetup {
    WhitelistDisputerEscalationManager escalationManager;

    function setUp() public {
        escalationManager = new WhitelistDisputerEscalationManager();
    }

    function test_RevertIf_NotOwner() public {
        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(TestAddress.account2);
        escalationManager.setDisputeCallerInWhitelist(TestAddress.account2, true);
    }

    function test_DisputeCallerNotOnWhitelist() public {
        // If the dispute caller is not whitelisted, then the dispute should not be allowed.
        vm.prank(mockOptimisticAsserterAddress);
        assertFalse(escalationManager.isDisputeAllowed(bytes32(0), TestAddress.account2));
    }

    function test_DisputeCallerOnWhitelist() public {
        // If the dispute caller is whitelisted, then the dispute should be allowed.
        escalationManager.setDisputeCallerInWhitelist(TestAddress.account2, true);
        vm.prank(mockOptimisticAsserterAddress);
        assertTrue(escalationManager.isDisputeAllowed(bytes32(0), TestAddress.account2));
    }
}

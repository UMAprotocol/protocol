// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "../Common.sol";
import "../../../../contracts/optimistic-assertor/implementation/sovereign-security-manager/WhitelistDisputerSovereignSecurityManager.sol";

contract WhitelistDisputerSovereignSecurityManagerTest is Common {
    WhitelistDisputerSovereignSecurityManager ssm;

    function setUp() public {
        ssm = new WhitelistDisputerSovereignSecurityManager();
    }

    function test_RevertIf_NotOwner() public {
        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(TestAddress.account2);
        ssm.setDisputeCallerInWhitelist(TestAddress.account2, true);
    }

    function test_DisputeCallerNotOnWhitelist() public {
        // If the dispute caller is not whitelisted, then the dispute should not be allowed.
        vm.prank(mockOptimisticAssertorAddress);
        assertFalse(ssm.isDisputeAllowed(bytes32(0), TestAddress.account2));
    }

    function test_DisputeCallerOnWhitelist() public {
        // If the dispute caller is whitelisted, then the dispute should be allowed.
        ssm.setDisputeCallerInWhitelist(TestAddress.account2, true);
        vm.prank(mockOptimisticAssertorAddress);
        assertTrue(ssm.isDisputeAllowed(bytes32(0), TestAddress.account2));
    }
}

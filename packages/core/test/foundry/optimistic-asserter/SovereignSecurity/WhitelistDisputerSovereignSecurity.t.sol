// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "../Common.sol";
import "../../../../contracts/optimistic-asserter/implementation/sovereign-security/WhitelistDisputerSovereignSecurity.sol";

contract WhitelistDisputerSovereignSecurityTest is Common {
    WhitelistDisputerSovereignSecurity ss;

    function setUp() public {
        ss = new WhitelistDisputerSovereignSecurity();
    }

    function test_RevertIf_NotOwner() public {
        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(TestAddress.account2);
        ss.setDisputeCallerInWhitelist(TestAddress.account2, true);
    }

    function test_DisputeCallerNotOnWhitelist() public {
        // If the dispute caller is not whitelisted, then the dispute should not be allowed.
        vm.prank(mockOptimisticAsserterAddress);
        assertFalse(ss.isDisputeAllowed(bytes32(0), TestAddress.account2));
    }

    function test_DisputeCallerOnWhitelist() public {
        // If the dispute caller is whitelisted, then the dispute should be allowed.
        ss.setDisputeCallerInWhitelist(TestAddress.account2, true);
        vm.prank(mockOptimisticAsserterAddress);
        assertTrue(ss.isDisputeAllowed(bytes32(0), TestAddress.account2));
    }
}

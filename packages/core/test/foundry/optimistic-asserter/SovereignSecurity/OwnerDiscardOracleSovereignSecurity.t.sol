// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "../Common.sol";
import "../../../../contracts/optimistic-asserter/implementation/sovereign-security/OwnerDiscardOracleSovereignSecurity.sol";

contract OwnerDiscardOracleSovereignSecurityTest is Common {
    OwnerDiscardOracleSovereignSecurity sovereignSecurity;

    function setUp() public {
        sovereignSecurity = new OwnerDiscardOracleSovereignSecurity();
    }

    function test_SetDiscardOracle() public {
        OwnerDiscardOracleSovereignSecurity.AssertionPolicy memory policy =
            sovereignSecurity.getAssertionPolicy(bytes32(0));
        assertFalse(policy.blockAssertion);
        assertFalse(policy.arbitrateViaSs);
        assertTrue(policy.useDisputeResolution);
        assertFalse(policy.validateDisputers);

        sovereignSecurity.setDiscardOracle(true);
        policy = sovereignSecurity.getAssertionPolicy(bytes32(0));

        assertFalse(policy.blockAssertion);
        assertFalse(policy.arbitrateViaSs);
        assertFalse(policy.useDisputeResolution);
        assertFalse(policy.validateDisputers);
    }

    function test_RevertIf_NotOwner() public {
        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(TestAddress.account1);
        sovereignSecurity.setDiscardOracle(true);
    }
}

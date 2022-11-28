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
        assertTrue(policy.allowAssertion);
        assertTrue(policy.useDvmAsOracle);
        assertTrue(policy.useDisputeResolution);
        assertFalse(policy.validateDisputers);

        sovereignSecurity.setDiscardOracle(true);
        policy = sovereignSecurity.getAssertionPolicy(bytes32(0));

        assertTrue(policy.allowAssertion);
        assertTrue(policy.useDvmAsOracle);
        assertFalse(policy.useDisputeResolution);
        assertFalse(policy.validateDisputers);
    }

    function test_RevertIf_NotOwner() public {
        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(TestAddress.account1);
        sovereignSecurity.setDiscardOracle(true);
    }
}

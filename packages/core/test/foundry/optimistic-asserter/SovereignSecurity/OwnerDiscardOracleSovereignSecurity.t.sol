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
        OwnerDiscardOracleSovereignSecurity.AssertionPolicies memory policies =
            sovereignSecurity.getAssertionPolicies(bytes32(0));
        assertTrue(policies.allowAssertion);
        assertTrue(policies.useDvmAsOracle);
        assertTrue(policies.useDisputeResolution);
        assertFalse(policies.validateDisputers);

        sovereignSecurity.setDiscardOracle(true);
        policies = sovereignSecurity.getAssertionPolicies(bytes32(0));

        assertTrue(policies.allowAssertion);
        assertTrue(policies.useDvmAsOracle);
        assertFalse(policies.useDisputeResolution);
        assertFalse(policies.validateDisputers);
    }

    function test_RevertIf_NotOwner() public {
        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(TestAddress.account1);
        sovereignSecurity.setDiscardOracle(true);
    }
}

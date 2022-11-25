// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "../Common.sol";
import "../../../../contracts/optimistic-asserter/implementation/sovereign-security/OwnerDiscardOracleSovereignSecurity.sol";

contract OwnerDiscardOracleSovereignSecurityTest is Common {
    OwnerDiscardOracleSovereignSecurity ss;

    function setUp() public {
        ss = new OwnerDiscardOracleSovereignSecurity();
    }

    function test_SetDiscardOracle() public {
        OwnerDiscardOracleSovereignSecurity.AssertionPolicies memory policies = ss.getAssertionPolicies(bytes32(0));
        assertTrue(policies.allowAssertion);
        assertTrue(policies.useDvmAsOracle);
        assertTrue(policies.useDisputeResolution);
        assertFalse(policies.validateDisputers);

        ss.setDiscardOracle(true);
        policies = ss.getAssertionPolicies(bytes32(0));

        assertTrue(policies.allowAssertion);
        assertTrue(policies.useDvmAsOracle);
        assertFalse(policies.useDisputeResolution);
        assertFalse(policies.validateDisputers);
    }

    function test_RevertIf_NotOwner() public {
        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(TestAddress.account1);
        ss.setDiscardOracle(true);
    }
}

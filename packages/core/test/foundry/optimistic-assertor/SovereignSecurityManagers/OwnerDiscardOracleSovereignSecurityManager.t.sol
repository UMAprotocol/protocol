// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "../Common.sol";
import "../../../../contracts/optimistic-assertor/implementation/sovereign-security-manager/OwnerDiscardOracleSovereignSecurityManager.sol";

contract OwnerDiscardOracleSovereignSecurityManagerTest is Common {
    OwnerDiscardOracleSovereignSecurityManager ssm;

    function setUp() public {
        ssm = new OwnerDiscardOracleSovereignSecurityManager();
    }

    function test_SetDiscardOracle() public {
        OwnerDiscardOracleSovereignSecurityManager.AssertionPolicies memory policies =
            ssm.processAssertionPolicies(bytes32(0));
        assertTrue(policies.allowAssertion);
        assertTrue(policies.useDvmAsOracle);
        assertTrue(policies.useDisputeResolution);

        ssm.setDiscardOracle(true);
        policies = ssm.processAssertionPolicies(bytes32(0));

        assertTrue(policies.allowAssertion);
        assertTrue(policies.useDvmAsOracle);
        assertFalse(policies.useDisputeResolution);
    }

    function test_RevertIf_NotOwner() public {
        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(TestAddress.account1);
        ssm.setDiscardOracle(true);
    }
}

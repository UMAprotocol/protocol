// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "../Common.sol";
import "../../../../contracts/optimistic-assertor/implementation/sovereign-security-manager/OwnerSelectOracleSovereignSecurityManager.sol";

contract OwnerSelectOracleSovereignSecurityManagerTest is Common {
    OwnerSelectOracleSovereignSecurityManager ssm;

    function setUp() public {
        ssm = new OwnerSelectOracleSovereignSecurityManager();
    }

    function test_SetArbitrateResolution() public {
        bytes32 identifier = "test";
        uint256 time = 123;
        bytes memory ancillaryData = "ancillary";

        vm.expectRevert("Arbitration resolution not set");
        ssm.getPrice(identifier, time, ancillaryData);

        ssm.setArbitrationResolution(identifier, time, ancillaryData, true);
        assertTrue(ssm.getPrice(identifier, time, ancillaryData) == 1e18);

        ssm.setArbitrationResolution(identifier, time, ancillaryData, false);
        assertTrue(ssm.getPrice(identifier, time, ancillaryData) == 0);
    }

    function test_SetArbitrateViaSsm() public {
        OwnerSelectOracleSovereignSecurityManager.AssertionPolicies memory policies =
            ssm.getAssertionPolicies(bytes32(0));
        assertTrue(policies.allowAssertion);
        assertTrue(policies.useDvmAsOracle);
        assertTrue(policies.useDisputeResolution);
        assertFalse(policies.validateDisputers);

        ssm.setArbitrateViaSsm(true);
        policies = ssm.getAssertionPolicies(bytes32(0));

        assertTrue(policies.allowAssertion);
        assertFalse(policies.useDvmAsOracle);
        assertTrue(policies.useDisputeResolution);
        assertFalse(policies.validateDisputers);
    }

    function test_RevertIf_NotOwner() public {
        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(TestAddress.account1);
        ssm.setArbitrateViaSsm(true);

        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(TestAddress.account1);
        ssm.setArbitrationResolution(bytes32(""), 0, bytes(""), false);
    }
}

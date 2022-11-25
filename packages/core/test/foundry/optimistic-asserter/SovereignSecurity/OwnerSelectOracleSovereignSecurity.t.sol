// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "../Common.sol";
import "../../../../contracts/optimistic-asserter/implementation/sovereign-security/OwnerSelectOracleSovereignSecurity.sol";

contract OwnerSelectOracleSovereignSecurityTest is Common {
    OwnerSelectOracleSovereignSecurity ss;

    function setUp() public {
        ss = new OwnerSelectOracleSovereignSecurity();
    }

    function test_SetArbitrateResolution() public {
        bytes32 identifier = "test";
        uint256 time = 123;
        bytes memory ancillaryData = "ancillary";

        vm.expectRevert("Arbitration resolution not set");
        ss.getPrice(identifier, time, ancillaryData);

        ss.setArbitrationResolution(identifier, time, ancillaryData, true);
        assertTrue(ss.getPrice(identifier, time, ancillaryData) == 1e18);

        ss.setArbitrationResolution(identifier, time, ancillaryData, false);
        assertTrue(ss.getPrice(identifier, time, ancillaryData) == 0);
    }

    function test_SetArbitrateViaSs() public {
        OwnerSelectOracleSovereignSecurity.AssertionPolicies memory policies = ss.getAssertionPolicies(bytes32(0));
        assertTrue(policies.allowAssertion);
        assertTrue(policies.useDvmAsOracle);
        assertTrue(policies.useDisputeResolution);
        assertFalse(policies.validateDisputers);

        ss.setArbitrateViaSs(true);
        policies = ss.getAssertionPolicies(bytes32(0));

        assertTrue(policies.allowAssertion);
        assertFalse(policies.useDvmAsOracle);
        assertTrue(policies.useDisputeResolution);
        assertFalse(policies.validateDisputers);
    }

    function test_RevertIf_NotOwner() public {
        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(TestAddress.account1);
        ss.setArbitrateViaSs(true);

        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(TestAddress.account1);
        ss.setArbitrationResolution(bytes32(""), 0, bytes(""), false);
    }
}

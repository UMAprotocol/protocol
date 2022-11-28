// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "../Common.sol";
import "../../../../contracts/optimistic-asserter/implementation/sovereign-security/OwnerSelectOracleSovereignSecurity.sol";

contract OwnerSelectOracleSovereignSecurityTest is Common {
    OwnerSelectOracleSovereignSecurity sovereignSecurity;

    function setUp() public {
        sovereignSecurity = new OwnerSelectOracleSovereignSecurity();
    }

    function test_SetArbitrateResolution() public {
        bytes32 identifier = "test";
        uint256 time = 123;
        bytes memory ancillaryData = "ancillary";

        vm.expectRevert("Arbitration resolution not set");
        sovereignSecurity.getPrice(identifier, time, ancillaryData);

        sovereignSecurity.setArbitrationResolution(identifier, time, ancillaryData, true);
        assertTrue(sovereignSecurity.getPrice(identifier, time, ancillaryData) == 1e18);

        sovereignSecurity.setArbitrationResolution(identifier, time, ancillaryData, false);
        assertTrue(sovereignSecurity.getPrice(identifier, time, ancillaryData) == 0);
    }

    function test_SetArbitrateViaSs() public {
        OwnerSelectOracleSovereignSecurity.AssertionPolicy memory policy =
            sovereignSecurity.getAssertionPolicy(bytes32(0));
        assertFalse(policy.blockAssertion);
        assertTrue(policy.useDvmAsOracle);
        assertTrue(policy.useDisputeResolution);
        assertFalse(policy.validateDisputers);

        sovereignSecurity.setArbitrateViaSs(true);
        policy = sovereignSecurity.getAssertionPolicy(bytes32(0));

        assertFalse(policy.blockAssertion);
        assertFalse(policy.useDvmAsOracle);
        assertTrue(policy.useDisputeResolution);
        assertFalse(policy.validateDisputers);
    }

    function test_RevertIf_NotOwner() public {
        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(TestAddress.account1);
        sovereignSecurity.setArbitrateViaSs(true);

        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(TestAddress.account1);
        sovereignSecurity.setArbitrationResolution(bytes32(""), 0, bytes(""), false);
    }
}

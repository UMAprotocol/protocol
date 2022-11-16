// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "../Common.sol";
import "../../../../contracts/optimistic-assertor/implementation/sovereign-security-manager/BaseSovereignSecurityManager.sol";

contract BaseSovereignSecurityManagerTest is Common {
    BaseSovereignSecurityManager ssm;

    bytes32 identifier = "test";
    uint256 time = 123;
    bytes ancillaryData = "ancillary";

    event PriceRequestAdded(bytes32 indexed identifier, uint256 time, bytes ancillaryData);

    function setUp() public {
        ssm = new BaseSovereignSecurityManager();
    }

    function test_ProcessAssertionPolicies() public {
        BaseSovereignSecurityManager.AssertionPolicies memory policies = ssm.processAssertionPolicies(bytes32(0));
        assertTrue(policies.allowAssertion);
        assertTrue(policies.useDvmAsOracle);
        assertTrue(policies.useDisputeResolution);
    }

    function test_RequestPrice() public {
        vm.expectEmit(true, true, true, true);
        emit PriceRequestAdded(identifier, time, ancillaryData);
        ssm.requestPrice(identifier, time, ancillaryData);
    }

    function test_GetPrice() public {
        int256 price = ssm.getPrice(identifier, time, ancillaryData);
        assertTrue(price == 0);
    }
}

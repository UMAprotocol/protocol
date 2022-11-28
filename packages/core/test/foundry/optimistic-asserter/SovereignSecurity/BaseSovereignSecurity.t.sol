// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "../Common.sol";
import "../../../../contracts/optimistic-asserter/implementation/sovereign-security/BaseSovereignSecurity.sol";

contract BaseSovereignSecurityTest is Common {
    BaseSovereignSecurity sovereignSecurity;

    bytes32 identifier = "test";
    uint256 time = 123;
    bytes ancillaryData = "ancillary";

    event PriceRequestAdded(bytes32 indexed identifier, uint256 time, bytes ancillaryData);

    function setUp() public {
        sovereignSecurity = new BaseSovereignSecurity();
    }

    function test_GetAssertionPolicy() public {
        BaseSovereignSecurity.AssertionPolicy memory policy = sovereignSecurity.getAssertionPolicy(bytes32(0));
        assertTrue(policy.allowAssertion);
        assertTrue(policy.useDvmAsOracle);
        assertTrue(policy.useDisputeResolution);
        assertFalse(policy.validateDisputers);
    }

    function test_IsDisputeAllowed() public {
        assertTrue(sovereignSecurity.isDisputeAllowed(bytes32(0), address(0)));
    }

    function test_RequestPrice() public {
        vm.expectEmit(true, true, true, true);
        emit PriceRequestAdded(identifier, time, ancillaryData);
        sovereignSecurity.requestPrice(identifier, time, ancillaryData);
    }

    function test_GetPrice() public {
        int256 price = sovereignSecurity.getPrice(identifier, time, ancillaryData);
        assertTrue(price == 0);
    }
}

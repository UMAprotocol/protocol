// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "../Common.sol";
import "../../../../contracts/optimistic-asserter/implementation/escalation-manager/BaseEscalationManager.sol";

contract BaseEscalationManagerTest is Common {
    BaseEscalationManager escalationManager;

    bytes32 identifier = "test";
    uint256 time = 123;
    bytes ancillaryData = "ancillary";

    event PriceRequestAdded(bytes32 indexed identifier, uint256 time, bytes ancillaryData);

    function setUp() public {
        escalationManager = new BaseEscalationManager();
    }

    function test_GetAssertionPolicy() public {
        BaseEscalationManager.AssertionPolicy memory policy = escalationManager.getAssertionPolicy(bytes32(0));
        assertFalse(policy.blockAssertion);
        assertFalse(policy.arbitrateViaEscalationManager);
        assertFalse(policy.discardOracle);
        assertFalse(policy.validateDisputers);
    }

    function test_IsDisputeAllowed() public {
        assertTrue(escalationManager.isDisputeAllowed(bytes32(0), address(0)));
    }

    function test_RequestPrice() public {
        vm.expectEmit(true, true, true, true);
        emit PriceRequestAdded(identifier, time, ancillaryData);
        escalationManager.requestPrice(identifier, time, ancillaryData);
    }

    function test_GetPrice() public {
        int256 price = escalationManager.getPrice(identifier, time, ancillaryData);
        assertTrue(price == 0);
    }
}

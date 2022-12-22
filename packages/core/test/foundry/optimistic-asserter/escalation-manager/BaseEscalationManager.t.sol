// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "../CommonOptimisticAsserterTest.sol";
import "../../../../contracts/optimistic-asserter/implementation/escalation-manager/BaseEscalationManager.sol";

contract BaseEscalationManagerTest is CommonOptimisticAsserterTest {
    BaseEscalationManager escalationManager;

    bytes32 identifier = "test";
    uint256 time = 123;
    bytes ancillaryData = "ancillary";

    event PriceRequestAdded(bytes32 indexed identifier, uint256 time, bytes ancillaryData);

    function setUp() public {
        escalationManager = new BaseEscalationManager(address(optimisticAsserter));
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
        vm.prank(address(optimisticAsserter));
        escalationManager.requestPrice(identifier, time, ancillaryData);
    }

    function test_GetPrice() public {
        int256 price = escalationManager.getPrice(identifier, time, ancillaryData);
        assertTrue(price == 0);
    }

    function test_RevertIf_NotOptimisticAsserter() public {
        vm.expectRevert("Not the optimistic asserter");
        escalationManager.requestPrice(identifier, time, ancillaryData);

        vm.expectRevert("Not the optimistic asserter");
        escalationManager.assertionResolvedCallback(bytes32(0), true);

        vm.expectRevert("Not the optimistic asserter");
        escalationManager.assertionDisputedCallback(bytes32(0));
    }
}

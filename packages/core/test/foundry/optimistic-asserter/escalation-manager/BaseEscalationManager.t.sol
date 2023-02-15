// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../CommonOptimisticOracleV3Test.sol";
import "../../../../contracts/optimistic-oracle-v3/implementation/escalation-manager/BaseEscalationManager.sol";

contract BaseEscalationManagerTest is CommonOptimisticOracleV3Test {
    BaseEscalationManager escalationManager;

    bytes32 identifier = "test";
    uint256 time = 123;
    bytes ancillaryData = "ancillary";

    event PriceRequestAdded(bytes32 indexed identifier, uint256 time, bytes ancillaryData);

    function setUp() public {
        escalationManager = new BaseEscalationManager(address(optimisticOracleV3));
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
        vm.prank(address(optimisticOracleV3));
        escalationManager.requestPrice(identifier, time, ancillaryData);
    }

    function test_GetPrice() public {
        int256 price = escalationManager.getPrice(identifier, time, ancillaryData);
        assertTrue(price == 0);
    }

    function test_RevertIf_NotOptimisticOracleV3() public {
        vm.expectRevert("Not the Optimistic Oracle V3");
        escalationManager.requestPrice(identifier, time, ancillaryData);

        vm.expectRevert("Not the Optimistic Oracle V3");
        escalationManager.assertionResolvedCallback(bytes32(0), true);

        vm.expectRevert("Not the Optimistic Oracle V3");
        escalationManager.assertionDisputedCallback(bytes32(0));
    }
}

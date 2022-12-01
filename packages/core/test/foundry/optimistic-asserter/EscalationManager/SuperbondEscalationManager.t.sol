// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "../Common.sol";
import "../../../../contracts/optimistic-asserter/implementation/escalation-manager/SuperbondEscalationManager.sol";

contract SuperbondEscalationManagerTest is Common {
    SuperbondEscalationManager escalationManager;
    uint256 superbond = 100e18;
    uint256 bond = 50e18;
    bytes32 assertionId = bytes32(0);

    function setUp() public {
        escalationManager = new SuperbondEscalationManager();
        escalationManager.setSuperbond(superbond);
    }

    function test_SetSuperbond() public {
        _mockGetAssertion(assertionId, bond);
        vm.prank(mockOptimisticAsserterAddress);
        SuperbondEscalationManager.AssertionPolicy memory policy = escalationManager.getAssertionPolicy(assertionId);
        assertFalse(policy.blockAssertion);
        assertFalse(policy.arbitrateViaEscalationManager);
        assertFalse(policy.discardOracle);
        assertFalse(policy.validateDisputers);

        _mockGetAssertion(assertionId, superbond + 1);
        vm.prank(mockOptimisticAsserterAddress);
        policy = escalationManager.getAssertionPolicy(assertionId);

        assertFalse(policy.blockAssertion);
        assertTrue(policy.arbitrateViaEscalationManager);
        assertFalse(policy.discardOracle);
        assertFalse(policy.validateDisputers);
    }

    function test_RevertIf_NotOwner() public {
        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(TestAddress.account1);
        escalationManager.setSuperbond(0);
    }

    function _mockGetAssertion(bytes32 assertionId, uint256 bond) internal {
        OptimisticAsserterInterface.Assertion memory assertion;
        assertion.bond = bond;
        vm.mockCall(
            mockOptimisticAsserterAddress,
            abi.encodeWithSelector(OptimisticAsserterInterface.getAssertion.selector, assertionId),
            abi.encode(assertion)
        );
    }
}

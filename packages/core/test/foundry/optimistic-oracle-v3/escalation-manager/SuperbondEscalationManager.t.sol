// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../CommonOptimisticOracleV3Test.sol";
import "../../../../contracts/optimistic-oracle-v3/implementation/escalation-manager/SuperbondEscalationManager.sol";

contract SuperbondEscalationManagerTest is CommonOptimisticOracleV3Test {
    SuperbondEscalationManager escalationManager;
    uint256 superbond = 100e18;
    uint256 bond = 50e18;
    bytes32 assertionId = bytes32(0);
    address anotherCurrency = TestAddress.random;

    function setUp() public {
        escalationManager = new SuperbondEscalationManager(mockOptimisticOracleV3Address);
        escalationManager.setSuperbond(superbond);
        escalationManager.setSuperbondCurrency(address(defaultCurrency));
    }

    function test_SetSuperbond() public {
        _mockGetAssertion(assertionId, bond);
        SuperbondEscalationManager.AssertionPolicy memory policy = escalationManager.getAssertionPolicy(assertionId);
        assertFalse(policy.blockAssertion);
        assertFalse(policy.arbitrateViaEscalationManager);
        assertFalse(policy.discardOracle);
        assertFalse(policy.validateDisputers);

        _mockGetAssertion(assertionId, superbond + 1);
        policy = escalationManager.getAssertionPolicy(assertionId);

        assertFalse(policy.blockAssertion);
        assertTrue(policy.arbitrateViaEscalationManager);
        assertFalse(policy.discardOracle);
        assertFalse(policy.validateDisputers);

        // If the superbond currency is different than the assertion currency, then we use the DVM.
        escalationManager.setSuperbondCurrency(anotherCurrency);
        _mockGetAssertion(assertionId, superbond + 1);
        policy = escalationManager.getAssertionPolicy(assertionId);

        assertFalse(policy.blockAssertion);
        assertFalse(policy.arbitrateViaEscalationManager);
        assertFalse(policy.discardOracle);
        assertFalse(policy.validateDisputers);
    }

    function test_RevertIf_NotOwner() public {
        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(TestAddress.account1);
        escalationManager.setSuperbond(0);

        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(TestAddress.account1);
        escalationManager.setSuperbondCurrency(address(0));
    }

    function _mockGetAssertion(bytes32 assertionId, uint256 bond) internal {
        OptimisticOracleV3Interface.Assertion memory assertion;
        assertion.bond = bond;
        vm.mockCall(
            mockOptimisticOracleV3Address,
            abi.encodeWithSelector(OptimisticOracleV3Interface.getAssertion.selector, assertionId),
            abi.encode(assertion)
        );
    }
}

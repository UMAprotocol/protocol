// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "./CommonOptimisticOracleV3Test.sol";

contract OptimisticOracleV3Events is CommonOptimisticOracleV3Test {
    event AdminPropertiesSet(IERC20 defaultCurrency, uint64 defaultLiveness, uint256 burnedBondPercentage);

    function setUp() public {
        _commonSetup();
    }

    function test_LifecycleEventsEmitted() public {
        vm.startPrank(TestAddress.account1);
        defaultCurrency.allocateTo(TestAddress.account1, defaultBond);
        assert(defaultCurrency.balanceOf(TestAddress.account1) >= defaultBond);
        defaultCurrency.approve(address(optimisticOracleV3), defaultBond);

        bytes32 expectedAssertionId =
            keccak256(
                abi.encode(
                    falseClaimAssertion,
                    defaultBond,
                    uint64(timer.getCurrentTime()),
                    defaultLiveness,
                    address(defaultCurrency),
                    address(0),
                    address(0),
                    defaultIdentifier,
                    TestAddress.account1
                )
            );

        vm.expectEmit(true, true, true, true);
        emit AssertionMade(
            expectedAssertionId,
            bytes32(0),
            falseClaimAssertion,
            TestAddress.account1,
            address(0),
            address(0),
            TestAddress.account1,
            uint64(timer.getCurrentTime()) + defaultLiveness,
            defaultCurrency,
            defaultBond,
            defaultIdentifier
        );

        // Account1 asserts a false claim.
        bytes32 assertionId = optimisticOracleV3.assertTruthWithDefaults(falseClaimAssertion, TestAddress.account1);
        vm.stopPrank();

        // Dispute should emit logs on Optimistic Oracle V3 and Oracle.
        uint64 assertionTime = optimisticOracleV3.getAssertion(assertionId).assertionTime;
        bytes memory ancillaryData = optimisticOracleV3.stampAssertion(assertionId);
        vm.expectEmit(true, true, true, true);
        emit PriceRequestAdded(
            address(optimisticOracleV3),
            defaultIdentifier,
            assertionTime,
            ancillaryData,
            keccak256(abi.encode(defaultIdentifier, assertionTime, ancillaryData))
        );
        vm.expectEmit(true, true, true, true);
        emit AssertionDisputed(assertionId, TestAddress.account2, TestAddress.account2);

        // Perform dispute and mock oracle response where the assertion is resolved as false.
        OracleRequest memory oracleRequest = _disputeAndGetOracleRequest(assertionId, defaultBond);
        _mockOracleResolved(address(mockOracle), oracleRequest, false);

        vm.expectEmit(true, true, true, true);
        emit AssertionSettled(assertionId, TestAddress.account2, true, false, address(this));
        assertFalse(optimisticOracleV3.settleAndGetAssertionResult(assertionId));
    }

    function test_AdminPropertiesSetEmitted() public {
        vm.expectEmit(true, true, true, true);
        emit AdminPropertiesSet(IERC20(TestAddress.random), 69, 0.3e18);
        vm.prank(TestAddress.owner);
        optimisticOracleV3.setAdminProperties(IERC20(TestAddress.random), 69, 0.3e18);
    }
}

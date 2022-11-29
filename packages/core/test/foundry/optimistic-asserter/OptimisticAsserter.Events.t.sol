// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "./Common.sol";

contract OptimisticAsserterEvents is Common {
    event BurnedBondPercentageSet(uint256 burnedBondPercentage);

    function setUp() public {
        _commonSetup();
    }

    function test_LifecycleEventsEmitted() public {
        vm.startPrank(TestAddress.account1);
        defaultCurrency.allocateTo(TestAddress.account1, defaultBond);
        assert(defaultCurrency.balanceOf(TestAddress.account1) >= defaultBond);
        defaultCurrency.approve(address(optimisticAsserter), defaultBond);

        bytes32 expectedAssertionId =
            keccak256(
                abi.encode(
                    falseClaimAssertion,
                    defaultBond,
                    defaultLiveness,
                    address(defaultCurrency),
                    address(0),
                    address(0),
                    defaultIdentifier
                )
            );

        vm.expectEmit(true, true, true, true);
        emit AssertionMade(
            expectedAssertionId,
            falseClaimAssertion,
            TestAddress.account1,
            address(0),
            address(0),
            TestAddress.account1,
            defaultCurrency,
            defaultBond,
            timer.getCurrentTime() + defaultLiveness
        );

        // Account1 asserts a false claim.
        bytes32 assertionId = optimisticAsserter.assertTruth(falseClaimAssertion);
        vm.stopPrank();

        // Dispute should emit logs on Optimistic Asserter and Oracle.
        vm.expectEmit(true, true, true, true);
        emit PriceRequestAdded(
            address(optimisticAsserter),
            optimisticAsserter.defaultIdentifier(),
            optimisticAsserter.getAssertion(assertionId).assertionTime,
            optimisticAsserter.stampAssertion(assertionId)
        );
        vm.expectEmit(true, true, true, true);
        emit AssertionDisputed(assertionId, TestAddress.account2);

        // Perform dispute and mock oracle response where the assertion is resolved as false.
        OracleRequest memory oracleRequest = _disputeAndGetOracleRequest(assertionId, defaultBond);
        _mockOracleResolved(address(mockOracle), oracleRequest, false);

        vm.expectEmit(true, true, true, true);
        emit AssertionSettled(assertionId, TestAddress.account2, true, false);
        assertFalse(optimisticAsserter.settleAndGetAssertionResult(assertionId));
    }

    function test_BurnedBondPercentageSetEmitted() public {
        vm.expectEmit(true, true, true, true);
        emit BurnedBondPercentageSet(0.3e18);
        vm.prank(TestAddress.owner);
        optimisticAsserter.setBurnedBondPercentage(0.3e18);
    }
}

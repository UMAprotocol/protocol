// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "./Common.sol";

contract OptimisticAssertorEvents is Common {
    function setUp() public {
        OptimisticAssertorFixture.OptimisticAssertorContracts memory oaContracts =
            new OptimisticAssertorFixture().setUp();
        optimisticAssertor = oaContracts.optimisticAssertor;
        defaultCurrency = oaContracts.defaultCurrency;
        mockOracle = oaContracts.mockOracle;
        timer = oaContracts.timer;
    }

    function test_LifecycleEventsEmitted() public {
        vm.startPrank(TestAddress.account1);
        defaultCurrency.allocateTo(TestAddress.account1, optimisticAssertor.defaultBond());
        assert(defaultCurrency.balanceOf(TestAddress.account1) >= optimisticAssertor.defaultBond());
        defaultCurrency.approve(address(optimisticAssertor), optimisticAssertor.defaultBond());

        bytes32 expectedAssertionId =
            keccak256(
                abi.encode(
                    falseClaimAssertion,
                    optimisticAssertor.defaultBond(),
                    optimisticAssertor.defaultLiveness(),
                    address(defaultCurrency),
                    TestAddress.account1,
                    address(0),
                    address(0)
                )
            );

        vm.expectEmit(true, true, true, true);
        emit AssertionMade(
            expectedAssertionId,
            falseClaimAssertion,
            TestAddress.account1,
            address(0),
            address(0),
            defaultCurrency,
            optimisticAssertor.defaultBond(),
            timer.getCurrentTime() + optimisticAssertor.defaultLiveness()
        );

        // Account1 asserts a false claim.
        bytes32 assertionId = optimisticAssertor.assertTruth(falseClaimAssertion);
        vm.stopPrank();

        // Dispute should emit logs on Optimistic Asserter and Oracle.
        vm.expectEmit(true, true, true, true);
        emit PriceRequestAdded(
            address(optimisticAssertor),
            optimisticAssertor.identifier(),
            optimisticAssertor.readAssertion(assertionId).assertionTime,
            optimisticAssertor.stampAssertion(assertionId)
        );
        vm.expectEmit(true, true, true, true);
        emit AssertionDisputed(assertionId, TestAddress.account2);

        // Perform dispute and mock oracle response where the assertion is resolved as false.
        OracleRequest memory oracleRequest = _disputeAndGetOracleRequest(assertionId);
        _mockOracleResolved(address(mockOracle), oracleRequest, false);

        vm.expectEmit(true, true, true, true);
        emit AssertionSettled(assertionId, TestAddress.account2, true, false);
        assertFalse(optimisticAssertor.settleAndGetAssertion(assertionId));
    }
}

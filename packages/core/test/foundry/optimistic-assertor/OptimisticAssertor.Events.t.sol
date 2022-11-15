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
                    trueClaimAssertion,
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
            trueClaimAssertion,
            TestAddress.account1,
            address(0),
            address(0),
            defaultCurrency,
            optimisticAssertor.defaultBond(),
            timer.getCurrentTime() + optimisticAssertor.defaultLiveness()
        );

        // Account1 asserts a false claim.
        bytes32 assertionId = optimisticAssertor.assertTruth(trueClaimAssertion);
        vm.stopPrank();

        // The assertion gets disputed by the disputer, account2.
        vm.startPrank(TestAddress.account2);
        defaultCurrency.allocateTo(TestAddress.account2, optimisticAssertor.defaultBond());
        defaultCurrency.approve(address(optimisticAssertor), optimisticAssertor.defaultBond());

        vm.expectEmit(true, true, true, true);
        emit PriceRequestAdded(
            address(optimisticAssertor),
            optimisticAssertor.identifier(),
            optimisticAssertor.readAssertion(assertionId).assertionTime,
            optimisticAssertor.stampAssertion(assertionId)
        );
        vm.expectEmit(true, true, true, true);
        emit AssertionDisputed(assertionId, TestAddress.account2);
        optimisticAssertor.disputeAssertionFor(assertionId, TestAddress.account2);
        vm.stopPrank();

        // In the meantime simulate a vote in the DVM in which the originally disputed price is accepted
        MockOracleAncillary.QueryPoint[] memory queries = mockOracle.getPendingQueries();

        // Push the resolution price into the mock oracle, a no vote meaning that the assertion is resolved as false.
        mockOracle.pushPrice(queries[0].identifier, queries[0].time, queries[0].ancillaryData, 0);

        vm.expectEmit(true, true, true, true);
        emit AssertionSettled(assertionId, TestAddress.account2, true, false);
        assertEq(optimisticAssertor.settleAndGetAssertion(assertionId), false);
    }
}

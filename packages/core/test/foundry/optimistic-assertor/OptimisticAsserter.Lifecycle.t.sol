// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "../fixtures/optimistic-assertor/OptimisticAssertorFixture.sol";
import "../fixtures/common/TestAddress.sol";

contract Assertions is Test {
    OptimisticAssertor optimisticAssertor;
    TestnetERC20 defaultCurrency;
    Timer timer;
    MockOracleAncillary mockOracle;
    Store store;
    string trueClaimAssertion = 'q:"The sky is blue"';
    string falseClaimAssertion = 'q:"The sky is red"';

    function setUp() public {
        OptimisticAssertorFixture.OptimisticAsserterContracts memory oaContracts =
            new OptimisticAssertorFixture().setUp();
        optimisticAssertor = oaContracts.optimisticAssertor;
        defaultCurrency = oaContracts.defaultCurrency;
        mockOracle = oaContracts.mockOracle;
        store = oaContracts.store;
        timer = oaContracts.timer;
    }

    function test_AssertionWithNoDispute() public {
        vm.startPrank(TestAddress.account1);
        defaultCurrency.allocateTo(TestAddress.account1, optimisticAssertor.defaultBond());
        assert(defaultCurrency.balanceOf(TestAddress.account1) >= optimisticAssertor.defaultBond());
        defaultCurrency.approve(address(optimisticAssertor), optimisticAssertor.defaultBond());

        bytes32 assertionId =
            optimisticAssertor.assertTruthFor(
                bytes(trueClaimAssertion),
                TestAddress.account1,
                address(0),
                address(0),
                defaultCurrency,
                optimisticAssertor.defaultBond(),
                optimisticAssertor.defaultLiveness()
            );

        // Settle before the liveness period should revert.
        vm.expectRevert("Assertion not expired");
        optimisticAssertor.settleAndGetAssertion(assertionId);

        // Move time forward to the end of the liveness period.
        timer.setCurrentTime(timer.getCurrentTime() + optimisticAssertor.defaultLiveness());

        // proposer balance before settlement
        uint256 proposerBalanceBefore = defaultCurrency.balanceOf(TestAddress.account1);
        // The assertion should be true.
        assertEq(optimisticAssertor.settleAndGetAssertion(assertionId), true);
        assertEq(
            defaultCurrency.balanceOf(TestAddress.account1) - proposerBalanceBefore,
            optimisticAssertor.defaultBond()
        );

        vm.stopPrank();
    }

    function test_AssertionWithDispute() public {
        vm.startPrank(TestAddress.account1);
        defaultCurrency.allocateTo(TestAddress.account1, optimisticAssertor.defaultBond());
        assert(defaultCurrency.balanceOf(TestAddress.account1) >= optimisticAssertor.defaultBond());
        defaultCurrency.approve(address(optimisticAssertor), optimisticAssertor.defaultBond());

        // Account1 asserts a false claim.
        bytes32 assertionId =
            optimisticAssertor.assertTruthFor(
                bytes(falseClaimAssertion),
                TestAddress.account1,
                address(0),
                address(0),
                defaultCurrency,
                optimisticAssertor.defaultBond(),
                optimisticAssertor.defaultLiveness()
            );
        vm.stopPrank();

        // The assertion gets disputed by the disputer, account2.
        vm.startPrank(TestAddress.account2);
        defaultCurrency.allocateTo(TestAddress.account2, optimisticAssertor.defaultBond());
        assert(defaultCurrency.balanceOf(TestAddress.account2) >= optimisticAssertor.defaultBond());
        defaultCurrency.approve(address(optimisticAssertor), optimisticAssertor.defaultBond());

        optimisticAssertor.disputeAssertionFor(assertionId, TestAddress.account2);
        vm.stopPrank();

        // In the meantime simulate a vote in the DVM in which the originally disputed price is accepted
        MockOracleAncillary.QueryPoint[] memory queries = mockOracle.getPendingQueries();

        // There should be only one query.
        assertEq(queries.length, 1);

        // The query should be for the disputed assertion.
        assertEq(queries[0].identifier, optimisticAssertor.identifier());

        // Push the resolution price into the mock oracle, a no vote meaning that the assertion is resolved as false.
        mockOracle.pushPrice(queries[0].identifier, queries[0].time, queries[0].ancillaryData, 0);

        assertEq(optimisticAssertor.settleAndGetAssertion(assertionId), false);

        // The proposer should have lost their bond.
        assertEq(defaultCurrency.balanceOf(TestAddress.account1), 0);

        // The disputer should have kept their bond and earned 1 - burnedBondPercentage of the proposer's bond.
        assertEq(
            defaultCurrency.balanceOf(TestAddress.account2),
            ((optimisticAssertor.defaultBond() * (2e18 - optimisticAssertor.burnedBondPercentage())) / 1e18)
        );

        // The store should have kept the burnedBondPercentage part of the proposer's bond.
        assertEq(
            defaultCurrency.balanceOf(address(store)),
            (optimisticAssertor.defaultBond() * optimisticAssertor.burnedBondPercentage()) / 1e18
        );

        // The balance of the optimistic assertor should be zero.
        assertEq(defaultCurrency.balanceOf(address(optimisticAssertor)), 0);
    }
}

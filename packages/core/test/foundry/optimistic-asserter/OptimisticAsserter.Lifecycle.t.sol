// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "./Common.sol";

contract SimpleAssertionsWithClaimOnly is Common {
    function setUp() public {
        _commonSetup();
    }

    function test_AssertionWithNoDispute() public {
        vm.startPrank(TestAddress.account1);
        defaultCurrency.allocateTo(TestAddress.account1, defaultBond);
        assert(defaultCurrency.balanceOf(TestAddress.account1) >= defaultBond);
        defaultCurrency.approve(address(optimisticAsserter), defaultBond);

        bytes32 expectedAssertionId =
            keccak256(
                abi.encode(
                    trueClaimAssertion,
                    defaultBond,
                    defaultLiveness,
                    address(defaultCurrency),
                    address(0),
                    address(0),
                    defaultIdentifier
                )
            );

        bytes32 assertionId = optimisticAsserter.assertTruthWithDefaults(trueClaimAssertion);
        assertEq(assertionId, expectedAssertionId);
        vm.stopPrank();

        // Settle before the liveness period should revert.
        vm.expectRevert("Assertion not expired");
        optimisticAsserter.settleAndGetAssertionResult(assertionId);

        // Move time forward to the end of the liveness period.
        timer.setCurrentTime(timer.getCurrentTime() + defaultLiveness);

        // asserter balance before settlement
        uint256 asserterBalanceBefore = defaultCurrency.balanceOf(TestAddress.account1);

        // The assertion should be true.
        assertTrue(optimisticAsserter.settleAndGetAssertionResult(assertionId));
        assertEq(defaultCurrency.balanceOf(TestAddress.account1) - asserterBalanceBefore, defaultBond);
    }

    function test_AssertionWithDispute() public {
        vm.startPrank(TestAddress.account1);
        defaultCurrency.allocateTo(TestAddress.account1, defaultBond);
        assert(defaultCurrency.balanceOf(TestAddress.account1) >= defaultBond);
        defaultCurrency.approve(address(optimisticAsserter), defaultBond);

        // Account1 asserts a false claim.
        bytes32 assertionId = optimisticAsserter.assertTruthWithDefaults(bytes(falseClaimAssertion));
        vm.stopPrank();

        // The assertion gets disputed by the disputer, account2.
        vm.startPrank(TestAddress.account2);
        defaultCurrency.allocateTo(TestAddress.account2, defaultBond);
        assert(defaultCurrency.balanceOf(TestAddress.account2) >= defaultBond);
        defaultCurrency.approve(address(optimisticAsserter), defaultBond);

        optimisticAsserter.disputeAssertion(assertionId, TestAddress.account2);
        vm.stopPrank();

        // In the meantime simulate a vote in the DVM in which the originally disputed price is accepted
        MockOracleAncillary.QueryPoint[] memory queries = mockOracle.getPendingQueries();

        // There should be only one query.
        assertEq(queries.length, 1);

        // The query should be for the disputed assertion.
        assertEq(queries[0].identifier, optimisticAsserter.defaultIdentifier());
        assertEq(queries[0].time, optimisticAsserter.getAssertion(assertionId).assertionTime);
        assertEq(queries[0].ancillaryData, optimisticAsserter.stampAssertion(assertionId));

        // Push the resolution price into the mock oracle, a no vote meaning that the assertion is resolved as false.
        mockOracle.pushPrice(queries[0].identifier, queries[0].time, queries[0].ancillaryData, 0);

        assertFalse(optimisticAsserter.settleAndGetAssertionResult(assertionId));

        // The asserter should have lost their bond.
        assertEq(defaultCurrency.balanceOf(TestAddress.account1), 0);

        // The disputer should have kept their bond and earned 1 - burnedBondPercentage of the asserter's bond.
        assertEq(
            defaultCurrency.balanceOf(TestAddress.account2),
            ((defaultBond * (2e18 - optimisticAsserter.burnedBondPercentage())) / 1e18)
        );

        // The store should have kept the burnedBondPercentage part of the asserter's bond.
        assertEq(
            defaultCurrency.balanceOf(address(store)),
            (defaultBond * optimisticAsserter.burnedBondPercentage()) / 1e18
        );

        // The balance of the optimistic asserter should be zero.
        assertEq(defaultCurrency.balanceOf(address(optimisticAsserter)), 0);
    }

    function test_AssertionWithDifferentBurnedBondPercentage() public {
        uint64[10] memory burnedBondPercentages =
            [0.1e18, 0.2e18, 0.3e18, 0.4e18, 0.5e18, 0.6e18, 0.7e18, 0.8e18, 0.9e18, 1e18];
        for (uint256 i = 0; i < burnedBondPercentages.length; i++) {
            vm.startPrank(TestAddress.owner);
            optimisticAsserter.setBurnedBondPercentage(burnedBondPercentages[i]);
            uint256 minimumBond = optimisticAsserter.getMinimumBond(address(defaultCurrency));
            optimisticAsserter.setAssertionDefaults(
                optimisticAsserter.defaultCurrency(),
                optimisticAsserter.defaultLiveness()
            );
            vm.stopPrank();
            assertEq(optimisticAsserter.burnedBondPercentage(), burnedBondPercentages[i]);

            // Account1 asserts a false claim.
            bytes32 assertionId = _allocateBondAndAssertTruth(TestAddress.account1, bytes(falseClaimAssertion));

            // Account2 disputes the assertion and the DVM resolves it as false, meaning that the disputer wins.
            uint256 asserterBalanceBefore = defaultCurrency.balanceOf(TestAddress.account2);
            uint256 storeBalanceBefore = defaultCurrency.balanceOf(address(store));
            OracleRequest memory oracleRequest = _disputeAndGetOracleRequest(assertionId, minimumBond);
            _mockOracleResolved(address(mockOracle), oracleRequest, false);
            assertFalse(optimisticAsserter.settleAndGetAssertionResult(assertionId));

            // The asserter should have lost their bond.
            assertEq(defaultCurrency.balanceOf(TestAddress.account1), 0);

            // The disputer should have kept their bond and earned 1 - burnedBondPercentage of the asserter's bond.
            uint256 expectedAmount = minimumBond * 2 - (optimisticAsserter.burnedBondPercentage() * minimumBond) / 1e18;
            assertEq(defaultCurrency.balanceOf(TestAddress.account2) - asserterBalanceBefore, expectedAmount);

            // The store should have kept the burnedBondPercentage part of the asserter's bond.
            assertEq(
                defaultCurrency.balanceOf(address(store)) - storeBalanceBefore,
                (minimumBond * optimisticAsserter.burnedBondPercentage()) / 1e18
            );

            // The balance of the optimistic asserter should be zero.
            assertEq(defaultCurrency.balanceOf(address(optimisticAsserter)), 0);
        }
    }
}

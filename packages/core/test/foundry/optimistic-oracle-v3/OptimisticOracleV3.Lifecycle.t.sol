// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "./CommonOptimisticOracleV3Test.sol";

contract SimpleAssertionsWithClaimOnly is CommonOptimisticOracleV3Test {
    function setUp() public {
        _commonSetup();
    }

    function test_AssertionWithNoDispute() public {
        vm.startPrank(TestAddress.account1);
        defaultCurrency.allocateTo(TestAddress.account1, defaultBond);
        assert(defaultCurrency.balanceOf(TestAddress.account1) >= defaultBond);
        defaultCurrency.approve(address(optimisticOracleV3), defaultBond);

        bytes32 expectedAssertionId =
            keccak256(
                abi.encode(
                    trueClaimAssertion,
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

        bytes32 assertionId = optimisticOracleV3.assertTruthWithDefaults(trueClaimAssertion, TestAddress.account1);
        assertEq(assertionId, expectedAssertionId);
        vm.stopPrank();

        // Settle before the liveness period should revert.
        vm.expectRevert("Assertion not expired");
        optimisticOracleV3.settleAndGetAssertionResult(assertionId);

        // Move time forward to the end of the liveness period.
        timer.setCurrentTime(timer.getCurrentTime() + defaultLiveness);

        // asserter balance before settlement
        uint256 asserterBalanceBefore = defaultCurrency.balanceOf(TestAddress.account1);

        // The assertion should be true.
        assertTrue(optimisticOracleV3.settleAndGetAssertionResult(assertionId));
        assertEq(defaultCurrency.balanceOf(TestAddress.account1) - asserterBalanceBefore, defaultBond);
    }

    function test_AssertionWithDispute() public {
        vm.startPrank(TestAddress.account1);
        defaultCurrency.allocateTo(TestAddress.account1, defaultBond);
        assert(defaultCurrency.balanceOf(TestAddress.account1) >= defaultBond);
        defaultCurrency.approve(address(optimisticOracleV3), defaultBond);

        // Account1 asserts a false claim.
        bytes32 assertionId =
            optimisticOracleV3.assertTruthWithDefaults(bytes(falseClaimAssertion), TestAddress.account1);
        vm.stopPrank();

        // The assertion gets disputed by the disputer, account2.
        vm.startPrank(TestAddress.account2);
        defaultCurrency.allocateTo(TestAddress.account2, defaultBond);
        assert(defaultCurrency.balanceOf(TestAddress.account2) >= defaultBond);
        defaultCurrency.approve(address(optimisticOracleV3), defaultBond);

        optimisticOracleV3.disputeAssertion(assertionId, TestAddress.account2);
        vm.stopPrank();

        // In the meantime simulate a vote in the DVM in which the originally disputed price is accepted
        MockOracleAncillary.QueryPoint[] memory queries = mockOracle.getPendingQueries();

        // There should be only one query.
        assertEq(queries.length, 1);

        // The query should be for the disputed assertion.
        assertEq(queries[0].identifier, optimisticOracleV3.defaultIdentifier());
        assertEq(queries[0].time, optimisticOracleV3.getAssertion(assertionId).assertionTime);
        assertEq(queries[0].ancillaryData, optimisticOracleV3.stampAssertion(assertionId));

        // Push the resolution price into the mock oracle, a no vote meaning that the assertion is resolved as false.
        mockOracle.pushPrice(queries[0].identifier, queries[0].time, queries[0].ancillaryData, 0);

        assertFalse(optimisticOracleV3.settleAndGetAssertionResult(assertionId));

        // The asserter should have lost their bond.
        assertEq(defaultCurrency.balanceOf(TestAddress.account1), 0);

        // The disputer should have kept their bond and earned 1 - burnedBondPercentage of the asserter's bond.
        assertEq(
            defaultCurrency.balanceOf(TestAddress.account2),
            ((defaultBond * (2e18 - optimisticOracleV3.burnedBondPercentage())) / 1e18)
        );

        // The store should have kept the burnedBondPercentage part of the asserter's bond.
        assertEq(
            defaultCurrency.balanceOf(address(store)),
            (defaultBond * optimisticOracleV3.burnedBondPercentage()) / 1e18
        );

        // The balance of the Optimistic Oracle V3 should be zero.
        assertEq(defaultCurrency.balanceOf(address(optimisticOracleV3)), 0);
    }

    function test_AssertionWithDifferentBurnedBondPercentage() public {
        uint64[10] memory burnedBondPercentages =
            [0.1e18, 0.2e18, 0.3e18, 0.4e18, 0.5e18, 0.6e18, 0.7e18, 0.8e18, 0.9e18, 1e18];
        for (uint256 i = 0; i < burnedBondPercentages.length; i++) {
            vm.prank(TestAddress.owner);
            optimisticOracleV3.setAdminProperties(defaultCurrency, defaultLiveness, burnedBondPercentages[i]);
            uint256 minimumBond = optimisticOracleV3.getMinimumBond(address(defaultCurrency));
            assertEq(optimisticOracleV3.burnedBondPercentage(), burnedBondPercentages[i]);

            // Account1 asserts a false claim.
            bytes32 assertionId = _allocateBondAndAssertTruth(TestAddress.account1, bytes(falseClaimAssertion));

            // Account2 disputes the assertion and the DVM resolves it as false, meaning that the disputer wins.
            uint256 asserterBalanceBefore = defaultCurrency.balanceOf(TestAddress.account2);
            uint256 storeBalanceBefore = defaultCurrency.balanceOf(address(store));
            OracleRequest memory oracleRequest = _disputeAndGetOracleRequest(assertionId, minimumBond);
            _mockOracleResolved(address(mockOracle), oracleRequest, false);
            assertFalse(optimisticOracleV3.settleAndGetAssertionResult(assertionId));

            // The asserter should have lost their bond.
            assertEq(defaultCurrency.balanceOf(TestAddress.account1), 0);

            // The disputer should have kept their bond and earned 1 - burnedBondPercentage of the asserter's bond.
            uint256 expectedAmount = minimumBond * 2 - (optimisticOracleV3.burnedBondPercentage() * minimumBond) / 1e18;
            assertEq(defaultCurrency.balanceOf(TestAddress.account2) - asserterBalanceBefore, expectedAmount);

            // The store should have kept the burnedBondPercentage part of the asserter's bond.
            assertEq(
                defaultCurrency.balanceOf(address(store)) - storeBalanceBefore,
                (minimumBond * optimisticOracleV3.burnedBondPercentage()) / 1e18
            );

            // The balance of the Optimistic Oracle V3 should be zero.
            assertEq(defaultCurrency.balanceOf(address(optimisticOracleV3)), 0);
        }
    }
}

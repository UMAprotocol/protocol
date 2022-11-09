// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "../fixtures/optimistic-assertor/OptimisticAssertorFixture.sol";
import "../fixtures/common/TestAddress.sol";

contract OptimisticAsserterLifecycle is Test {
    OptimisticAssertor optimisticAssertor;
    TestnetERC20 defaultCurrency;
    Timer timer;
    string claimAssertion = 'q:"The sky is blue"';

    function setUp() public {
        OptimisticAssertorFixture.OptimisticAsserterContracts memory oaContracts =
            new OptimisticAssertorFixture().setUp();
        optimisticAssertor = oaContracts.optimisticAssertor;
        defaultCurrency = oaContracts.defaultCurrency;
        timer = oaContracts.timer;
    }

    function testAssertionWithNoDispute() public {
        vm.startPrank(TestAddress.account1);
        defaultCurrency.allocateTo(TestAddress.account1, optimisticAssertor.defaultBond());
        assert(defaultCurrency.balanceOf(TestAddress.account1) >= optimisticAssertor.defaultBond());
        defaultCurrency.approve(address(optimisticAssertor), optimisticAssertor.defaultBond());

        bytes32 assertionId =
            optimisticAssertor.assertTruthFor(
                bytes(claimAssertion),
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

    function testBondBelowMinimum() public {
        vm.expectRevert("Bond amount too low");
        optimisticAssertor.assertTruthFor(
            bytes(claimAssertion),
            address(0),
            address(0),
            address(0),
            defaultCurrency,
            0,
            0
        );
    }
}

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

        bytes32 assertionId = optimisticAssertor.assertTruth(bytes(claimAssertion));

        // Move time forward to the end of the liveness period.
        timer.setCurrentTime(timer.getCurrentTime() + optimisticAssertor.defaultLiveness());

        // The assertion should be true.
        assert(optimisticAssertor.settleAndGetAssertion(assertionId));

        vm.stopPrank();
    }
}

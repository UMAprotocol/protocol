// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "../fixtures/optimistic-assertor/OptimisticAssertorFixture.sol";
import "../fixtures/common/TestAddress.sol";

contract Boundaries is Test {
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

    function test_RevertIf_BondBelowMinimum() public {
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

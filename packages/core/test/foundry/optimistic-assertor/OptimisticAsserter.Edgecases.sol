// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "../fixtures/optimistic-assertor/OptimisticAssertorFixture.sol";
import "../fixtures/common/TestAddress.sol";

contract InvalidParameters is Test {
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

    function test_RevertIf_DuplicateAssertion() public {
        vm.startPrank(TestAddress.account1);
        defaultCurrency.allocateTo(TestAddress.account1, optimisticAssertor.defaultBond() * 2);
        assert(defaultCurrency.balanceOf(TestAddress.account1) >= optimisticAssertor.defaultBond() * 2);
        defaultCurrency.approve(address(optimisticAssertor), optimisticAssertor.defaultBond() * 2);

        // Account1 asserts a claim.
        bytes32 assertionId = optimisticAssertor.assertTruth(bytes(claimAssertion));

        // Account1 asserts the same claim again.
        vm.expectRevert("Assertion already exists");
        optimisticAssertor.assertTruth(bytes(claimAssertion));
        vm.stopPrank();
    }

    function test_RevertIf_UnsupportedCurrency() public {
        // Change the default currency to unsupported token.
        vm.startPrank(TestAddress.owner);
        TestnetERC20 unsupportedCurrency = new TestnetERC20("Unsupported", "UNS", 18);
        optimisticAssertor.setAssertionDefaults(
            unsupportedCurrency,
            optimisticAssertor.defaultBond(),
            optimisticAssertor.defaultLiveness()
        );
        vm.stopPrank();

        vm.expectRevert("Unsupported currency");
        optimisticAssertor.assertTruth(bytes(claimAssertion));
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

    function test_RevertWhen_InvalidAssertionId() public {
        vm.expectRevert("Assertion does not exist");
        optimisticAssertor.disputeAssertionFor(bytes32(0), TestAddress.account2);

        vm.expectRevert("Assertion does not exist");
        optimisticAssertor.settleAndGetAssertion(bytes32(0));

        vm.expectRevert("Assertion does not exist");
        optimisticAssertor.settleAssertion(bytes32(0));
    }

    function test_RevertIf_DuplicateDispute() public {
        // Fund Account1 with enough currency to make an assertion.
        vm.startPrank(TestAddress.account1);
        defaultCurrency.allocateTo(TestAddress.account1, optimisticAssertor.defaultBond());
        assert(defaultCurrency.balanceOf(TestAddress.account1) >= optimisticAssertor.defaultBond());
        defaultCurrency.approve(address(optimisticAssertor), optimisticAssertor.defaultBond());

        // Account1 asserts a claim.
        bytes32 assertionId = optimisticAssertor.assertTruth(bytes(claimAssertion));
        vm.stopPrank();

        // Fund Account2 with enough currency to dispute the assertion twice.
        vm.startPrank(TestAddress.account2);
        defaultCurrency.allocateTo(TestAddress.account2, optimisticAssertor.defaultBond() * 2);
        assert(defaultCurrency.balanceOf(TestAddress.account2) >= optimisticAssertor.defaultBond() * 2);
        defaultCurrency.approve(address(optimisticAssertor), optimisticAssertor.defaultBond() * 2);

        // Account2 disputes the assertion.
        optimisticAssertor.disputeAssertionFor(assertionId, address(0));

        // Account2 should not be able to dispute the assertion again.
        vm.expectRevert("Assertion already disputed");
        optimisticAssertor.disputeAssertionFor(assertionId, address(0));
        vm.stopPrank();
    }
}

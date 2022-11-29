// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "./Common.sol";

contract InvalidParameters is Common {
    function setUp() public {
        _commonSetup();
    }

    function test_RevertIf_DuplicateAssertion() public {
        vm.startPrank(TestAddress.account1);
        defaultCurrency.allocateTo(TestAddress.account1, defaultBond * 2);
        assert(defaultCurrency.balanceOf(TestAddress.account1) >= defaultBond * 2);
        defaultCurrency.approve(address(optimisticAsserter), defaultBond * 2);

        // Account1 asserts a claim.
        bytes32 assertionId = optimisticAsserter.assertTruthWithDefaults(trueClaimAssertion);

        // Account1 asserts the same claim again.
        vm.expectRevert("Assertion already exists");
        optimisticAsserter.assertTruthWithDefaults(trueClaimAssertion);
        vm.stopPrank();
    }

    function test_RevertIf_UnsupportedIdentifier() public {
        bytes32 unsupportedIdentifier = "UNSUPPORTED";

        vm.expectRevert("Unsupported identifier");
        vm.prank(TestAddress.account1);
        optimisticAsserter.assertTruth(
            trueClaimAssertion,
            address(0),
            address(0),
            address(0),
            defaultCurrency,
            defaultBond,
            defaultLiveness,
            unsupportedIdentifier
        );
    }

    function test_RevertIf_UnsupportedCurrency() public {
        // Change the default currency to unsupported token.
        vm.startPrank(TestAddress.owner);
        TestnetERC20 unsupportedCurrency = new TestnetERC20("Unsupported", "UNS", 18);
        optimisticAsserter.setAssertionDefaults(unsupportedCurrency, defaultBond, defaultLiveness);
        vm.stopPrank();

        vm.expectRevert("Unsupported currency");
        optimisticAsserter.assertTruthWithDefaults(trueClaimAssertion);
    }

    function test_RevertIf_BondBelowMinimum() public {
        vm.expectRevert("Bond amount too low");
        optimisticAsserter.assertTruth(
            trueClaimAssertion,
            address(0),
            address(0),
            address(0),
            defaultCurrency,
            0,
            0,
            defaultIdentifier
        );
    }

    function test_RevertWhen_InvalidAssertionId() public {
        vm.expectRevert("Assertion does not exist");
        optimisticAsserter.disputeAssertionFor(bytes32(0), TestAddress.account2);

        vm.expectRevert("Assertion does not exist");
        optimisticAsserter.settleAndGetAssertionResult(bytes32(0));

        vm.expectRevert("Assertion does not exist");
        optimisticAsserter.settleAssertion(bytes32(0));
    }

    function test_RevertIf_DuplicateDispute() public {
        // Fund Account1 with enough currency to make an assertion.
        vm.startPrank(TestAddress.account1);
        defaultCurrency.allocateTo(TestAddress.account1, defaultBond);
        assert(defaultCurrency.balanceOf(TestAddress.account1) >= defaultBond);
        defaultCurrency.approve(address(optimisticAsserter), defaultBond);

        // Account1 asserts a claim.
        bytes32 assertionId = optimisticAsserter.assertTruthWithDefaults(falseClaimAssertion);
        vm.stopPrank();

        // Fund Account2 with enough currency to dispute the assertion twice.
        vm.startPrank(TestAddress.account2);
        defaultCurrency.allocateTo(TestAddress.account2, defaultBond * 2);
        assert(defaultCurrency.balanceOf(TestAddress.account2) >= defaultBond * 2);
        defaultCurrency.approve(address(optimisticAsserter), defaultBond * 2);

        // Account2 disputes the assertion.
        optimisticAsserter.disputeAssertionFor(assertionId, address(0));

        // Account2 should not be able to dispute the assertion again.
        vm.expectRevert("Assertion already disputed");
        optimisticAsserter.disputeAssertionFor(assertionId, address(0));
        vm.stopPrank();
    }

    function test_RevertIf_BurnedBondPercentageSetOutOfBounds() public {
        vm.expectRevert("Burned bond percentage is 0");
        vm.prank(TestAddress.owner);
        optimisticAsserter.setBurnedBondPercentage(0);

        vm.expectRevert("Burned bond percentage > 100");
        vm.prank(TestAddress.owner);
        optimisticAsserter.setBurnedBondPercentage(2e18);
    }
}

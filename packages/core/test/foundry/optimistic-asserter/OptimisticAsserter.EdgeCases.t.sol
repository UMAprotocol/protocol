// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "./CommonOptimisticAsserterTest.sol";

contract InvalidParameters is CommonOptimisticAsserterTest {
    function setUp() public {
        _commonSetup();
    }

    function test_RevertIf_DuplicateAssertion() public {
        vm.startPrank(TestAddress.account1);
        defaultCurrency.allocateTo(TestAddress.account1, defaultBond * 2);
        assert(defaultCurrency.balanceOf(TestAddress.account1) >= defaultBond * 2);
        defaultCurrency.approve(address(optimisticAsserter), defaultBond * 2);

        // Account1 asserts a claim.
        bytes32 assertionId = optimisticAsserter.assertTruthWithDefaults(trueClaimAssertion, TestAddress.account1);

        // Account1 asserts the same claim again.
        vm.expectRevert("Assertion already exists");
        optimisticAsserter.assertTruthWithDefaults(trueClaimAssertion, TestAddress.account1);
        vm.stopPrank();
    }

    function test_RevertIf_UnsupportedIdentifier() public {
        bytes32 unsupportedIdentifier = "UNSUPPORTED";

        vm.expectRevert("Unsupported identifier");
        vm.prank(TestAddress.account1);
        optimisticAsserter.assertTruth(
            trueClaimAssertion,
            TestAddress.account1,
            address(0),
            address(0),
            defaultLiveness,
            defaultCurrency,
            defaultBond,
            unsupportedIdentifier,
            bytes32(0) // No domain.
        );
    }

    function test_RevertIf_UnsupportedCurrency() public {
        // Change the default currency to unsupported token.
        vm.startPrank(TestAddress.owner);
        TestnetERC20 unsupportedCurrency = new TestnetERC20("Unsupported", "UNS", 18);
        optimisticAsserter.setAdminProperties(unsupportedCurrency, defaultLiveness, burnedBondPercentage);
        vm.stopPrank();

        vm.expectRevert("Unsupported currency");
        optimisticAsserter.assertTruthWithDefaults(trueClaimAssertion, TestAddress.account1);
    }

    function test_RevertIf_BondBelowMinimum() public {
        vm.expectRevert("Bond amount too low");
        optimisticAsserter.assertTruth(
            trueClaimAssertion,
            TestAddress.account1,
            address(0),
            address(0),
            0,
            defaultCurrency,
            0,
            defaultIdentifier,
            bytes32(0) // No domain.
        );
    }

    function test_RevertWhen_InvalidAssertionId() public {
        vm.expectRevert("Assertion does not exist");
        optimisticAsserter.disputeAssertion(bytes32(0), TestAddress.account2);

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
        bytes32 assertionId = optimisticAsserter.assertTruthWithDefaults(falseClaimAssertion, TestAddress.account1);
        vm.stopPrank();

        // Fund Account2 with enough currency to dispute the assertion twice.
        vm.startPrank(TestAddress.account2);
        defaultCurrency.allocateTo(TestAddress.account2, defaultBond * 2);
        assert(defaultCurrency.balanceOf(TestAddress.account2) >= defaultBond * 2);
        defaultCurrency.approve(address(optimisticAsserter), defaultBond * 2);

        // Account2 disputes the assertion.
        optimisticAsserter.disputeAssertion(assertionId, TestAddress.account2);

        // Account2 should not be able to dispute the assertion again.
        vm.expectRevert("Assertion already disputed");
        optimisticAsserter.disputeAssertion(assertionId, TestAddress.account2);
        vm.stopPrank();
    }

    function test_RevertIf_BurnedBondPercentageSetOutOfBounds() public {
        vm.expectRevert("Burned bond percentage is 0");
        vm.prank(TestAddress.owner);
        optimisticAsserter.setAdminProperties(defaultCurrency, defaultLiveness, 0);

        vm.expectRevert("Burned bond percentage > 100");
        vm.prank(TestAddress.owner);
        optimisticAsserter.setAdminProperties(defaultCurrency, defaultLiveness, 2e18);
    }
}

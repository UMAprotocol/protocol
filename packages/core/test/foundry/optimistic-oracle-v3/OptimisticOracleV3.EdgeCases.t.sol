// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "./CommonOptimisticOracleV3Test.sol";

contract InvalidParameters is CommonOptimisticOracleV3Test {
    function setUp() public {
        _commonSetup();
    }

    function test_RevertIf_DuplicateAssertion() public {
        vm.startPrank(TestAddress.account1);
        defaultCurrency.allocateTo(TestAddress.account1, defaultBond * 2);
        assert(defaultCurrency.balanceOf(TestAddress.account1) >= defaultBond * 2);
        defaultCurrency.approve(address(optimisticOracleV3), defaultBond * 2);

        // Account1 asserts a claim.
        bytes32 assertionId = optimisticOracleV3.assertTruthWithDefaults(trueClaimAssertion, TestAddress.account1);

        // Account1 asserts the same claim again.
        vm.expectRevert("Assertion already exists");
        optimisticOracleV3.assertTruthWithDefaults(trueClaimAssertion, TestAddress.account1);
        vm.stopPrank();
    }

    function test_RevertIf_UnsupportedIdentifier() public {
        bytes32 unsupportedIdentifier = "UNSUPPORTED";

        vm.expectRevert("Unsupported identifier");
        vm.prank(TestAddress.account1);
        optimisticOracleV3.assertTruth(
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
        optimisticOracleV3.setAdminProperties(unsupportedCurrency, defaultLiveness, burnedBondPercentage);
        vm.stopPrank();

        vm.expectRevert("Unsupported currency");
        optimisticOracleV3.assertTruthWithDefaults(trueClaimAssertion, TestAddress.account1);
    }

    function test_RevertIf_BondBelowMinimum() public {
        vm.expectRevert("Bond amount too low");
        optimisticOracleV3.assertTruth(
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
        optimisticOracleV3.disputeAssertion(bytes32(0), TestAddress.account2);

        vm.expectRevert("Assertion does not exist");
        optimisticOracleV3.settleAndGetAssertionResult(bytes32(0));

        vm.expectRevert("Assertion does not exist");
        optimisticOracleV3.settleAssertion(bytes32(0));
    }

    function test_RevertIf_DuplicateDispute() public {
        // Fund Account1 with enough currency to make an assertion.
        vm.startPrank(TestAddress.account1);
        defaultCurrency.allocateTo(TestAddress.account1, defaultBond);
        assert(defaultCurrency.balanceOf(TestAddress.account1) >= defaultBond);
        defaultCurrency.approve(address(optimisticOracleV3), defaultBond);

        // Account1 asserts a claim.
        bytes32 assertionId = optimisticOracleV3.assertTruthWithDefaults(falseClaimAssertion, TestAddress.account1);
        vm.stopPrank();

        // Fund Account2 with enough currency to dispute the assertion twice.
        vm.startPrank(TestAddress.account2);
        defaultCurrency.allocateTo(TestAddress.account2, defaultBond * 2);
        assert(defaultCurrency.balanceOf(TestAddress.account2) >= defaultBond * 2);
        defaultCurrency.approve(address(optimisticOracleV3), defaultBond * 2);

        // Account2 disputes the assertion.
        optimisticOracleV3.disputeAssertion(assertionId, TestAddress.account2);

        // Account2 should not be able to dispute the assertion again.
        vm.expectRevert("Assertion already disputed");
        optimisticOracleV3.disputeAssertion(assertionId, TestAddress.account2);
        vm.stopPrank();
    }

    function test_RevertIf_BurnedBondPercentageSetOutOfBounds() public {
        vm.expectRevert("Burned bond percentage is 0");
        vm.prank(TestAddress.owner);
        optimisticOracleV3.setAdminProperties(defaultCurrency, defaultLiveness, 0);

        vm.expectRevert("Burned bond percentage > 100");
        vm.prank(TestAddress.owner);
        optimisticOracleV3.setAdminProperties(defaultCurrency, defaultLiveness, 2e18);
    }
}

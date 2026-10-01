// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "./CommonOptimisticOracleV3Test.sol";

contract OptimisticOracleV3StaleWhitelistCacheTest is CommonOptimisticOracleV3Test {
    AddressWhitelist private collateralWhitelist;
    IdentifierWhitelist private identifierWhitelist;

    function setUp() public {
        _commonSetup();
        collateralWhitelist = AddressWhitelist(finder.getImplementationAddress(OracleInterfaces.CollateralWhitelist));
        identifierWhitelist = IdentifierWhitelist(
            finder.getImplementationAddress(OracleInterfaces.IdentifierWhitelist)
        );
    }

    function test_RemovedIdentifierIsRejectedWithoutManualSync() public {
        assertTrue(optimisticOracleV3.cachedIdentifiers(defaultIdentifier));
        vm.prank(TestAddress.owner);
        identifierWhitelist.removeSupportedIdentifier(defaultIdentifier);
        assertFalse(identifierWhitelist.isIdentifierSupported(defaultIdentifier));

        vm.startPrank(TestAddress.account1);
        defaultCurrency.allocateTo(TestAddress.account1, defaultBond);
        defaultCurrency.approve(address(optimisticOracleV3), defaultBond);
        vm.expectRevert("Unsupported identifier");
        optimisticOracleV3.assertTruthWithDefaults(falseClaimAssertion, TestAddress.account1);
        vm.stopPrank();
    }

    function test_RemovedCurrencyIsRejectedWithoutManualSync() public {
        (bool cachedWhitelist, ) = optimisticOracleV3.cachedCurrencies(address(defaultCurrency));
        assertTrue(cachedWhitelist);
        vm.prank(TestAddress.owner);
        collateralWhitelist.removeFromWhitelist(address(defaultCurrency));
        assertFalse(collateralWhitelist.isOnWhitelist(address(defaultCurrency)));

        vm.startPrank(TestAddress.account1);
        defaultCurrency.allocateTo(TestAddress.account1, defaultBond);
        defaultCurrency.approve(address(optimisticOracleV3), defaultBond);
        vm.expectRevert("Unsupported currency");
        optimisticOracleV3.assertTruthWithDefaults(falseClaimAssertion, TestAddress.account1);
        vm.stopPrank();
    }

    function test_ReaddedCurrencyPreservesFeeUntilExplicitSync() public {
        (, uint256 originalFee) = optimisticOracleV3.cachedCurrencies(address(defaultCurrency));
        uint256 updatedFee = originalFee * 2;

        vm.prank(TestAddress.owner);
        collateralWhitelist.removeFromWhitelist(address(defaultCurrency));

        vm.prank(TestAddress.account1);
        vm.expectRevert("Unsupported currency");
        optimisticOracleV3.assertTruthWithDefaults(falseClaimAssertion, TestAddress.account1);

        // Reverting validation cannot persist any cache writes.
        (bool cachedWhitelist, uint256 cachedFee) = optimisticOracleV3.cachedCurrencies(address(defaultCurrency));
        assertTrue(cachedWhitelist);
        assertEq(cachedFee, originalFee);

        vm.startPrank(TestAddress.owner);
        store.setFinalFee(address(defaultCurrency), FixedPoint.Unsigned(updatedFee));
        collateralWhitelist.addToWhitelist(address(defaultCurrency));
        vm.stopPrank();

        bytes32 assertionId = _allocateBondAndAssertTruth(TestAddress.account1, falseClaimAssertion);
        assertEq(optimisticOracleV3.getAssertion(assertionId).bond, defaultBond);
        (, cachedFee) = optimisticOracleV3.cachedCurrencies(address(defaultCurrency));
        assertEq(cachedFee, originalFee);

        optimisticOracleV3.syncUmaParams(defaultIdentifier, address(defaultCurrency));
        assertEq(optimisticOracleV3.getMinimumBond(address(defaultCurrency)), defaultBond * 2);
        bytes32 refreshedAssertionId = _allocateBondAndAssertTruth(TestAddress.account1, trueClaimAssertion);
        assertEq(optimisticOracleV3.getAssertion(refreshedAssertionId).bond, defaultBond * 2);
        (, cachedFee) = optimisticOracleV3.cachedCurrencies(address(defaultCurrency));
        assertEq(cachedFee, updatedFee);
    }

    function test_ReaddedIdentifierAllowsNewAssertionWithoutSync() public {
        vm.prank(TestAddress.owner);
        identifierWhitelist.removeSupportedIdentifier(defaultIdentifier);

        vm.prank(TestAddress.account1);
        vm.expectRevert("Unsupported identifier");
        optimisticOracleV3.assertTruthWithDefaults(falseClaimAssertion, TestAddress.account1);

        vm.prank(TestAddress.owner);
        identifierWhitelist.addSupportedIdentifier(defaultIdentifier);

        bytes32 assertionId = _allocateBondAndAssertTruth(TestAddress.account1, falseClaimAssertion);
        assertEq(optimisticOracleV3.getAssertion(assertionId).asserter, TestAddress.account1);
    }

    function test_IdentifierRemovalDuringLivenessStillBlocksDispute() public {
        // This documents the residual lifecycle risk; validation only protects new assertions.
        bytes32 assertionId = _allocateBondAndAssertTruth(TestAddress.account1, falseClaimAssertion);
        vm.prank(TestAddress.owner);
        identifierWhitelist.removeSupportedIdentifier(defaultIdentifier);

        vm.startPrank(TestAddress.account2);
        defaultCurrency.allocateTo(TestAddress.account2, defaultBond);
        defaultCurrency.approve(address(optimisticOracleV3), defaultBond);
        vm.expectRevert(); // MockOracleAncillary revalidates identifier support without a revert string.
        optimisticOracleV3.disputeAssertion(assertionId, TestAddress.account2);
        vm.stopPrank();

        assertEq(optimisticOracleV3.getAssertion(assertionId).disputer, address(0));
        assertEq(defaultCurrency.balanceOf(TestAddress.account2), defaultBond);
        assertEq(mockOracle.getPendingQueries().length, 0);

        timer.setCurrentTime(optimisticOracleV3.getAssertion(assertionId).expirationTime);
        assertTrue(optimisticOracleV3.settleAndGetAssertionResult(assertionId));
        assertEq(defaultCurrency.balanceOf(TestAddress.account1), defaultBond);
    }
}

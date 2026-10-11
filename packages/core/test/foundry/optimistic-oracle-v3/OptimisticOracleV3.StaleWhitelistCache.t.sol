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
}

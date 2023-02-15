// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "./CommonOptimisticOracleV3Test.sol";
import "../../../contracts/data-verification-mechanism/implementation/Store.sol";

contract MaintenanceTest is CommonOptimisticOracleV3Test {
    function setUp() public {
        _commonSetup();
    }

    function test_OwnershipPermissions() public {
        assertEq(optimisticOracleV3.owner(), TestAddress.owner);

        vm.expectRevert("Ownable: caller is not the owner");
        optimisticOracleV3.transferOwnership(TestAddress.account1);

        vm.prank(TestAddress.owner); // Check that the owner can change the owner.
        optimisticOracleV3.transferOwnership(TestAddress.account1);
        assertEq(optimisticOracleV3.owner(), TestAddress.account1);
    }

    function test_OwnershipFunctionality() public {
        vm.expectRevert("Ownable: caller is not the owner");
        optimisticOracleV3.setAdminProperties(IERC20(TestAddress.random), 69, 0.3e18);

        vm.prank(TestAddress.owner);
        optimisticOracleV3.setAdminProperties(IERC20(TestAddress.random), 69, 0.3e18);
        assertEq(address(optimisticOracleV3.defaultCurrency()), TestAddress.random);
        assertEq(optimisticOracleV3.defaultLiveness(), 69);
        assertEq(optimisticOracleV3.burnedBondPercentage(), 0.3e18);
    }

    function test_SyncUmaOracle() public {
        MockOracleAncillary newOracle = new MockOracleAncillary(address(finder), address(timer));
        vm.prank(TestAddress.owner);
        finder.changeImplementationAddress(OracleInterfaces.Oracle, address(newOracle));

        // Sync only Oracle address through the Finder.
        optimisticOracleV3.syncUmaParams(bytes32(0), address(0));
        assertEq(optimisticOracleV3.cachedOracle(), address(newOracle));
    }

    function test_NewCurrency() public {
        TestnetERC20 newCurrency = new TestnetERC20("New Currency", "NEW", 18);
        uint256 newCurrencyBond = 100e18;
        uint256 newCurrencyFinalFee = (newCurrencyBond * optimisticOracleV3.burnedBondPercentage()) / 1e18;
        AddressWhitelist addressWhitelist =
            AddressWhitelist(finder.getImplementationAddress(OracleInterfaces.CollateralWhitelist));
        Store store = Store(finder.getImplementationAddress(OracleInterfaces.Store));

        vm.startPrank(TestAddress.owner);
        addressWhitelist.addToWhitelist(address(newCurrency));
        store.setFinalFee(address(newCurrency), FixedPoint.Unsigned(newCurrencyFinalFee));
        vm.stopPrank();

        // New currency should be automatically added to cache when creating new assertion.
        vm.startPrank(TestAddress.account1);
        newCurrency.allocateTo(TestAddress.account1, newCurrencyBond);
        newCurrency.approve(address(optimisticOracleV3), newCurrencyBond);
        optimisticOracleV3.assertTruth(
            trueClaimAssertion,
            TestAddress.account1,
            address(0),
            address(0),
            defaultLiveness,
            newCurrency,
            newCurrencyBond,
            defaultIdentifier,
            bytes32(0) // No domain
        );
        vm.stopPrank();
        (bool cachedWhitelist, uint256 cachedFinalFee) = optimisticOracleV3.cachedCurrencies(address(newCurrency));
        assertTrue(cachedWhitelist);
        assertEq(cachedFinalFee, newCurrencyFinalFee);
    }

    function test_NewIdentifier() public {
        bytes32 newIdentifier = "New Identifier";
        IdentifierWhitelistInterface identifierWhitelist =
            IdentifierWhitelistInterface(finder.getImplementationAddress(OracleInterfaces.IdentifierWhitelist));

        vm.prank(TestAddress.owner);
        identifierWhitelist.addSupportedIdentifier(newIdentifier);

        // New identifier should be automatically added to cache when creating new assertion.
        vm.startPrank(TestAddress.account1);
        defaultCurrency.allocateTo(TestAddress.account1, defaultBond);
        defaultCurrency.approve(address(optimisticOracleV3), defaultBond);
        optimisticOracleV3.assertTruth(
            trueClaimAssertion,
            TestAddress.account1,
            address(0),
            address(0),
            defaultLiveness,
            defaultCurrency,
            defaultBond,
            newIdentifier,
            bytes32(0) // No domain
        );
        vm.stopPrank();
        assertTrue(optimisticOracleV3.cachedIdentifiers(newIdentifier));
    }
}

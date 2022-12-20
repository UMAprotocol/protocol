// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "./Common.sol";
import "../../../contracts/data-verification-mechanism/implementation/Store.sol";

contract MaintenanceTest is Common {
    function setUp() public {
        _commonSetup();
    }

    function test_OwnershipPermissions() public {
        assertEq(optimisticAsserter.owner(), TestAddress.owner);

        vm.expectRevert("Ownable: caller is not the owner");
        optimisticAsserter.transferOwnership(TestAddress.account1);

        vm.prank(TestAddress.owner); // Check that the owner can change the owner.
        optimisticAsserter.transferOwnership(TestAddress.account1);
        assertEq(optimisticAsserter.owner(), TestAddress.account1);
    }

    function test_OwnershipFunctionality() public {
        vm.expectRevert("Ownable: caller is not the owner");
        optimisticAsserter.setAdminProperties(IERC20(TestAddress.random), 69, 0.3e18);

        vm.prank(TestAddress.owner);
        optimisticAsserter.setAdminProperties(IERC20(TestAddress.random), 69, 0.3e18);
        assertEq(address(optimisticAsserter.defaultCurrency()), TestAddress.random);
        assertEq(optimisticAsserter.defaultLiveness(), 69);
        assertEq(optimisticAsserter.burnedBondPercentage(), 0.3e18);
    }

    function test_SyncUmaOracle() public {
        MockOracleAncillary newOracle = new MockOracleAncillary(address(finder), address(timer));
        vm.prank(TestAddress.owner);
        finder.changeImplementationAddress(OracleInterfaces.Oracle, address(newOracle));

        // Sync only Oracle address through the Finder.
        optimisticAsserter.syncUmaParams(bytes32(0), address(0));
        assertEq(optimisticAsserter.cachedOracle(), address(newOracle));
    }

    function test_NewCurrency() public {
        TestnetERC20 newCurrency = new TestnetERC20("New Currency", "NEW", 18);
        uint256 newCurrencyBond = 100e18;
        uint256 newCurrencyFinalFee = (newCurrencyBond * optimisticAsserter.burnedBondPercentage()) / 1e18;
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
        newCurrency.approve(address(optimisticAsserter), newCurrencyBond);
        optimisticAsserter.assertTruth(
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
        (bool cachedWhitelist, uint256 cachedFinalFee) = optimisticAsserter.cachedCurrencies(address(newCurrency));
        assertTrue(cachedWhitelist);
        assertEq(cachedFinalFee, newCurrencyFinalFee);
    }

    function test_NewCurrencyWithBadFinalFee() public {
        TestnetERC20 newCurrency = new TestnetERC20("New Currency", "NEW", 18);
        uint256 newCurrencyBond = 100e18;

        // Whitelist the currency but dont set the final fee in the store. This currency is effectively misconfigured.
        AddressWhitelist addressWhitelist =
            AddressWhitelist(finder.getImplementationAddress(OracleInterfaces.CollateralWhitelist));

        vm.prank(TestAddress.owner);
        addressWhitelist.addToWhitelist(address(newCurrency));

        // Assertion should revert due to the currency not having a final fee set.
        vm.startPrank(TestAddress.account1);
        newCurrency.allocateTo(TestAddress.account1, newCurrencyBond);
        newCurrency.approve(address(optimisticAsserter), newCurrencyBond);
        vm.expectRevert("Unsupported currency");
        optimisticAsserter.assertTruth(
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

        // Set the final fee and the assertion should succeed and the cashe should update as well.
        Store store = Store(finder.getImplementationAddress(OracleInterfaces.Store));
        uint256 newCurrencyFinalFee = (newCurrencyBond * optimisticAsserter.burnedBondPercentage()) / 1e18;
        vm.prank(TestAddress.owner);
        store.setFinalFee(address(newCurrency), FixedPoint.Unsigned(newCurrencyFinalFee));

        vm.prank(TestAddress.account1);
        optimisticAsserter.assertTruth(
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
        (bool cachedWhitelist, uint256 cachedFinalFee) = optimisticAsserter.cachedCurrencies(address(newCurrency));
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
        defaultCurrency.approve(address(optimisticAsserter), defaultBond);
        optimisticAsserter.assertTruth(
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
        assertTrue(optimisticAsserter.cachedIdentifiers(newIdentifier));
    }
}

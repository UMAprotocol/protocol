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
        optimisticAsserter.setAssertionDefaults(IERC20(TestAddress.random), 69);

        vm.prank(TestAddress.owner);
        optimisticAsserter.setAssertionDefaults(IERC20(TestAddress.random), 69);
        assertEq(address(optimisticAsserter.defaultCurrency()), TestAddress.random);
        assertEq(optimisticAsserter.defaultLiveness(), 69);

        vm.expectRevert("Ownable: caller is not the owner");
        optimisticAsserter.setBurnedBondPercentage(0.3e18);

        vm.prank(TestAddress.owner);
        optimisticAsserter.setBurnedBondPercentage(0.3e18);
        assertEq(optimisticAsserter.burnedBondPercentage(), 0.3e18);
    }

    function test_SyncUmaOracle() public {
        MockOracleAncillary newOracle = new MockOracleAncillary(address(finder), address(timer));
        vm.prank(TestAddress.owner);
        finder.changeImplementationAddress(OracleInterfaces.Oracle, address(newOracle));

        // Sync only Oracle address through the Finder.
        optimisticAsserter.syncUmaParams(bytes32(0), address(0));
        // Oracle address is the only CachedUmaParams struct element exposed in the getter function.
        assertEq(optimisticAsserter.cachedUmaParams(), address(newOracle));
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
        optimisticAsserter.assertTruthFor(
            trueClaimAssertion,
            address(0),
            address(0),
            address(0),
            newCurrency,
            newCurrencyBond,
            defaultLiveness,
            defaultIdentifier
        );
        vm.stopPrank();
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
        optimisticAsserter.assertTruthFor(
            trueClaimAssertion,
            address(0),
            address(0),
            address(0),
            defaultCurrency,
            defaultBond,
            defaultLiveness,
            newIdentifier
        );
        vm.stopPrank();
    }
}

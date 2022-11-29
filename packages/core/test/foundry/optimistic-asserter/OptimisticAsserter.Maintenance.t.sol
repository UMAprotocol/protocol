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

    function test_SyncCurrency() public {
        TestnetERC20 newCurrency = new TestnetERC20("New Currency", "NEW", 18);
        uint256 newCurrencyFinalFee = 50e18; // Half of expected minimum bond.
        AddressWhitelist addressWhitelist =
            AddressWhitelist(finder.getImplementationAddress(OracleInterfaces.CollateralWhitelist));
        Store store = Store(finder.getImplementationAddress(OracleInterfaces.Store));

        vm.startPrank(TestAddress.owner);
        addressWhitelist.addToWhitelist(address(newCurrency));
        store.setFinalFee(address(newCurrency), FixedPoint.Unsigned(newCurrencyFinalFee));
        vm.stopPrank();

        // Before sync new currency final fee and bond would be 0 and assertion would revert.
        vm.startPrank(TestAddress.account1);
        assertEq(optimisticAsserter.getMinimumBond(address(newCurrency)), 0);
        vm.expectRevert("Unsupported currency");
        optimisticAsserter.assertTruthFor(
            trueClaimAssertion,
            address(0),
            address(0),
            address(0),
            newCurrency,
            0,
            defaultLiveness,
            defaultIdentifier
        );

        // Sync new currency and calculate minimum bond. Now assertion should succeed.
        optimisticAsserter.syncUmaParams(bytes32(0), address(newCurrency));
        uint256 newCurrencyBond = optimisticAsserter.getMinimumBond(address(newCurrency));

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

    function test_SyncIdentifier() public {
        bytes32 newIdentifier = "New Identifier";
        IdentifierWhitelistInterface identifierWhitelist =
            IdentifierWhitelistInterface(finder.getImplementationAddress(OracleInterfaces.IdentifierWhitelist));

        vm.prank(TestAddress.owner);
        identifierWhitelist.addSupportedIdentifier(newIdentifier);

        // Before sync new identifier would be unsupported and assertion would revert.
        vm.startPrank(TestAddress.account1);
        vm.expectRevert("Unsupported identifier");
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

        // Sync new identifier and now assertion should succeed.
        optimisticAsserter.syncUmaParams(newIdentifier, address(0));
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

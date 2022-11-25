pragma solidity 0.8.16;

import "forge-std/Test.sol"; // Import forge std test and TestAddresses. No downstream contracts need to re-import.
import "../common/TestAddress.sol";
import "../common/TimerFixture.sol";

import "../../../../contracts/common/implementation/AddressWhitelist.sol";
import "../../../../contracts/data-verification-mechanism/implementation/Finder.sol";
import "../../../../contracts/data-verification-mechanism/implementation/Store.sol";
import "../../../../contracts/data-verification-mechanism/implementation/IdentifierWhitelist.sol";
import "../../../../contracts/data-verification-mechanism/implementation/Constants.sol";

// Fixture to setup base DVM contracts: Finder, Store, Address whitelist and Identifier whitelist.
contract BaseDvmFixture is Test {
    struct BaseDvmContracts {
        Timer timer;
        Finder finder;
        Store store;
        AddressWhitelist addressWhitelist;
        IdentifierWhitelist identifierWhitelist;
    }

    function setUp() public returns (BaseDvmContracts memory) {
        vm.startPrank(TestAddress.owner); // Use the owner as the deployment address for all base DVM contracts.
        Timer timer = new TimerFixture().setUp();
        Finder finder = new Finder();
        Store store = new Store(FixedPoint.fromUnscaledUint(0), FixedPoint.fromUnscaledUint(0), address(timer));
        AddressWhitelist addressWhitelist = new AddressWhitelist();
        IdentifierWhitelist identifierWhitelist = new IdentifierWhitelist();

        finder.changeImplementationAddress(OracleInterfaces.Store, address(store));
        finder.changeImplementationAddress(OracleInterfaces.CollateralWhitelist, address(addressWhitelist));
        finder.changeImplementationAddress(OracleInterfaces.IdentifierWhitelist, address(identifierWhitelist));

        vm.stopPrank(); // Return caller address to standard.

        return BaseDvmContracts(timer, finder, store, addressWhitelist, identifierWhitelist);
    }
}

contract BaseDvmFixtureTest is Test {
    function testRegistration() public {
        BaseDvmFixture.BaseDvmContracts memory baseDvmContracts = new BaseDvmFixture().setUp();
        // Check all addresses are correctly placed in the finder.
        assertEq(
            baseDvmContracts.finder.getImplementationAddress(OracleInterfaces.Store),
            address(baseDvmContracts.store)
        );
        assertEq(
            baseDvmContracts.finder.getImplementationAddress(OracleInterfaces.CollateralWhitelist),
            address(baseDvmContracts.addressWhitelist)
        );
        assertEq(
            baseDvmContracts.finder.getImplementationAddress(OracleInterfaces.IdentifierWhitelist),
            address(baseDvmContracts.identifierWhitelist)
        );

        vm.expectRevert("Implementation not found"); // Check non-registered identifier reverts.
        baseDvmContracts.finder.getImplementationAddress(OracleInterfaces.Bridge);
    }
}

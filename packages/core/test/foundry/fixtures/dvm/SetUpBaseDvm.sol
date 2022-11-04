pragma solidity 0.8.16;

// Import forge std test and TestAddresses. All downstream contracts that use this fixture will not need to re-import.
import "forge-std/Test.sol";
import "../common/TestAddress.sol";
import "../common/SetUpTimer.sol";

import "../../../../contracts/common/implementation/AddressWhitelist.sol";
import "../../../../contracts/oracle/implementation/Finder.sol";
import "../../../../contracts/oracle/implementation/Store.sol";
import "../../../../contracts/oracle/implementation/identifierWhitelist.sol";
import "../../../../contracts/oracle/implementation/Constants.sol";

contract SetUpBaseDvm is Test {
    struct BaseDvmContracts {
        Timer timer;
        Finder finder;
        Store store;
        AddressWhitelist addressWhitelist;
        IdentifierWhitelist identifierWhitelist;
    }

    function setUp() public returns (BaseDvmContracts memory) {
        vm.startPrank(TestAddress.owner); // Use the owner as the deployment address for all base DVM contracts.
        Timer timer = new SetUpTimer().setUp();
        Finder finder = new Finder();
        Store store = new Store(FixedPoint.fromUnscaledUint(0), FixedPoint.fromUnscaledUint(0), address(timer));
        AddressWhitelist addressWhitelist = new AddressWhitelist();
        IdentifierWhitelist identifierWhitelist = new IdentifierWhitelist();

        finder.changeImplementationAddress(OracleInterfaces.Store, address(store));
        finder.changeImplementationAddress(OracleInterfaces.CollateralWhitelist, address(addressWhitelist));
        finder.changeImplementationAddress(OracleInterfaces.IdentifierWhitelist, address(identifierWhitelist));

        vm.stopPrank(); // Return caller address to standard.

        return (BaseDvmContracts(timer, finder, store, addressWhitelist, identifierWhitelist));
    }
}

contract SetUpBaseDvmTest is Test {
    function testRegistration() public {
        SetUpBaseDvm.BaseDvmContracts memory baseDvmContracts = new SetUpBaseDvm().setUp();
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

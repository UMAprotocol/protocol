pragma solidity 0.8.16;

import "./BaseDvmFixture.sol";
import "../../../../contracts/data-verification-mechanism/test/MockOracleAncillary.sol";

// Fixture to extend the base DVM fixture with a mock oracle. Used when not directly testing the DVM.
contract MockDvmFixture is Test {
    struct BaseMockDvmContracts {
        Timer timer;
        Finder finder;
        Store store;
        AddressWhitelist addressWhitelist;
        IdentifierWhitelist identifierWhitelist;
        MockOracleAncillary mockOracle;
    }

    function setUp() public returns (BaseMockDvmContracts memory) {
        BaseDvmFixture.BaseDvmContracts memory baseDvmContracts = new BaseDvmFixture().setUp();

        MockOracleAncillary mockOracle =
            new MockOracleAncillary(address(baseDvmContracts.finder), address(baseDvmContracts.timer));
        vm.prank(TestAddress.owner);
        baseDvmContracts.finder.changeImplementationAddress(OracleInterfaces.Oracle, address(mockOracle));

        return
            BaseMockDvmContracts(
                baseDvmContracts.timer,
                baseDvmContracts.finder,
                baseDvmContracts.store,
                baseDvmContracts.addressWhitelist,
                baseDvmContracts.identifierWhitelist,
                mockOracle
            );
    }
}

contract MockDvmFixtureTest is Test {
    function testMockOracle() public {
        MockDvmFixture.BaseMockDvmContracts memory baseDvmMockContracts = new MockDvmFixture().setUp();
        vm.expectRevert(); // Reverts when there is no price yet.
        baseDvmMockContracts.mockOracle.getPrice("TEST", 420, "0x");
        vm.expectRevert("Can't push prices that haven't been requested"); // Reverts when there is no price yet.
        baseDvmMockContracts.mockOracle.pushPrice("TEST", 420, "0x", 100);

        vm.prank(TestAddress.owner); // Now show we can actually request and push a price.
        baseDvmMockContracts.identifierWhitelist.addSupportedIdentifier("TEST");
        baseDvmMockContracts.mockOracle.requestPrice("TEST", 420, "0x");
        baseDvmMockContracts.mockOracle.pushPrice("TEST", 420, "0x", 100);
        assertEq(baseDvmMockContracts.mockOracle.getPrice("TEST", 420, "0x"), 100);
    }
}

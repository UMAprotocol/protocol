pragma solidity 0.8.16;

import "./SetUpBaseDvm.sol";

import "../../../../contracts/oracle/test/MockOracleAncillary.sol";

contract SetUpMockDvm {
    struct BaseMockDvmContracts {
        Timer timer;
        Finder finder;
        Store store;
        AddressWhitelist addressWhitelist;
        IdentifierWhitelist identifierWhitelist;
        MockOracleAncillary mockOracle;
    }

    function setUp() public returns (BaseMockDvmContracts memory) {
        SetUpBaseDvm.BaseDvmContracts memory baseDvmContracts = new SetUpBaseDvm().setUp();

        MockOracleAncillary mockOracle =
            new MockOracleAncillary(address(baseDvmContracts.finder), address(baseDvmContracts.timer));
        return (
            BaseMockDvmContracts(
                baseDvmContracts.timer,
                baseDvmContracts.finder,
                baseDvmContracts.store,
                baseDvmContracts.addressWhitelist,
                baseDvmContracts.identifierWhitelist,
                mockOracle
            )
        );
    }
}

contract SetUpMockDvmTest is Test {
    function testMockOracle() public {
        SetUpMockDvm.BaseMockDvmContracts memory baseDvmMockContracts = new SetUpMockDvm().setUp();
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

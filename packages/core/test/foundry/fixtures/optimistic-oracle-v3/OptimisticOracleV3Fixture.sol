pragma solidity 0.8.16;

import "../dvm/MockDvmFixture.sol";

import "../../../../contracts/optimistic-oracle-v3/implementation/test/OptimisticOracleV3Test.sol";
import "../../../../contracts/common/implementation/TestnetERC20.sol";

// Fixture to deploy a configured OptimisticOracleV3Test with reasonable default values.
contract OptimisticOracleV3Fixture is Test {
    struct OptimisticOracleV3Contracts {
        Timer timer;
        Finder finder;
        Store store;
        AddressWhitelist addressWhitelist;
        IdentifierWhitelist identifierWhitelist;
        MockOracleAncillary mockOracle;
        TestnetERC20 defaultCurrency;
        OptimisticOracleV3Test optimisticOracleV3;
    }

    function setUp() public returns (OptimisticOracleV3Contracts memory) {
        MockDvmFixture.BaseMockDvmContracts memory baseMockDvmContracts = new MockDvmFixture().setUp();

        TestnetERC20 defaultCurrency = new TestnetERC20("Default Bond Token", "DBT", 18);

        vm.startPrank(TestAddress.owner);

        baseMockDvmContracts.addressWhitelist.addToWhitelist(address(defaultCurrency));
        baseMockDvmContracts.identifierWhitelist.addSupportedIdentifier("ASSERT_TRUTH");
        uint256 defaultCurrencyFinalFee = 50e18; // Half of expected minimum bond.
        uint64 defaultLiveness = 7200; // 2 hours
        baseMockDvmContracts.store.setFinalFee(address(defaultCurrency), FixedPoint.Unsigned(defaultCurrencyFinalFee));
        OptimisticOracleV3Test optimisticOracleV3 =
            new OptimisticOracleV3Test(
                baseMockDvmContracts.finder,
                defaultCurrency,
                defaultLiveness,
                address(baseMockDvmContracts.timer)
            );

        vm.stopPrank();

        return
            OptimisticOracleV3Contracts(
                baseMockDvmContracts.timer,
                baseMockDvmContracts.finder,
                baseMockDvmContracts.store,
                baseMockDvmContracts.addressWhitelist,
                baseMockDvmContracts.identifierWhitelist,
                baseMockDvmContracts.mockOracle,
                defaultCurrency,
                optimisticOracleV3
            );
    }
}

contract OptimisticOracleV3FixtureTest is Test {
    function testDefaultConfiguration() public {
        OptimisticOracleV3Fixture.OptimisticOracleV3Contracts memory ooContracts =
            new OptimisticOracleV3Fixture().setUp();

        ooContracts.addressWhitelist.isOnWhitelist(address(ooContracts.defaultCurrency));
        ooContracts.identifierWhitelist.isIdentifierSupported("ASSERT_TRUTH");
        assertEq(address(ooContracts.optimisticOracleV3.defaultCurrency()), address(ooContracts.defaultCurrency));
        assertEq(ooContracts.optimisticOracleV3.getMinimumBond(address(ooContracts.defaultCurrency)), 100e18);
        assertEq(ooContracts.optimisticOracleV3.defaultLiveness(), 7200);
    }
}

pragma solidity 0.8.16;

import "../dvm/MockDvmFixture.sol";

import "../../../../contracts/optimistic-asserter/implementation/test/OptimisticAsserterTest.sol";
import "../../../../contracts/common/implementation/TestnetERC20.sol";

// Fixture to deploy a configured OptimisticAsserterTest with reasonable default values.
contract OptimisticAsserterFixture is Test {
    struct OptimisticAsserterContracts {
        Timer timer;
        Finder finder;
        Store store;
        AddressWhitelist addressWhitelist;
        IdentifierWhitelist identifierWhitelist;
        MockOracleAncillary mockOracle;
        TestnetERC20 defaultCurrency;
        OptimisticAsserterTest optimisticAsserter;
    }

    function setUp() public returns (OptimisticAsserterContracts memory) {
        MockDvmFixture.BaseMockDvmContracts memory baseMockDvmContracts = new MockDvmFixture().setUp();

        TestnetERC20 defaultCurrency = new TestnetERC20("Default Bond Token", "DBT", 18);

        vm.startPrank(TestAddress.owner);

        baseMockDvmContracts.addressWhitelist.addToWhitelist(address(defaultCurrency));
        baseMockDvmContracts.identifierWhitelist.addSupportedIdentifier("ASSERT_TRUTH");
        uint256 defaultCurrencyFinalFee = 50e18; // Half of expected minimum bond.
        uint64 defaultLiveness = 7200; // 2 hours
        baseMockDvmContracts.store.setFinalFee(address(defaultCurrency), FixedPoint.Unsigned(defaultCurrencyFinalFee));
        OptimisticAsserterTest optimisticAsserter =
            new OptimisticAsserterTest(
                baseMockDvmContracts.finder,
                defaultCurrency,
                defaultLiveness,
                address(baseMockDvmContracts.timer)
            );

        vm.stopPrank();

        return
            OptimisticAsserterContracts(
                baseMockDvmContracts.timer,
                baseMockDvmContracts.finder,
                baseMockDvmContracts.store,
                baseMockDvmContracts.addressWhitelist,
                baseMockDvmContracts.identifierWhitelist,
                baseMockDvmContracts.mockOracle,
                defaultCurrency,
                optimisticAsserter
            );
    }
}

contract OptimisticAsserterFixtureTest is Test {
    function testDefaultConfiguration() public {
        OptimisticAsserterFixture.OptimisticAsserterContracts memory oaContracts =
            new OptimisticAsserterFixture().setUp();

        oaContracts.addressWhitelist.isOnWhitelist(address(oaContracts.defaultCurrency));
        oaContracts.identifierWhitelist.isIdentifierSupported("ASSERT_TRUTH");
        assertEq(address(oaContracts.optimisticAsserter.defaultCurrency()), address(oaContracts.defaultCurrency));
        assertEq(oaContracts.optimisticAsserter.getMinimumBond(address(oaContracts.defaultCurrency)), 100e18);
        assertEq(oaContracts.optimisticAsserter.defaultLiveness(), 7200);
    }
}

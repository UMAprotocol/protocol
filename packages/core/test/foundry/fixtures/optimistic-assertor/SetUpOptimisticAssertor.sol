pragma solidity 0.8.16;

import "forge-std/Test.sol";

import "../dvm/SetUpMockDvm.sol";

import "../../../../contracts/optimistic-assertor/implementation/OptimisticAssertor.sol";
import "../../../../contracts/common/implementation/TestnetERC20.sol";

contract SetUpOptimisticAssertor is Test {
    struct OptimisticAsserterContracts {
        Timer timer;
        Finder finder;
        Store store;
        AddressWhitelist addressWhitelist;
        IdentifierWhitelist identifierWhitelist;
        MockOracleAncillary mockOracle;
        TestnetERC20 defaultCurrency;
        OptimisticAssertor optimisticAssertor;
    }

    function setUp() public returns (OptimisticAsserterContracts memory) {
        SetUpMockDvm.BaseMockDvmContracts memory baseMockDvmContracts = new SetUpMockDvm().setUp();

        TestnetERC20 defaultCurrency = new TestnetERC20("Default Bond Token", "DBT", 18);

        vm.startPrank(TestAddress.owner);
        baseMockDvmContracts.addressWhitelist.addToWhitelist(address(defaultCurrency));
        baseMockDvmContracts.identifierWhitelist.addSupportedIdentifier("ASSERT_TRUTH");
        uint256 defaultBond = 100e18;
        uint256 defaultLiveness = 7200; // 2 hours
        OptimisticAssertor optimisticAssertor =
            new OptimisticAssertor(baseMockDvmContracts.finder, defaultCurrency, defaultBond, defaultLiveness);

        vm.stopPrank();

        return (
            OptimisticAsserterContracts(
                baseMockDvmContracts.timer,
                baseMockDvmContracts.finder,
                baseMockDvmContracts.store,
                baseMockDvmContracts.addressWhitelist,
                baseMockDvmContracts.identifierWhitelist,
                baseMockDvmContracts.mockOracle,
                defaultCurrency,
                optimisticAssertor
            )
        );
    }
}

contract SetUpOptimisticAssertorTest is Test {
    function testDefaultConfiguration() public {
        SetUpOptimisticAssertor.OptimisticAsserterContracts memory oaContracts = new SetUpOptimisticAssertor().setUp();

        oaContracts.addressWhitelist.isOnWhitelist(address(oaContracts.defaultCurrency));
        oaContracts.identifierWhitelist.isIdentifierSupported("ASSERT_TRUTH");
        assertEq(address(oaContracts.optimisticAssertor.defaultCurrency()), address(oaContracts.defaultCurrency));
        assertEq(oaContracts.optimisticAssertor.defaultBond(), 100e18);
        assertEq(oaContracts.optimisticAssertor.defaultLiveness(), 7200);
    }
}

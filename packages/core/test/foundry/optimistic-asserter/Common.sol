// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "forge-std/Test.sol";
import "../fixtures/optimistic-asserter/OptimisticAsserterFixture.sol";
import "../fixtures/common/TestAddress.sol";
import "../../../contracts/data-verification-mechanism/test/MockOracleAncillary.sol";
import "../../../contracts/optimistic-asserter/implementation/test/AssertingCallerTest.sol";

contract Common is Test {
    // Data structures, that might be used in tests.
    struct OracleRequest {
        bytes32 identifier;
        uint256 time;
        bytes ancillaryData;
    }

    struct BalancesBeforeSettle {
        uint256 asserter;
        uint256 disputer;
        uint256 store;
    }

    BalancesBeforeSettle balancesBeforeSettle;

    // Contract instances, that might be used in tests.
    OptimisticAsserter optimisticAsserter;
    TestnetERC20 defaultCurrency;
    Timer timer;
    Finder finder;
    MockOracleAncillary mockOracle;
    Store store;
    AssertingCallerTest assertingCaller;

    // Constants, that might be used in tests.
    bytes constant trueClaimAssertion = bytes("q:'The sky is blue'");
    bytes constant falseClaimAssertion = bytes("q:'The sky is red'");
    uint256 burnedBondPercentage;
    uint256 defaultBond;
    uint64 defaultLiveness;
    bytes32 defaultIdentifier;

    // Mock addresses, used to prank calls.
    address constant mockOptimisticAsserterAddress = address(0xfa);
    address constant mockedEscalationManager = address(0xfb);
    address constant mockedCallbackRecipient = address(0xfc);
    address constant mockAssertingCallerAddress = address(0xfd);

    // Event structures, that might be used in tests.
    event AssertionMade(
        bytes32 indexed assertionId,
        bytes32 domainId,
        bytes claim,
        address indexed asserter,
        address callbackRecipient,
        address indexed escalationManager,
        address caller,
        uint64 expirationTime,
        IERC20 currency,
        uint256 bond
    );
    event AssertionDisputed(bytes32 indexed assertionId, address indexed disputer);

    event PriceRequestAdded(address indexed requester, bytes32 indexed identifier, uint256 time, bytes ancillaryData);

    event AssertionSettled(
        bytes32 indexed assertionId,
        address indexed bondRecipient,
        bool disputed,
        bool settlementResolution,
        address settleCaller
    );

    event AssertingCallerSet(address indexed assertingCaller);

    // Common setup function, re-used in most tests.
    function _commonSetup() public {
        OptimisticAsserterFixture.OptimisticAsserterContracts memory oaContracts =
            new OptimisticAsserterFixture().setUp();
        optimisticAsserter = oaContracts.optimisticAsserter;
        defaultCurrency = oaContracts.defaultCurrency;
        mockOracle = oaContracts.mockOracle;
        timer = oaContracts.timer;
        finder = oaContracts.finder;
        store = oaContracts.store;
        assertingCaller = new AssertingCallerTest(optimisticAsserter);
        burnedBondPercentage = optimisticAsserter.burnedBondPercentage();
        defaultBond = optimisticAsserter.getMinimumBond(address(defaultCurrency));
        defaultLiveness = optimisticAsserter.defaultLiveness();
        defaultIdentifier = optimisticAsserter.defaultIdentifier();
    }

    // Helper functions, re-used in some tests.
    function _mockSsPolicy(
        bool blockAssertion,
        bool arbitrateViaEscalationManager,
        bool discardOracle,
        bool validateDisputers
    ) internal {
        // Mock getAssertionPolicy call to block assertion. No need to pass assertionId as mockCall uses loose matching.
        vm.mockCall(
            mockedEscalationManager,
            abi.encodePacked(EscalationManagerInterface.getAssertionPolicy.selector),
            abi.encode(
                EscalationManagerInterface.AssertionPolicy({
                    blockAssertion: blockAssertion,
                    arbitrateViaEscalationManager: arbitrateViaEscalationManager,
                    discardOracle: discardOracle,
                    validateDisputers: validateDisputers
                })
            )
        );
    }

    function _mockSsDisputerCheck(bool isDisputeAllowed) internal {
        // Mock isDisputeAllowed call with desired response. No need to pass parameters as mockCall uses loose matching.
        vm.mockCall(
            mockedEscalationManager,
            abi.encodePacked(EscalationManagerInterface.isDisputeAllowed.selector),
            abi.encode(isDisputeAllowed)
        );
    }

    function _mockOracleResolved(
        address oracle,
        OracleRequest memory oracleRequest,
        bool assertionTruthful
    ) internal {
        // Mock getPrice call based on desired response. Also works on Sovereign Security.
        vm.mockCall(
            oracle,
            abi.encodeWithSelector(
                MockOracleAncillary.getPrice.selector,
                oracleRequest.identifier,
                oracleRequest.time,
                oracleRequest.ancillaryData
            ),
            abi.encode(assertionTruthful ? int256(1e18) : int256(0))
        );
    }

    function _assertWithCallbackRecipientAndSs(address callbackRecipient, address escalationManager)
        internal
        returns (bytes32)
    {
        vm.prank(TestAddress.account1);
        return
            optimisticAsserter.assertTruth(
                trueClaimAssertion,
                TestAddress.account1,
                callbackRecipient,
                escalationManager,
                defaultLiveness,
                defaultCurrency,
                defaultBond,
                defaultIdentifier,
                bytes32(0) // No domain.
            );
    }

    function _wrappedAssertWithCallbackRecipientAndSs(address callbackRecipient, address escalationManager)
        internal
        returns (bytes32)
    {
        vm.prank(TestAddress.account1);
        return
            assertingCaller.assertTruth(
                trueClaimAssertion,
                callbackRecipient,
                escalationManager,
                defaultLiveness,
                defaultCurrency,
                defaultBond,
                defaultIdentifier,
                bytes32(0) // No domain.
            );
    }

    function _disputeAndGetOracleRequest(bytes32 assertionId, uint256 bond) internal returns (OracleRequest memory) {
        // Get expected oracle request on dispute.
        OptimisticAsserterInterface.Assertion memory assertion = optimisticAsserter.getAssertion(assertionId);
        OracleRequest memory oracleRequest =
            OracleRequest({
                identifier: optimisticAsserter.defaultIdentifier(),
                time: assertion.assertionTime,
                ancillaryData: optimisticAsserter.stampAssertion(assertionId)
            });

        // Fund Account2 and make dispute.
        vm.startPrank(TestAddress.account2);
        defaultCurrency.allocateTo(TestAddress.account2, bond);
        defaultCurrency.approve(address(optimisticAsserter), bond);
        optimisticAsserter.disputeAssertion(assertionId, TestAddress.account2);
        vm.stopPrank();
        return oracleRequest;
    }

    function _allocateBondAndAssertTruth(address asserter, bytes memory claim) public returns (bytes32 assertionId) {
        vm.startPrank(asserter);
        defaultCurrency.allocateTo(asserter, optimisticAsserter.getMinimumBond(address(defaultCurrency)));
        defaultCurrency.approve(
            address(optimisticAsserter),
            optimisticAsserter.getMinimumBond(address(defaultCurrency))
        );
        assertionId = optimisticAsserter.assertTruthWithDefaults(claim, asserter);
        vm.stopPrank();
    }

    function _expectAssertionResolvedCallback(
        address callbackRecipient,
        bytes32 assertionId,
        bool assertedTruthfully
    ) internal {
        vm.expectCall(
            callbackRecipient,
            abi.encodeWithSelector(
                OptimisticAsserterCallbackRecipientInterface.assertionResolvedCallback.selector,
                assertionId,
                assertedTruthfully
            )
        );
    }

    function _expectAssertionDisputedCallback(address callbackRecipient, bytes32 assertionId) internal {
        vm.expectCall(
            callbackRecipient,
            abi.encodeWithSelector(
                OptimisticAsserterCallbackRecipientInterface.assertionDisputedCallback.selector,
                assertionId
            )
        );
    }

    function _expectOraclePriceRequest(address oracleAddress, OracleRequest memory oracleRequest) internal {
        vm.expectCall(
            oracleAddress,
            abi.encodeWithSelector(
                MockOracleAncillary.requestPrice.selector,
                oracleRequest.identifier,
                oracleRequest.time,
                oracleRequest.ancillaryData
            )
        );
    }

    function _mockGetAssertionAssertingCaller(address mockAssertingCaller, bytes32 assertionId) public {
        OptimisticAsserterInterface.Assertion memory assertion;
        assertion.escalationManagerSettings.assertingCaller = mockAssertingCaller;
        vm.mockCall(
            mockOptimisticAsserterAddress,
            abi.encodeWithSelector(OptimisticAsserterInterface.getAssertion.selector, assertionId),
            abi.encode(assertion)
        );
    }

    function _defaultSaveBalancesBeforeSettle() internal {
        balancesBeforeSettle = BalancesBeforeSettle({
            asserter: defaultCurrency.balanceOf(TestAddress.account1),
            disputer: defaultCurrency.balanceOf(TestAddress.account2),
            store: defaultCurrency.balanceOf(address(store))
        });
    }

    function _defaultCheckBalancesAfterSettle(
        bool disputed,
        bool resolvedTruethful,
        bool payOracleFee
    ) internal {
        // Checks below depend on non zero bond and burnedBondPercentage.
        assertGt(defaultBond, 0);
        assertGt(burnedBondPercentage, 0);

        // Calculate expected payouts.
        uint256 multiplier = disputed ? 2 : 1;
        uint256 expectedOracleFee = payOracleFee ? (defaultBond * burnedBondPercentage) / 1e18 : 0;
        uint256 expectedBondRecipientAmount = defaultBond * multiplier - expectedOracleFee;
        uint256 expectedAsserterPayout = resolvedTruethful ? expectedBondRecipientAmount : 0;
        uint256 expectedDisputerPayout = resolvedTruethful ? 0 : expectedBondRecipientAmount;

        assertEq(
            defaultCurrency.balanceOf(TestAddress.account1),
            balancesBeforeSettle.asserter + expectedAsserterPayout
        );
        assertEq(
            defaultCurrency.balanceOf(TestAddress.account2),
            balancesBeforeSettle.disputer + expectedDisputerPayout
        );
        assertEq(defaultCurrency.balanceOf(address(store)), balancesBeforeSettle.store + expectedOracleFee);
    }
}

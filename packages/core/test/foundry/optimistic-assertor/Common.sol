// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "forge-std/Test.sol";
import "../fixtures/optimistic-assertor/OptimisticAssertorFixture.sol";
import "../fixtures/common/TestAddress.sol";
import "../../../contracts/oracle/test/MockOracleAncillary.sol";

contract Common is Test {
    // Data structures, that might be used in tests.
    struct OracleRequest {
        bytes32 identifier;
        uint256 time;
        bytes ancillaryData;
    }

    // Contract instances, that might be used in tests.
    OptimisticAssertor optimisticAssertor;
    TestnetERC20 defaultCurrency;
    Timer timer;
    Finder finder;
    MockOracleAncillary mockOracle;
    Store store;

    // Constants, that might be used in tests.
    bytes trueClaimAssertion = bytes("q:'The sky is blue'");
    bytes falseClaimAssertion = bytes("q:'The sky is red'");
    uint256 defaultBond;
    uint256 defaultLiveness;
    bytes32 defaultIdentifier;

    // Mock addresses, used to prank calls.
    address mockOptimisticAssertorAddress = address(0xfa);
    address mockedSovereignSecurityManager = address(0xfb);
    address mockedCallbackRecipient = address(0xfc);
    address mockAssertingCallerAddress = address(0xfd);

    // Event structures, that might be used in tests.
    event AssertionMade(
        bytes32 assertionId,
        bytes claim,
        address indexed proposer,
        address callbackRecipient,
        address indexed sovereignSecurityManager,
        IERC20 currency,
        uint256 bond,
        uint256 expirationTime
    );
    event AssertionDisputed(bytes32 indexed assertionId, address indexed disputer);

    event PriceRequestAdded(address indexed requester, bytes32 indexed identifier, uint256 time, bytes ancillaryData);

    event AssertionSettled(
        bytes32 indexed assertionId,
        address indexed bondRecipient,
        bool disputed,
        bool settlementResolution
    );

    event AssertingCallerSet(address indexed assertingCaller);

    // Common setup function, re-used in most tests.
    function _commonSetup() public {
        OptimisticAssertorFixture.OptimisticAssertorContracts memory oaContracts =
            new OptimisticAssertorFixture().setUp();
        optimisticAssertor = oaContracts.optimisticAssertor;
        defaultCurrency = oaContracts.defaultCurrency;
        mockOracle = oaContracts.mockOracle;
        timer = oaContracts.timer;
        finder = oaContracts.finder;
        store = oaContracts.store;
        defaultBond = optimisticAssertor.defaultBond();
        defaultLiveness = optimisticAssertor.defaultLiveness();
        defaultIdentifier = optimisticAssertor.defaultIdentifier();
    }

    // Helper functions, re-used in some tests.
    function _mockSsmPolicies(
        bool allowAssertion,
        bool useDvmAsOracle,
        bool useDisputeResolution
    ) internal {
        // Mock getAssertionPolicies call to block assertion. No need to pass assertionId as mockCall uses loose matching.
        vm.mockCall(
            mockedSovereignSecurityManager,
            abi.encodePacked(SovereignSecurityManagerInterface.getAssertionPolicies.selector),
            abi.encode(
                SovereignSecurityManagerInterface.AssertionPolicies({
                    allowAssertion: allowAssertion,
                    useDvmAsOracle: useDvmAsOracle,
                    useDisputeResolution: useDisputeResolution
                })
            )
        );
    }

    function _mockOracleResolved(
        address oracle,
        OracleRequest memory oracleRequest,
        bool assertionTruthful
    ) internal {
        // Mock getPrice call based on desired response. Also works on Sovereign Security Manager.
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

    function _assertWithCallbackRecipientAndSsm(address callbackRecipient, address sovereignSecurityManager)
        internal
        returns (bytes32)
    {
        vm.prank(TestAddress.account1);
        return
            optimisticAssertor.assertTruthFor(
                trueClaimAssertion,
                address(0),
                callbackRecipient,
                sovereignSecurityManager,
                defaultCurrency,
                defaultBond,
                defaultLiveness,
                defaultIdentifier
            );
    }

    function _disputeAndGetOracleRequest(bytes32 assertionId, uint256 bond) internal returns (OracleRequest memory) {
        // Get expected oracle request on dispute.
        OptimisticAssertorInterface.Assertion memory assertion = optimisticAssertor.readAssertion(assertionId);
        OracleRequest memory oracleRequest =
            OracleRequest({
                identifier: optimisticAssertor.defaultIdentifier(),
                time: assertion.assertionTime,
                ancillaryData: optimisticAssertor.stampAssertion(assertionId)
            });

        // Fund Account2 and make dispute.
        vm.startPrank(TestAddress.account2);
        defaultCurrency.allocateTo(TestAddress.account2, bond);
        defaultCurrency.approve(address(optimisticAssertor), bond);
        optimisticAssertor.disputeAssertionFor(assertionId, TestAddress.account2);
        vm.stopPrank();
        return oracleRequest;
    }

    function _expectAssertionResolvedCallback(bytes32 assertionId, bool assertedTruthfully) internal {
        vm.expectCall(
            mockedCallbackRecipient,
            abi.encodeWithSelector(
                OptimisticAssertorCallbackRecipientInterface.assertionResolved.selector,
                assertionId,
                assertedTruthfully
            )
        );
    }

    function _expectAssertionDisputedCallback(bytes32 assertionId) internal {
        vm.expectCall(
            mockedCallbackRecipient,
            abi.encodeWithSelector(OptimisticAssertorCallbackRecipientInterface.assertionDisputed.selector, assertionId)
        );
    }
}

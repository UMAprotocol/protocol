// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "../fixtures/optimistic-assertor/OptimisticAssertorFixture.sol";
import "../fixtures/common/TestAddress.sol";

contract SimpleAssertionsWithClaimOnly is Test {
    OptimisticAssertor optimisticAssertor;
    TestnetERC20 defaultCurrency;
    Timer timer;
    MockOracleAncillary mockOracle;
    Store store;
    string trueClaimAssertion = 'q:"The sky is blue"';
    string falseClaimAssertion = 'q:"The sky is red"';

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
    event AssertionSettled(
        bytes32 indexed assertionId,
        address indexed bondRecipient,
        bool disputed,
        bool settlementResolution
    );
    event PriceRequestAdded(address indexed requester, bytes32 indexed identifier, uint256 time, bytes ancillaryData);

    function setUp() public {
        OptimisticAssertorFixture.OptimisticAsserterContracts memory oaContracts =
            new OptimisticAssertorFixture().setUp();
        optimisticAssertor = oaContracts.optimisticAssertor;
        defaultCurrency = oaContracts.defaultCurrency;
        mockOracle = oaContracts.mockOracle;
        store = oaContracts.store;
        timer = oaContracts.timer;
    }

    function test_AssertionWithNoDispute() public {
        vm.startPrank(TestAddress.account1);
        defaultCurrency.allocateTo(TestAddress.account1, optimisticAssertor.defaultBond());
        assert(defaultCurrency.balanceOf(TestAddress.account1) >= optimisticAssertor.defaultBond());
        defaultCurrency.approve(address(optimisticAssertor), optimisticAssertor.defaultBond());

        bytes32 expectedAssertionId =
            keccak256(
                abi.encode(
                    bytes(trueClaimAssertion),
                    optimisticAssertor.defaultBond(),
                    optimisticAssertor.defaultLiveness(),
                    address(defaultCurrency),
                    TestAddress.account1,
                    address(0),
                    address(0)
                )
            );
        vm.expectEmit(true, true, true, true);
        emit AssertionMade(
            expectedAssertionId,
            bytes(trueClaimAssertion),
            TestAddress.account1,
            address(0),
            address(0),
            defaultCurrency,
            optimisticAssertor.defaultBond(),
            timer.getCurrentTime() + optimisticAssertor.defaultLiveness()
        );
        bytes32 assertionId = optimisticAssertor.assertTruth(bytes(trueClaimAssertion));
        assertEq(assertionId, expectedAssertionId);
        vm.stopPrank();

        // Settle before the liveness period should revert.
        vm.expectRevert("Assertion not expired");
        optimisticAssertor.settleAndGetAssertion(assertionId);

        // Move time forward to the end of the liveness period.
        timer.setCurrentTime(timer.getCurrentTime() + optimisticAssertor.defaultLiveness());

        // proposer balance before settlement
        uint256 proposerBalanceBefore = defaultCurrency.balanceOf(TestAddress.account1);
        vm.expectEmit(true, true, true, true);
        emit AssertionSettled(assertionId, TestAddress.account1, false, true);
        // The assertion should be true.
        assertEq(optimisticAssertor.settleAndGetAssertion(assertionId), true);
        assertEq(
            defaultCurrency.balanceOf(TestAddress.account1) - proposerBalanceBefore,
            optimisticAssertor.defaultBond()
        );
    }

    function test_AssertionWithDispute() public {
        vm.startPrank(TestAddress.account1);
        defaultCurrency.allocateTo(TestAddress.account1, optimisticAssertor.defaultBond());
        assert(defaultCurrency.balanceOf(TestAddress.account1) >= optimisticAssertor.defaultBond());
        defaultCurrency.approve(address(optimisticAssertor), optimisticAssertor.defaultBond());

        // Account1 asserts a false claim.
        bytes32 assertionId = optimisticAssertor.assertTruth(bytes(falseClaimAssertion));
        vm.stopPrank();

        // The assertion gets disputed by the disputer, account2.
        vm.startPrank(TestAddress.account2);
        defaultCurrency.allocateTo(TestAddress.account2, optimisticAssertor.defaultBond());
        assert(defaultCurrency.balanceOf(TestAddress.account2) >= optimisticAssertor.defaultBond());
        defaultCurrency.approve(address(optimisticAssertor), optimisticAssertor.defaultBond());

        vm.expectEmit(true, true, true, true);
        emit PriceRequestAdded(
            address(optimisticAssertor),
            optimisticAssertor.identifier(),
            optimisticAssertor.readAssertion(assertionId).assertionTime,
            optimisticAssertor.stampAssertion(assertionId)
        );
        vm.expectEmit(true, true, true, true);
        emit AssertionDisputed(assertionId, TestAddress.account2);
        optimisticAssertor.disputeAssertionFor(assertionId, TestAddress.account2);
        vm.stopPrank();

        // In the meantime simulate a vote in the DVM in which the originally disputed price is accepted
        MockOracleAncillary.QueryPoint[] memory queries = mockOracle.getPendingQueries();

        // There should be only one query.
        assertEq(queries.length, 1);

        // The query should be for the disputed assertion.
        assertEq(queries[0].identifier, optimisticAssertor.identifier());
        assertEq(queries[0].time, optimisticAssertor.readAssertion(assertionId).assertionTime);
        assertEq(queries[0].ancillaryData, optimisticAssertor.stampAssertion(assertionId));

        // Push the resolution price into the mock oracle, a no vote meaning that the assertion is resolved as false.
        mockOracle.pushPrice(queries[0].identifier, queries[0].time, queries[0].ancillaryData, 0);

        vm.expectEmit(true, true, true, true);
        emit AssertionSettled(assertionId, TestAddress.account2, true, false);
        assertEq(optimisticAssertor.settleAndGetAssertion(assertionId), false);

        // The proposer should have lost their bond.
        assertEq(defaultCurrency.balanceOf(TestAddress.account1), 0);

        // The disputer should have kept their bond and earned 1 - burnedBondPercentage of the proposer's bond.
        assertEq(
            defaultCurrency.balanceOf(TestAddress.account2),
            ((optimisticAssertor.defaultBond() * (2e18 - optimisticAssertor.burnedBondPercentage())) / 1e18)
        );

        // The store should have kept the burnedBondPercentage part of the proposer's bond.
        assertEq(
            defaultCurrency.balanceOf(address(store)),
            (optimisticAssertor.defaultBond() * optimisticAssertor.burnedBondPercentage()) / 1e18
        );

        // The balance of the optimistic assertor should be zero.
        assertEq(defaultCurrency.balanceOf(address(optimisticAssertor)), 0);
    }
}

// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;
import "./PredictionMarket.Common.sol";

contract PredictionMarketResolveTest is PredictionMarketTestCommon {
    bytes32 marketId;

    function setUp() public {
        _commonPredictionMarketSetUp();
        marketId = _initializeMarket();
    }

    function test_ResolveMarketNoDispute() public {
        bytes32 assertionId = _assertMarket(marketId, outcome1);
        uint256 asserterBalanceBefore = defaultCurrency.balanceOf(TestAddress.account1);

        // Advance time past liveness and settle the assertion. This should trigger truthful assertionResolvedCallback.
        timer.setCurrentTime(timer.getCurrentTime() + defaultLiveness);
        vm.expectCall(
            address(predictionMarket),
            abi.encodeCall(predictionMarket.assertionResolvedCallback, (assertionId, true))
        );
        assertTrue(optimisticOracleV3.settleAndGetAssertionResult(assertionId));

        // Verify the asserter received back the bond and reward.
        assertEq(defaultCurrency.balanceOf(TestAddress.account1), asserterBalanceBefore + requiredBond + reward);

        // Verify resolved in PredictionMarket storage.
        PredictionMarket.Market memory market = predictionMarket.getMarket(marketId);
        assertTrue(market.resolved);
        assertEq(market.assertedOutcomeId, keccak256(bytes(outcome1)));
    }

    function test_ResolveMarketWithWrongDispute() public {
        bytes32 assertionId = _assertMarket(marketId, outcome1);
        uint256 asserterBalanceBefore = defaultCurrency.balanceOf(TestAddress.account1);

        // Dispute the assertion, but resolve it true at the Oracle. This should trigger truthful assertionResolvedCallback.
        OracleRequest memory oracleRequest = _disputeAndGetOracleRequest(assertionId, requiredBond);
        _mockOracleResolved(address(mockOracle), oracleRequest, true);
        vm.expectCall(
            address(predictionMarket),
            abi.encodeCall(predictionMarket.assertionResolvedCallback, (assertionId, true))
        );
        assertTrue(optimisticOracleV3.settleAndGetAssertionResult(assertionId));

        // Verify the asserter received back the bond, reward and half of disputer bond.
        assertEq(
            defaultCurrency.balanceOf(TestAddress.account1),
            asserterBalanceBefore + requiredBond + reward + requiredBond / 2
        );

        // Verify resolved in PredictionMarket storage.
        PredictionMarket.Market memory market = predictionMarket.getMarket(marketId);
        assertTrue(market.resolved);
        assertEq(market.assertedOutcomeId, keccak256(bytes(outcome1)));
    }

    function test_AssertionWithCorrectDispute() public {
        bytes32 assertionId = _assertMarket(marketId, outcome1);
        uint256 pmBalanceBefore = defaultCurrency.balanceOf(address(predictionMarket));

        // Dispute the assertion, but resolve it false at the Oracle. This should trigger false assertionResolvedCallback.
        OracleRequest memory oracleRequest = _disputeAndGetOracleRequest(assertionId, requiredBond);
        _mockOracleResolved(address(mockOracle), oracleRequest, false);
        vm.expectCall(
            address(predictionMarket),
            abi.encodeCall(predictionMarket.assertionResolvedCallback, (assertionId, false))
        );
        assertFalse(optimisticOracleV3.settleAndGetAssertionResult(assertionId));

        // Verify the PredictionMarket still has the reward.
        assertEq(defaultCurrency.balanceOf(address(predictionMarket)), pmBalanceBefore);
        assertEq(defaultCurrency.balanceOf(address(predictionMarket)), reward);

        // Verify not resolved and unblocked in PredictionMarket storage.
        PredictionMarket.Market memory market = predictionMarket.getMarket(marketId);
        assertFalse(market.resolved);
        assertEq(market.assertedOutcomeId, bytes32(0));
    }

    function test_ResolveMarketAfterCorrectDispute() public {
        bytes32 assertionId = _assertMarket(marketId, outcome1);

        // Dispute the assertion, but resolve it false at the Oracle.
        OracleRequest memory oracleRequest = _disputeAndGetOracleRequest(assertionId, requiredBond);
        _mockOracleResolved(address(mockOracle), oracleRequest, false);
        assertFalse(optimisticOracleV3.settleAndGetAssertionResult(assertionId));

        // Assert the second outcome and settle after the liveness.
        bytes32 secondAssertionId = _assertMarket(marketId, outcome2);
        timer.setCurrentTime(timer.getCurrentTime() + defaultLiveness);

        assertTrue(optimisticOracleV3.settleAndGetAssertionResult(secondAssertionId));

        // Verify the second outcome resolved in PredictionMarket storage.
        PredictionMarket.Market memory market = predictionMarket.getMarket(marketId);
        assertTrue(market.resolved);
        assertEq(market.assertedOutcomeId, keccak256(bytes(outcome2)));
    }
}

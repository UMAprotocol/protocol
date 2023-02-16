// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;
import "../CommonOptimisticOracleV3Test.sol";
import "../../../../contracts/optimistic-oracle-v3/implementation/examples/PredictionMarket.sol";

contract PredictionMarketTestCommon is CommonOptimisticOracleV3Test {
    PredictionMarket public predictionMarket;
    string outcome1 = "Red";
    string outcome2 = "Blue";
    string description = "Which team wins?";
    uint256 reward = 100e18;
    uint256 requiredBond;
    uint256 outcomeTokens = 10000e18;

    function _commonPredictionMarketSetUp() public {
        _commonSetup();
        predictionMarket = new PredictionMarket(address(finder), address(defaultCurrency), address(optimisticOracleV3));
        uint256 minimumBond = optimisticOracleV3.getMinimumBond(address(defaultCurrency));
        requiredBond = minimumBond < 1000e18 ? 1000e18 : minimumBond; // Make sure the bond is sufficient.
        _fundInitializationReward();
    }

    function _fundInitializationReward() internal {
        defaultCurrency.allocateTo(TestAddress.owner, reward);
        vm.prank(TestAddress.owner);
        defaultCurrency.approve(address(predictionMarket), reward);
    }

    function _initializeMarket() internal returns (bytes32) {
        _fundInitializationReward();
        vm.prank(TestAddress.owner);
        return predictionMarket.initializeMarket(outcome1, outcome2, description, reward, requiredBond);
    }

    function _fundAssertionBond() internal {
        defaultCurrency.allocateTo(TestAddress.account1, requiredBond);
        vm.prank(TestAddress.account1);
        defaultCurrency.approve(address(predictionMarket), requiredBond);
    }

    function _assertMarket(bytes32 marketId, string memory outcome) internal returns (bytes32 assertionId) {
        _fundAssertionBond();
        vm.prank(TestAddress.account1);
        assertionId = predictionMarket.assertMarket(marketId, outcome);
    }

    function _fundCurrencyForMinting(address account) internal {
        defaultCurrency.allocateTo(account, outcomeTokens);
        vm.prank(account);
        defaultCurrency.approve(address(predictionMarket), outcomeTokens);
    }

    function _mintAndSwapOutcomeTokens(bytes32 marketId) internal {
        PredictionMarket.Market memory market = predictionMarket.getMarket(marketId);
        _fundCurrencyForMinting(TestAddress.account2);
        _fundCurrencyForMinting(TestAddress.account3);

        vm.startPrank(TestAddress.account2);
        predictionMarket.createOutcomeTokens(marketId, outcomeTokens);
        IERC20(market.outcome2Token).transfer(TestAddress.account3, outcomeTokens);
        vm.stopPrank();

        vm.startPrank(TestAddress.account3);
        predictionMarket.createOutcomeTokens(marketId, outcomeTokens);
        IERC20(market.outcome1Token).transfer(TestAddress.account2, outcomeTokens);
        vm.stopPrank();

        assertEq(IERC20(market.outcome1Token).balanceOf(TestAddress.account2), outcomeTokens * 2);
        assertEq(IERC20(market.outcome2Token).balanceOf(TestAddress.account2), 0);
        assertEq(IERC20(market.outcome1Token).balanceOf(TestAddress.account3), 0);
        assertEq(IERC20(market.outcome2Token).balanceOf(TestAddress.account3), outcomeTokens * 2);
    }

    function _settleAssertionAndTokens(bytes32 assertionId) internal {
        (, bytes32 marketId) = predictionMarket.assertedMarkets(assertionId);
        PredictionMarket.Market memory market = predictionMarket.getMarket(marketId);

        // Settle the assertion after liveness.
        timer.setCurrentTime(timer.getCurrentTime() + defaultLiveness);
        assertTrue(optimisticOracleV3.settleAndGetAssertionResult(assertionId));

        // Settle the outcome tokens.
        vm.prank(TestAddress.account2);
        predictionMarket.settleOutcomeTokens(marketId);
        vm.prank(TestAddress.account3);
        predictionMarket.settleOutcomeTokens(marketId);

        // Verify the outcome tokens were burned.
        assertEq(IERC20(market.outcome1Token).balanceOf(TestAddress.account2), 0);
        assertEq(IERC20(market.outcome2Token).balanceOf(TestAddress.account2), 0);
        assertEq(IERC20(market.outcome1Token).balanceOf(TestAddress.account3), 0);
        assertEq(IERC20(market.outcome2Token).balanceOf(TestAddress.account3), 0);
    }
}

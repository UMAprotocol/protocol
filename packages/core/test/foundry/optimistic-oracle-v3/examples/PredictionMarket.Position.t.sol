// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;
import "./PredictionMarket.Common.sol";

contract PredictionMarketPositionTest is PredictionMarketTestCommon {
    bytes32 marketId;
    PredictionMarket.Market market;

    function setUp() public {
        _commonPredictionMarketSetUp();
        marketId = _initializeMarket();
        market = predictionMarket.getMarket(marketId);
    }

    function test_CreateOutcomeTokens() public {
        _fundCurrencyForMinting(TestAddress.account1);
        uint256 minterBalanceBefore = defaultCurrency.balanceOf(TestAddress.account1);
        vm.prank(TestAddress.account1);
        predictionMarket.createOutcomeTokens(marketId, outcomeTokens);
        assertEq(defaultCurrency.balanceOf(TestAddress.account1), minterBalanceBefore - outcomeTokens);
        assertEq(IERC20(market.outcome1Token).balanceOf(TestAddress.account1), outcomeTokens);
        assertEq(IERC20(market.outcome2Token).balanceOf(TestAddress.account1), outcomeTokens);
    }

    function test_RedeemOutcomeTokens() public {
        _fundCurrencyForMinting(TestAddress.account1);
        uint256 minterBalanceBefore = defaultCurrency.balanceOf(TestAddress.account1);
        vm.prank(TestAddress.account1);
        predictionMarket.createOutcomeTokens(marketId, outcomeTokens);

        vm.prank(TestAddress.account1);
        predictionMarket.redeemOutcomeTokens(marketId, outcomeTokens);
        assertEq(defaultCurrency.balanceOf(TestAddress.account1), minterBalanceBefore);
        assertEq(IERC20(market.outcome1Token).balanceOf(TestAddress.account1), 0);
        assertEq(IERC20(market.outcome2Token).balanceOf(TestAddress.account1), 0);
    }

    function test_RevertIf_SettleBeforeResolved() public {
        _assertMarket(marketId, outcome1);

        _fundCurrencyForMinting(TestAddress.account1);
        vm.startPrank(TestAddress.account1);
        predictionMarket.createOutcomeTokens(marketId, outcomeTokens);
        vm.expectRevert("Market not resolved");
        predictionMarket.settleOutcomeTokens(marketId);
        vm.stopPrank();
    }

    function test_SettleFirstOutcome() public {
        bytes32 assertionId = _assertMarket(marketId, outcome1);

        // Two parties (Accounts 2 and 3 not to mix balance with asserting Account 1) mint and swap outcome tokens.
        _mintAndSwapOutcomeTokens(marketId);
        uint256 account2BalanceBefore = defaultCurrency.balanceOf(TestAddress.account2);
        uint256 account3BalanceBefore = defaultCurrency.balanceOf(TestAddress.account3);

        _settleAssertionAndTokens(assertionId);

        // Verify the holder of first outcome tokens got all the payout.
        assertEq(defaultCurrency.balanceOf(TestAddress.account2), account2BalanceBefore + outcomeTokens * 2);
        assertEq(defaultCurrency.balanceOf(TestAddress.account3), account3BalanceBefore);
    }

    function test_SettleSecondOutcome() public {
        bytes32 assertionId = _assertMarket(marketId, outcome2);

        // Two parties (Accounts 2 and 3 not to mix balance with asserting Account 1) mint and swap outcome tokens.
        _mintAndSwapOutcomeTokens(marketId);
        uint256 account2BalanceBefore = defaultCurrency.balanceOf(TestAddress.account2);
        uint256 account3BalanceBefore = defaultCurrency.balanceOf(TestAddress.account3);

        _settleAssertionAndTokens(assertionId);

        // Verify the holder of second outcome tokens got all the payout.
        assertEq(defaultCurrency.balanceOf(TestAddress.account2), account2BalanceBefore);
        assertEq(defaultCurrency.balanceOf(TestAddress.account3), account3BalanceBefore + outcomeTokens * 2);
    }

    function test_SettleUnresolvableOutcome() public {
        bytes32 assertionId = _assertMarket(marketId, string(predictionMarket.unresolvable()));

        // Two parties (Accounts 2 and 3 not to mix balance with asserting Account 1) mint and swap outcome tokens.
        _mintAndSwapOutcomeTokens(marketId);
        uint256 account2BalanceBefore = defaultCurrency.balanceOf(TestAddress.account2);
        uint256 account3BalanceBefore = defaultCurrency.balanceOf(TestAddress.account3);

        _settleAssertionAndTokens(assertionId);

        // Verify the holders of outcome tokens got the same amount of the payout.
        assertEq(defaultCurrency.balanceOf(TestAddress.account2), account2BalanceBefore + outcomeTokens);
        assertEq(defaultCurrency.balanceOf(TestAddress.account3), account3BalanceBefore + outcomeTokens);
    }
}

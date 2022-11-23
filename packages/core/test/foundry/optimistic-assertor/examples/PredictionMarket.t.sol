// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;
import "../Common.sol";
import "../../../../contracts/optimistic-assertor/implementation/examples/PredictionMarket.sol";

contract PredictionMarketTest is Common {
    PredictionMarket public predictionMarket;
    string outcome1 = "Red";
    string outcome2 = "Blue";
    string description = "Which team wins?";
    uint256 reward = 100e18;
    uint256 requiredBond;
    uint256 outcomeTokens = 10000e18;

    function setUp() public {
        _commonSetup();
        predictionMarket = new PredictionMarket(address(finder), address(defaultCurrency), address(optimisticAssertor));
        uint256 minimumBond = optimisticAssertor.getMinimumBond(address(defaultCurrency));
        requiredBond = minimumBond < 1000e18 ? 1000e18 : minimumBond; // Make sure the bond is sufficient.

        _fundInitializationReward();
    }

    function test_ContractParameters() public {
        assertEq(address(predictionMarket.finder()), address(finder));
        assertEq(address(predictionMarket.currency()), address(defaultCurrency));
        assertEq(address(predictionMarket.oa()), address(optimisticAssertor));
        assertEq(predictionMarket.defaultIdentifier(), defaultIdentifier);
    }

    function test_RevertIf_InvalidInitializationParameters() public {
        vm.startPrank(TestAddress.owner);
        vm.expectRevert("Empty first outcome");
        predictionMarket.initializeMarket("", outcome2, description, reward, requiredBond);

        vm.expectRevert("Empty second outcome");
        predictionMarket.initializeMarket(outcome1, "", description, reward, requiredBond);

        vm.expectRevert("Outcomes are the same");
        predictionMarket.initializeMarket(outcome1, outcome1, description, reward, requiredBond);

        vm.expectRevert("Empty description");
        predictionMarket.initializeMarket(outcome1, outcome2, "", reward, requiredBond);
        vm.stopPrank();
    }

    function test_RevertIf_DuplicateMarket() public {
        vm.prank(TestAddress.owner);
        predictionMarket.initializeMarket(outcome1, outcome2, description, reward, requiredBond);

        _fundInitializationReward();
        vm.expectRevert("Market already exists");
        vm.prank(TestAddress.owner);
        predictionMarket.initializeMarket(outcome1, outcome2, description, reward, requiredBond);
    }

    function test_DuplicateMarketNextBlock() public {
        vm.prank(TestAddress.owner);
        bytes32 firstMarketId =
            predictionMarket.initializeMarket(outcome1, outcome2, description, reward, requiredBond);

        // Next block should allow initializing market with the same parameters, but different marketId.
        vm.roll(block.number + 1);
        _fundInitializationReward();
        vm.prank(TestAddress.owner);
        bytes32 secondMarketId =
            predictionMarket.initializeMarket(outcome1, outcome2, description, reward, requiredBond);
        assertFalse(firstMarketId == secondMarketId);
    }

    function test_RewardPulledOnInitialization() public {
        vm.prank(TestAddress.owner);
        predictionMarket.initializeMarket(outcome1, outcome2, description, reward, requiredBond);
        assertEq(defaultCurrency.balanceOf(address(predictionMarket)), reward);
    }

    function test_RevertIf_InvalidAssertionParameters() public {
        bytes32 marketId = _initializeMarket();

        _fundAssertionBond();
        vm.expectRevert("Market does not exist");
        vm.prank(TestAddress.account1);
        predictionMarket.assertMarket(bytes32(0), outcome1);

        vm.expectRevert("Invalid asserted outcome");
        vm.prank(TestAddress.account1);
        predictionMarket.assertMarket(marketId, "Invalid");
    }

    function test_RevertIf_DuplicateActiveAssertion() public {
        bytes32 marketId = _initializeMarket();

        _fundAssertionBond();
        vm.prank(TestAddress.account1);
        predictionMarket.assertMarket(marketId, outcome1);

        _fundAssertionBond();
        vm.expectRevert("Assertion active or resolved");
        vm.prank(TestAddress.account1);
        predictionMarket.assertMarket(marketId, outcome1);
    }

    function test_AssertionMade() public {
        bytes32 marketId = _initializeMarket();
        uint256 oaBalanceBefore = defaultCurrency.balanceOf(address(optimisticAssertor));

        // Make assertion and verify bond posted to Optimistic Asseror.
        bytes32 assertionId = _assertMarket(marketId, outcome1);
        assertEq(defaultCurrency.balanceOf(address(optimisticAssertor)), oaBalanceBefore + requiredBond);

        // Verify PredictionMarket storage.
        PredictionMarket.Market memory market = predictionMarket.getMarket(marketId);
        assertEq(market.assertedOutcomeId, keccak256(bytes(outcome1)));
        (address storedAsserter, bytes32 storedMarketId) = predictionMarket.assertedMarkets(assertionId);
        assertEq(storedAsserter, TestAddress.account1);
        assertEq(storedMarketId, marketId);

        // Verify OptimisticAssertor storage.
        OptimisticAssertorInterface.Assertion memory assertion = optimisticAssertor.readAssertion(assertionId);
        assertEq(assertion.proposer, TestAddress.account1);
        assertEq(assertion.callbackRecipient, address(predictionMarket));
        assertEq(address(assertion.currency), address(defaultCurrency));
        assertEq(assertion.bond, requiredBond);
        assertEq(assertion.assertionTime, block.timestamp);
        assertEq(assertion.expirationTime, block.timestamp + defaultLiveness);
        assertEq(assertion.identifier, defaultIdentifier);
        assertEq(assertion.ssmSettings.assertingCaller, address(predictionMarket));
    }

    function test_DisputeCallbackReceived() public {
        bytes32 assertionId = _assertMarket(_initializeMarket(), outcome1);

        vm.expectCall(address(predictionMarket), abi.encodeCall(predictionMarket.assertionDisputed, (assertionId)));
        _disputeAndGetOracleRequest(assertionId, requiredBond);
    }

    function test_ResolveMarketNoDispute() public {
        bytes32 marketId = _initializeMarket();
        bytes32 assertionId = _assertMarket(marketId, outcome1);
        uint256 asserterBalanceBefore = defaultCurrency.balanceOf(TestAddress.account1);

        // Advance time past liveness and settle the assertion. This should trigger truthful assertionResolved callback.
        timer.setCurrentTime(timer.getCurrentTime() + defaultLiveness);
        vm.expectCall(
            address(predictionMarket),
            abi.encodeCall(predictionMarket.assertionResolved, (assertionId, true))
        );
        assertTrue(optimisticAssertor.settleAndGetAssertion(assertionId));

        // Verify the asserter received back the bond and reward.
        assertEq(defaultCurrency.balanceOf(TestAddress.account1), asserterBalanceBefore + requiredBond + reward);

        // Verify resolved in PredictionMarket storage.
        PredictionMarket.Market memory market = predictionMarket.getMarket(marketId);
        assertTrue(market.resolved);
        assertEq(market.assertedOutcomeId, keccak256(bytes(outcome1)));
    }

    function test_ResolveMarketWithWrongDispute() public {
        bytes32 marketId = _initializeMarket();
        bytes32 assertionId = _assertMarket(marketId, outcome1);
        uint256 asserterBalanceBefore = defaultCurrency.balanceOf(TestAddress.account1);

        // Dispute the assertion, but resolve it true at the Oracle. This should trigger truthful assertionResolved callback.
        OracleRequest memory oracleRequest = _disputeAndGetOracleRequest(assertionId, requiredBond);
        _mockOracleResolved(address(mockOracle), oracleRequest, true);
        vm.expectCall(
            address(predictionMarket),
            abi.encodeCall(predictionMarket.assertionResolved, (assertionId, true))
        );
        assertTrue(optimisticAssertor.settleAndGetAssertion(assertionId));

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
        bytes32 marketId = _initializeMarket();
        bytes32 assertionId = _assertMarket(marketId, outcome1);
        uint256 pmBalanceBefore = defaultCurrency.balanceOf(address(predictionMarket));

        // Dispute the assertion, but resolve it false at the Oracle. This should trigger false assertionResolved callback.
        OracleRequest memory oracleRequest = _disputeAndGetOracleRequest(assertionId, requiredBond);
        _mockOracleResolved(address(mockOracle), oracleRequest, false);
        vm.expectCall(
            address(predictionMarket),
            abi.encodeCall(predictionMarket.assertionResolved, (assertionId, false))
        );
        assertFalse(optimisticAssertor.settleAndGetAssertion(assertionId));

        // Verify the PredictionMarket still has the reward.
        assertEq(defaultCurrency.balanceOf(address(predictionMarket)), pmBalanceBefore);
        assertEq(defaultCurrency.balanceOf(address(predictionMarket)), reward);

        // Verify not resolved and unblocked in PredictionMarket storage.
        PredictionMarket.Market memory market = predictionMarket.getMarket(marketId);
        assertFalse(market.resolved);
        assertEq(market.assertedOutcomeId, bytes32(0));
    }

    function test_ResolveMarketAfterCorrectDispute() public {
        bytes32 marketId = _initializeMarket();
        bytes32 assertionId = _assertMarket(marketId, outcome1);

        // Dispute the assertion, but resolve it false at the Oracle.
        OracleRequest memory oracleRequest = _disputeAndGetOracleRequest(assertionId, requiredBond);
        _mockOracleResolved(address(mockOracle), oracleRequest, false);
        assertFalse(optimisticAssertor.settleAndGetAssertion(assertionId));

        // Assert the second outcome and settle after the liveness.
        bytes32 secondAssertionId = _assertMarket(marketId, outcome2);
        timer.setCurrentTime(timer.getCurrentTime() + defaultLiveness);

        assertTrue(optimisticAssertor.settleAndGetAssertion(secondAssertionId));

        // Verify the second outcome resolved in PredictionMarket storage.
        PredictionMarket.Market memory market = predictionMarket.getMarket(marketId);
        assertTrue(market.resolved);
        assertEq(market.assertedOutcomeId, keccak256(bytes(outcome2)));
    }

    function test_CreateOutcomeTokens() public {
        bytes32 marketId = _initializeMarket();
        PredictionMarket.Market memory market = predictionMarket.getMarket(marketId);

        _fundCurrencyForMinting(TestAddress.account1);
        uint256 minterBalanceBefore = defaultCurrency.balanceOf(TestAddress.account1);
        vm.prank(TestAddress.account1);
        predictionMarket.createOutcomeTokens(marketId, outcomeTokens);
        assertEq(defaultCurrency.balanceOf(TestAddress.account1), minterBalanceBefore - outcomeTokens);
        assertEq(IERC20(market.outcome1Token).balanceOf(TestAddress.account1), outcomeTokens);
        assertEq(IERC20(market.outcome2Token).balanceOf(TestAddress.account1), outcomeTokens);
    }

    function test_RedeemOutcomeTokens() public {
        bytes32 marketId = _initializeMarket();
        PredictionMarket.Market memory market = predictionMarket.getMarket(marketId);

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
        bytes32 marketId = _initializeMarket();
        _assertMarket(marketId, outcome1);

        _fundCurrencyForMinting(TestAddress.account1);
        vm.startPrank(TestAddress.account1);
        predictionMarket.createOutcomeTokens(marketId, outcomeTokens);
        vm.expectRevert("Market not resolved");
        predictionMarket.settleOutcomeTokens(marketId);
        vm.stopPrank();
    }

    function test_SettleFirstOutcome() public {
        bytes32 marketId = _initializeMarket();
        bytes32 assertionId = _assertMarket(marketId, outcome1);
        PredictionMarket.Market memory market = predictionMarket.getMarket(marketId);

        // Two parties (Accounts 2 and 3 not to mix balance with asserting Account 1) mint and swap outcome tokens.
        _mintAndSwapOutcomeTokens(marketId);
        uint256 account2BalanceBefore = defaultCurrency.balanceOf(TestAddress.account2);
        uint256 account3BalanceBefore = defaultCurrency.balanceOf(TestAddress.account3);

        // Settle the assertion after liveness.
        timer.setCurrentTime(timer.getCurrentTime() + defaultLiveness);
        assertTrue(optimisticAssertor.settleAndGetAssertion(assertionId));

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

        // Verify the holder of first outcome tokens got all the payout.
        assertEq(defaultCurrency.balanceOf(TestAddress.account2), account2BalanceBefore + outcomeTokens * 2);
        assertEq(defaultCurrency.balanceOf(TestAddress.account3), account3BalanceBefore);
    }

    function test_SettleSecondOutcome() public {
        bytes32 marketId = _initializeMarket();
        bytes32 assertionId = _assertMarket(marketId, outcome2);
        PredictionMarket.Market memory market = predictionMarket.getMarket(marketId);

        // Two parties (Accounts 2 and 3 not to mix balance with asserting Account 1) mint and swap outcome tokens.
        _mintAndSwapOutcomeTokens(marketId);
        uint256 account2BalanceBefore = defaultCurrency.balanceOf(TestAddress.account2);
        uint256 account3BalanceBefore = defaultCurrency.balanceOf(TestAddress.account3);

        // Settle the assertion after liveness.
        timer.setCurrentTime(timer.getCurrentTime() + defaultLiveness);
        assertTrue(optimisticAssertor.settleAndGetAssertion(assertionId));

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

        // Verify the holder of second outcome tokens got all the payout.
        assertEq(defaultCurrency.balanceOf(TestAddress.account2), account2BalanceBefore);
        assertEq(defaultCurrency.balanceOf(TestAddress.account3), account3BalanceBefore + outcomeTokens * 2);
    }

    function test_SettleSplitOutcome() public {
        bytes32 marketId = _initializeMarket();
        bytes32 assertionId = _assertMarket(marketId, string(predictionMarket.splitOutcome()));
        PredictionMarket.Market memory market = predictionMarket.getMarket(marketId);

        // Two parties (Accounts 2 and 3 not to mix balance with asserting Account 1) mint and swap outcome tokens.
        _mintAndSwapOutcomeTokens(marketId);
        uint256 account2BalanceBefore = defaultCurrency.balanceOf(TestAddress.account2);
        uint256 account3BalanceBefore = defaultCurrency.balanceOf(TestAddress.account3);

        // Settle the assertion after liveness.
        timer.setCurrentTime(timer.getCurrentTime() + defaultLiveness);
        assertTrue(optimisticAssertor.settleAndGetAssertion(assertionId));

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

        // Verify the holders of outcome tokens got the same amount of the payout.
        assertEq(defaultCurrency.balanceOf(TestAddress.account2), account2BalanceBefore + outcomeTokens);
        assertEq(defaultCurrency.balanceOf(TestAddress.account3), account3BalanceBefore + outcomeTokens);
    }

    function _fundInitializationReward() internal {
        defaultCurrency.allocateTo(TestAddress.owner, reward);
        vm.prank(TestAddress.owner);
        defaultCurrency.approve(address(predictionMarket), reward);
    }

    function _initializeMarket() internal returns (bytes32 marketId) {
        _fundInitializationReward();
        vm.prank(TestAddress.owner);
        marketId = predictionMarket.initializeMarket(outcome1, outcome2, description, reward, requiredBond);
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
}

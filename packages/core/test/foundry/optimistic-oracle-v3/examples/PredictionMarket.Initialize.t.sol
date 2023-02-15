// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;
import "./PredictionMarket.Common.sol";

contract PredictionMarketInitializeTest is PredictionMarketTestCommon {
    function setUp() public {
        _commonPredictionMarketSetUp();
    }

    function test_ContractParameters() public {
        assertEq(address(predictionMarket.finder()), address(finder));
        assertEq(address(predictionMarket.currency()), address(defaultCurrency));
        assertEq(address(predictionMarket.oo()), address(optimisticOracleV3));
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
}

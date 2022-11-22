// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../../../common/implementation/AddressWhitelist.sol";
import "../../../common/implementation/AncillaryData.sol";
import "../../../common/implementation/ExpandedERC20.sol";
import "../../../oracle/implementation/Constants.sol";
import "../../../oracle/interfaces/FinderInterface.sol";
import "../../interfaces/OptimisticAssertorInterface.sol";
import "../../interfaces/OptimisticAssertorCallbackRecipientInterface.sol";

contract PredictionMarket is OptimisticAssertorCallbackRecipientInterface {
    using SafeERC20 for IERC20;

    struct Market {
        bool resolved; // True if the market has been resolved and payouts can be settled.
        bytes32 assertedOutcomeId; // Hash of asserted outcome (outcome1, outcome2 or splitOutcome).
        ExpandedIERC20 outcome1Token; // ERC20 token representing the value of the first outcome.
        ExpandedIERC20 outcome2Token; // ERC20 token representing the value of the second outcome.
        uint256 reward; // Reward available for asserting true market outcome.
        uint256 requiredBond; // Expected bond to assert market outcome (OA can require higher bond).
        bytes outcome1; // Short name of the first outcome.
        bytes outcome2; // Short name of the second outcome.
        bytes description; // Description of the market.
    }

    struct AssertedMarket {
        address asserter; // Address of the asserter used for reward payout.
        bytes32 marketId; // Identifier for markets mapping.
    }

    mapping(bytes32 => Market) public markets; // Maps marketId to Market struct.

    mapping(bytes32 => AssertedMarket) public assertedMarkets; // Maps assertionId to AssertedMarket.

    FinderInterface public immutable finder; // UMA protocol Finder used to discover other protocol contracts.
    IERC20 public immutable currency; // Currency used for all prediction markets.
    OptimisticAssertorInterface public immutable oa;
    uint256 public constant assertionLiveness = 7200; // 2 hours.
    bytes32 public immutable defaultIdentifier; // Identifier used for all prediction markets.
    bytes public constant splitOutcome = "Unknown"; // Name of the split outcome.

    constructor(
        address _finder,
        address _currency,
        address _optimisticAssertor
    ) {
        finder = FinderInterface(_finder);
        require(_getCollateralWhitelist().isOnWhitelist(_currency), "Unsupported currency");
        currency = IERC20(_currency);
        oa = OptimisticAssertorInterface(_optimisticAssertor);
        defaultIdentifier = oa.defaultIdentifier();
    }

    function initializeMarket(
        string memory outcome1, // Short name of the first outcome.
        string memory outcome2, // Short name of the second outcome.
        string memory description, // Description of the market.
        uint256 reward, // Reward available for asserting true market outcome.
        uint256 requiredBond // Expected bond to assert market outcome (OA can require higher bond).
    ) public returns (bytes32 marketId) {
        require(bytes(outcome1).length > 0, "Empty first outcome");
        require(bytes(outcome2).length > 0, "Empty second outcome");
        require(keccak256(bytes(outcome1)) != keccak256(bytes(outcome2)), "Outcomes are the same");
        require(bytes(description).length > 0, "Empty description");
        marketId = keccak256(abi.encode(block.number, description));
        require(markets[marketId].outcome1Token == ExpandedIERC20(address(0)), "Market already exists");

        // Create position tokens with this contract having minter and burner roles.
        ExpandedIERC20 outcome1Token = new ExpandedERC20(string(abi.encodePacked(outcome1, " Token")), "O1T", 18);
        ExpandedIERC20 outcome2Token = new ExpandedERC20(string(abi.encodePacked(outcome2, " Token")), "O2T", 18);
        outcome1Token.addMinter(address(this));
        outcome2Token.addMinter(address(this));
        outcome1Token.addBurner(address(this));
        outcome2Token.addBurner(address(this));

        markets[marketId] = Market({
            resolved: false,
            assertedOutcomeId: bytes32(0),
            outcome1Token: outcome1Token,
            outcome2Token: outcome2Token,
            reward: reward,
            requiredBond: requiredBond,
            outcome1: bytes(outcome1),
            outcome2: bytes(outcome2),
            description: bytes(description)
        });
        if (reward > 0) currency.safeTransferFrom(msg.sender, address(this), reward); // Pull reward.
    }

    // Assert the market with any of 3 possible outcomes: names of outcome1, outcome2 or splitOutcome.
    // Only one concurrent assertion per market is allowed.
    function assertMarket(bytes32 marketId, string memory assertedOutcome) public returns (bytes32 assertionId) {
        Market storage market = markets[marketId];
        require(market.outcome1Token != ExpandedIERC20(address(0)), "Market does not exist");
        bytes32 assertedOutcomeId = keccak256(bytes(assertedOutcome));
        require(market.assertedOutcomeId == bytes32(0), "Assertion active or resolved");
        require(
            assertedOutcomeId == keccak256(market.outcome1) ||
                assertedOutcomeId == keccak256(market.outcome2) ||
                assertedOutcomeId == keccak256(splitOutcome),
            "Invalid asserted outcome"
        );

        market.assertedOutcomeId = assertedOutcomeId;
        uint256 minimumBond = oa.getMinimumBond(address(currency)); // OA might require higher bond.
        uint256 bond = market.requiredBond > minimumBond ? market.requiredBond : minimumBond;
        bytes memory claim = _composeClaim(assertedOutcome, market.description);

        // Pull bond and make the assertion.
        currency.safeTransferFrom(msg.sender, address(this), bond);
        currency.safeApprove(address(oa), bond);
        assertionId = oa.assertTruthFor(
            claim,
            msg.sender,
            address(this),
            address(0), // No sovereign security manager.
            currency,
            bond,
            assertionLiveness,
            defaultIdentifier
        );
        assertedMarkets[assertionId].marketId = marketId;
        assertedMarkets[assertionId].asserter = msg.sender;
    }

    function assertionResolved(bytes32 assertionId, bool assertedTruthfully) public {
        require(msg.sender == address(oa), "Not authorized");
        bytes32 marketId = assertedMarkets[assertionId].marketId;
        Market storage market = markets[marketId];

        if (assertedTruthfully) {
            market.resolved = true;
            if (market.reward > 0) currency.safeTransfer(assertedMarkets[assertionId].asserter, market.reward);
        } else market.assertedOutcomeId = bytes32(0);
        delete assertedMarkets[assertionId];
    }

    function assertionDisputed(bytes32 assertionId) public {}

    function create(bytes32 marketId, uint256 tokensToCreate) public {
        Market storage market = markets[marketId];
        require(market.outcome1Token != ExpandedIERC20(address(0)), "Market does not exist");

        currency.safeTransferFrom(msg.sender, address(this), tokensToCreate);

        market.outcome1Token.mint(msg.sender, tokensToCreate);
        market.outcome2Token.mint(msg.sender, tokensToCreate);
    }

    function redeem(bytes32 marketId, uint256 tokensToRedeem) public {
        Market storage market = markets[marketId];
        require(market.outcome1Token != ExpandedIERC20(address(0)), "Market does not exist");

        market.outcome1Token.burnFrom(msg.sender, tokensToRedeem);
        market.outcome2Token.burnFrom(msg.sender, tokensToRedeem);

        currency.safeTransfer(msg.sender, tokensToRedeem);
    }

    function settle(bytes32 marketId) public returns (uint256 payout) {
        Market storage market = markets[marketId];
        require(market.resolved, "Market not resolved");

        uint256 p1Balance = market.outcome1Token.balanceOf(msg.sender);
        uint256 p2Balance = market.outcome2Token.balanceOf(msg.sender);

        if (market.assertedOutcomeId == keccak256(market.outcome1)) payout = p1Balance;
        else if (market.assertedOutcomeId == keccak256(market.outcome2)) payout = p2Balance;
        else payout = (p1Balance + p2Balance) / 2;

        market.outcome1Token.burnFrom(msg.sender, p1Balance);
        market.outcome2Token.burnFrom(msg.sender, p2Balance);
        currency.safeTransfer(msg.sender, payout);
    }

    function _getCollateralWhitelist() internal view returns (AddressWhitelist) {
        return AddressWhitelist(finder.getImplementationAddress(OracleInterfaces.CollateralWhitelist));
    }

    function _composeClaim(string memory outcome, bytes memory description) internal view returns (bytes memory) {
        return
            abi.encodePacked(
                "As of assertion timestamp ",
                AncillaryData.toUtf8BytesUint(block.timestamp),
                ", the described prediction market outcome is: ",
                outcome,
                ". The market description is: ",
                description
            );
    }
}

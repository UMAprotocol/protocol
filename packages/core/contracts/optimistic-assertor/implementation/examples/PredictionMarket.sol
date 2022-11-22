// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@uma/core/contracts/common/implementation/AncillaryData.sol";
import "@uma/core/contracts/common/implementation/ExpandedERC20.sol";
import "../../interfaces/OptimisticAssertorInterface.sol";

contract PredictionMarket {
    //using SafeERC20 for ExpandedERC20;
    using SafeERC20 for IERC20;

    struct Market {
        bool resolved;
        bytes32 assertedOutcomeId; // hash of either p1, p2 or p3 string.
        ExpandedIERC20 p1Token;
        ExpandedIERC20 p2Token;
        uint256 reward;
        uint256 requiredBond;
        bytes p1Name;
        bytes p2Name;
        bytes description;
    }

    struct AssertedMarket {
        address asserter;
        bytes32 marketId;
    }

    mapping(bytes32 => Market) public markets;

    mapping(bytes32 => AssertedMarket) public assertedMarkets;

    IERC20 public immutable currency;
    OptimisticAssertorInterface public immutable oa;
    uint256 public constant assertionLiveness = 7200;
    bytes public constant p3Name = "Unknown";

    constructor(address _currency, address _optimisticAssertor) {
        currency = IERC20(_currency);
        oa = OptimisticAssertorInterface(_optimisticAssertor);
    }

    function initializeMarket(
        string memory p1Name,
        string memory p2Name,
        string memory description,
        uint256 reward,
        uint256 requiredBond
    ) public returns (bytes32 marketId) {
        require(bytes(p1Name).length > 0, "Invalid p1");
        require(bytes(p2Name).length > 0, "Invalid p2");
        require(keccak256(bytes(p1Name)) != keccak256(bytes(p2Name)), "p1 and p2 must be different");
        require(bytes(description).length > 0, "Invalid description");
        marketId = keccak256(abi.encode(block.number, description));
        require(markets[marketId].p1Token == ExpandedIERC20(address(0)), "Market already exists");

        // Create position tokens with this contract having minter and burner roles.
        ExpandedIERC20 p1Token = new ExpandedERC20(string(abi.encodePacked(p1Name, " Token")), "P1T", 18);
        ExpandedIERC20 p2Token = new ExpandedERC20(string(abi.encodePacked(p2Name, " Token")), "P2T", 18);
        p1Token.addMinter(address(this));
        p2Token.addMinter(address(this));
        p1Token.addBurner(address(this));
        p2Token.addBurner(address(this));

        marketId = keccak256(abi.encode(block.number, description));
        markets[marketId] = Market({
            resolved: false,
            assertedOutcomeId: bytes32(0),
            p1Token: p1Token,
            p2Token: p2Token,
            reward: reward,
            requiredBond: requiredBond,
            p1Name: bytes(p1Name),
            p2Name: bytes(p2Name),
            description: bytes(description)
        });
        if (reward > 0) currency.safeTransferFrom(msg.sender, address(this), reward);
    }

    function assertMarket(bytes32 marketId, string memory assertedOutcome) public returns (bytes32 assertionId) {
        Market storage market = markets[marketId];
        require(market.p1Token != ExpandedIERC20(address(0)), "Market does not exist");
        bytes32 assertedOutcomeId = keccak256(bytes(assertedOutcome));
        require(market.assertedOutcomeId == bytes32(0), "Assertion active or resolved");
        require(
            assertedOutcomeId == keccak256(market.p1Name) ||
                assertedOutcomeId == keccak256(market.p2Name) ||
                assertedOutcomeId == keccak256(p3Name),
            "Invalid asserted outcome"
        );

        market.assertedOutcomeId = assertedOutcomeId;
        uint256 minimumBond = oa.getMinimumBond(address(currency));
        uint256 bond = market.requiredBond > minimumBond ? market.requiredBond : minimumBond;
        bytes memory claim =
            abi.encodePacked(
                "As of assertion timestamp ",
                AncillaryData.toUtf8BytesUint(block.timestamp),
                ", the described prediction market outcome is: ",
                assertedOutcome,
                ". The market description is: ",
                market.description
            );

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
            assertionLiveness
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

    function create(bytes32 marketId, uint256 tokensToCreate) public {
        Market storage market = markets[marketId];
        require(market.p1Token != ExpandedIERC20(address(0)), "Market does not exist");

        currency.safeTransferFrom(msg.sender, address(this), tokensToCreate);

        market.p1Token.mint(msg.sender, tokensToCreate);
        market.p2Token.mint(msg.sender, tokensToCreate);
    }

    function redeem(bytes32 marketId, uint256 tokensToRedeem) public {
        Market storage market = markets[marketId];
        require(market.p1Token != ExpandedIERC20(address(0)), "Market does not exist");

        market.p1Token.burnFrom(msg.sender, tokensToRedeem);
        market.p2Token.burnFrom(msg.sender, tokensToRedeem);

        currency.safeTransfer(msg.sender, tokensToRedeem);
    }

    function settle(bytes32 marketId) public returns (uint256 payout) {
        Market storage market = markets[marketId];
        require(market.resolved, "Market not resolved");

        uint256 p1Balance = market.p1Token.balanceOf(msg.sender);
        uint256 p2Balance = market.p2Token.balanceOf(msg.sender);

        if (market.assertedOutcomeId == keccak256(market.p1Name)) payout = p1Balance;
        else if (market.assertedOutcomeId == keccak256(market.p2Name)) payout = p2Balance;
        else payout = (p1Balance + p2Balance) / 2;

        market.p1Token.burnFrom(msg.sender, p1Balance);
        market.p2Token.burnFrom(msg.sender, p2Balance);
        currency.safeTransfer(msg.sender, payout);
    }
}

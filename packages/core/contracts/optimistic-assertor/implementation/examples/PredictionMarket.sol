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
        bytes32 assertedOutcomeId; // Hash of asserted outcome (p1Name, p2Name or p3Name).
        ExpandedIERC20 p1Token; // ERC20 token representing the value of the first outcome.
        ExpandedIERC20 p2Token; // ERC20 token representing the value of the second outcome.
        uint256 reward; // Reward available for asserting true market outcome.
        uint256 requiredBond; // Expected bond to assert market outcome (OA can require higher bond).
        bytes p1Name; // Short name of the first outcome.
        bytes p2Name; // Short name of the second outcome.
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
    bytes public constant p3Name = "Unknown"; // Name of the split outcome.

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

    function _getCollateralWhitelist() internal view returns (AddressWhitelist) {
        return AddressWhitelist(finder.getImplementationAddress(OracleInterfaces.CollateralWhitelist));
    }
}

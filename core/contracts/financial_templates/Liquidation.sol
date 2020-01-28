pragma solidity ^0.5.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";

// import "../OracleInteface.sol";
import "../FixedPoint.sol";
import "../Testable.sol";
import "./Position.sol";

// TODO:
// - Events
// - Connect with Oracle/DVM
// - Fees
contract Liquidation is Position {
    using FixedPoint for FixedPoint.Unsigned;
    using SafeMath for uint;

    enum Status { PreDispute, PendingDispute, DisputeSucceeded, DisputeFailed }

    struct LiquidationData {
        /**
         * Following variables set upon creation of liquidation:
         */

        // When Liquidation ends and becomes 'Expired'
        uint expiry;
        // Person who created this liquidation
        address liquidator;
        // Liquidated (and expired or not), Pending a Dispute, or Dispute has resolved
        Status state;
        /**
         * Following variables determined by the position that is being liquidated:
         */

        // Synthetic Tokens required to be burned by liquidator to initiate dispute
        FixedPoint.Unsigned tokensOutstanding;
        // Collateral locked by contract and released upon expiry or post-dispute
        FixedPoint.Unsigned lockedCollateral;
        // Amount of collateral being liquidated, which could be different from
        // lockedCollateral if there were pending withdrawals at the time of liquidation
        FixedPoint.Unsigned liquidatedCollateral;
        /**
         * Following variables set upon a dispute request
         */

        // Person who is disputing a liquidation
        address disputer;
        // Time when dispute is initiated, needed to get price from Oracle
        uint disputeTime;
        // Final price as determined by an Oracle following a dispute
        FixedPoint.Unsigned settlementPrice;
    }

    /**
    * Contract-wide variables, consistent across all liquidations for synthetic tokens
    * of this template
    */

    // Liquidations are unique by ID per sponsor
    mapping(address => mapping(uint => LiquidationData)) public liquidations;
    // Keeps track of last used liquidation ID per sponsor
    mapping(address => uint) public sponsorLiquidationIndex;

    // Amount of time for pending liquidation before expiry
    uint liquidationLiveness;
    // Required collateral:TRV ratio
    //FixedPoint.Unsigned liquidityRatio;
    // Oracle supported identifier
    // TODO: bytes32 identifier;
    // Oracle that settles disputes and returns a price
    // TODO: OracleInteface oracle;
    // Percent of a Liquidation/Position's lockedCollateral to be deposited by a potential disputer
    // Represented as a multiplier, for example 1.5e18 = "150%" and 0.05e18 = "5%"
    FixedPoint.Unsigned disputeBondPct;
    // Percent of oraclePrice paid to sponsor in the Disputed state (i.e. following a successful dispute)
    // Represented as a multipler, see above
    FixedPoint.Unsigned sponsorDisputeRewardPct;
    // Percent of oraclePrice paid to disputer in the Disputed state (i.e. following a successful dispute)
    // Represented as a multipler, see above
    FixedPoint.Unsigned disputerDisputeRewardPct;

    /**
     * Method modifiers
     */

    // Callable before the liquidation's expiry AND there is no pending dispute on the liquidation
    modifier onlyPreExpiryAndPreDispute(uint id, address sponsor) {
        require(
            (getCurrentTime() < _getLiquidation(sponsor, id).expiry) &&
                (_getLiquidation(sponsor, id).state == Status.PreDispute),
            "Liquidation has expired or has already been disputed"
        );
        _;
    }
    // Callable either post the liquidation's expiry or after a dispute has been resolved,
    // i.e. once a dispute has been requested, the liquidation's expiry ceases to matter
    modifier onlyPostExpiryOrPostDispute(uint id, address sponsor) {
        require(
            (_getLiquidation(sponsor, id).state == Status.DisputeSucceeded) ||
                (_getLiquidation(sponsor, id).state == Status.DisputeFailed) ||
                ((_getLiquidation(sponsor, id).expiry <= getCurrentTime()) &&
                    (_getLiquidation(sponsor, id).state == Status.PreDispute)),
            "Liquidation has not expired or is pending dispute"
        );
        _;
    }
    // Callable only after a liquidation has been disputed but has not yet resolved
    modifier onlyPendingDispute(uint id, address sponsor) {
        require(
            _getLiquidation(sponsor, id).state == Status.PendingDispute,
            "Liquidation is not currently pending dispute"
        );
        _;
    }

    /**
     * Constructor: set universal Liquidation variables
     */
    constructor(
        bool _isTest,
        uint _positionExpiry,
        uint _positionWithdrawalLiveness,
        address _collateralCurrency,
        FixedPoint.Unsigned memory _disputeBondPct,
        FixedPoint.Unsigned memory _sponsorDisputeRewardPct,
        FixedPoint.Unsigned memory _disputerDisputeRewardPct,
        uint _liquidationLiveness
    ) public Position(_positionExpiry, _positionWithdrawalLiveness, _collateralCurrency, _isTest) {
        disputeBondPct = _disputeBondPct;
        sponsorDisputeRewardPct = _sponsorDisputeRewardPct;
        disputerDisputeRewardPct = _disputerDisputeRewardPct;
        liquidationLiveness = _liquidationLiveness;
    }

    /**
     * Liquidate's the sponsor's position if the caller has enough
     * synthetic tokens to retire the position's outstanding tokens.
     *
     * This method will generate an ID that will uniquely identify liquidation
     * for the sponsor.
     * TODO: Perhaps pass this ID via an event rather than a return value
     *
     * TODO: Possibly allow partial liquidations
     *
     * Returns UUID of new liquidation for the sponsor
     */
    function createLiquidation(address sponsor) public returns (uint lastIndexUsed) {
        // Attempt to retrieve Position data for sponsor
        PositionData storage positionToLiquidate = _getPosition(sponsor);

        // Allocate space for new liquidation and increment index
        lastIndexUsed = sponsorLiquidationIndex[sponsor];
        LiquidationData storage newLiquidation = liquidations[sponsor][lastIndexUsed];
        sponsorLiquidationIndex[sponsor] = (lastIndexUsed + 1);

        // Read position data into liquidation
        newLiquidation.tokensOutstanding = positionToLiquidate.tokensOutstanding;
        newLiquidation.lockedCollateral = positionToLiquidate.collateral;
        newLiquidation.liquidatedCollateral = positionToLiquidate.collateral.sub(
            positionToLiquidate.withdrawalRequestAmount
        );

        // TODO: Should "destroy" the position somehow, rendering its create/redeem/deposit/withdraw methods uncallable
        // This should reduce totalTokensOutstanding and lockedCollateral, and also withdrawal request amount?
        positionToLiquidate.tokensOutstanding = FixedPoint.fromUnscaledUint(0);
        positionToLiquidate.collateral = FixedPoint.fromUnscaledUint(0);

        // Set parameters for new liquidation
        newLiquidation.expiry = getCurrentTime() + liquidationLiveness;
        newLiquidation.liquidator = msg.sender;
        newLiquidation.state = Status.PreDispute;

        // Destroy tokens
        require(
            tokenCurrency.transferFrom(msg.sender, address(this), newLiquidation.tokensOutstanding.rawValue),
            "failed to transfer synthetic tokens from sender"
        );
        tokenCurrency.burn(newLiquidation.tokensOutstanding.rawValue);

        return lastIndexUsed;
    }

    /**
     * Dispute's a liquidation if the caller has enough collateral to post a dispute bond.
     * Can only dispute a liquidation before the liquidation expires and if there are no
     * other pending disputes
     *
     * TODO: Requests a settlement price from the DVM
     */
    function dispute(uint id, address sponsor) public onlyPreExpiryAndPreDispute(id, sponsor) {
        LiquidationData storage disputedLiquidation = _getLiquidation(sponsor, id);

        FixedPoint.Unsigned memory disputeBondAmount = disputedLiquidation.lockedCollateral.mul(disputeBondPct);
        require(
            collateralCurrency.transferFrom(msg.sender, address(this), disputeBondAmount.rawValue),
            "failed to transfer dispute bond from sender"
        );

        // Request a price from DVM,
        // Liquidation is pending dispute until DVM returns a price
        disputedLiquidation.state = Status.PendingDispute;
        disputedLiquidation.disputer = msg.sender;
        disputedLiquidation.disputeTime = getCurrentTime();

        // TODO: Remove call to Oracle for testing purposes
        // require(disputedLiquidation.oracle.requestPrice(disputedLiquidation.identifier, disputedLiquidation.disputeTime), "oracle request failed");

    }

    /**
     * Anyone can call this method to settle a pending dispute. This
     * is only possible after the DVM has resolved a price. Callers should
     * call hasPrice() on the DVM before calling this to ensure
     * that the DVM has resolved a price. This method then calculates whether the
     * dispute on the liquidation was successful usin only the settlement price,
     * tokens outstanding, locked collateral (post-pending withdrawals), and liquidation ratio
     *
     * TODO: Requests a settlement price from the DVM
     * TESTING: For now, I allow the caller to hard-code a settlement price and
     * a dispute resolution => {SUCCESS, FAILURE}
     */
    function settleDispute(uint id, address sponsor, FixedPoint.Unsigned memory hardcodedPrice, bool disputeSucceeded)
        public
        onlyPendingDispute(id, sponsor)
    {
        LiquidationData storage disputedLiquidation = _getLiquidation(sponsor, id);

        // if (disputedLiquidation.oracle.hasPrice(disputedLiquidation.identifier, disputedLiquidation.disputeTime)) {
        // If dispute is over set oracle price
        // disputedLiquidation.oraclePrice = disputedLiquidation.oracle.getPrice(
        //     disputedLiquidation.identifier,
        //     disputedLiquidation.disputeTime
        // );

        // TODO: For testing purposes
        disputedLiquidation.settlementPrice = hardcodedPrice;

        // TODO: Settle dispute using settlementPrice and liquidatedTokens (which might be different from lockedCollateral!)
        // This is where liquidatedCollateral vs lockedCollateral comes important, as the liquidator is comparing
        // the liquidatedCollateral:TRV vs. lockedCollateral:TRV against the liquidityRatio
        if (disputeSucceeded) {
            // If dispute is successful
            disputedLiquidation.state = Status.DisputeSucceeded;
        } else {
            // If dispute fails
            disputedLiquidation.state = Status.DisputeFailed;
        }
    }

    /**
     * After a dispute has settled or after a non-disputed liquidation has expired,
     * the sponsor, liquidator, and/or disputer can call this method to receive payments.
     *
     * If the dispute SUCCEEDED: the sponsor, liquidator, and disputer are eligible for payment
     *
     * If the dispute FAILED: only the liquidator can receive payment
     *
     * Once all collateral is withdrawn, delete the liquidation data
     */
    function withdrawLiquidation(uint id, address sponsor) public onlyPostExpiryOrPostDispute(id, sponsor) {
        LiquidationData storage liquidation = _getLiquidation(sponsor, id);
        require(
            (msg.sender == liquidation.disputer) || (msg.sender == liquidation.liquidator) || (msg.sender == sponsor),
            "must be a disputer, liquidator, or sponsor to request a withdrawal on a liquidation"
        );

        FixedPoint.Unsigned memory tokenRedemptionValue = liquidation.tokensOutstanding.mul(
            liquidation.settlementPrice
        );
        FixedPoint.Unsigned memory disputerDisputeReward = disputerDisputeRewardPct.mul(tokenRedemptionValue);
        FixedPoint.Unsigned memory disputeBondAmount = liquidation.lockedCollateral.mul(disputeBondPct);
        FixedPoint.Unsigned memory sponsorDisputeReward = sponsorDisputeRewardPct.mul(tokenRedemptionValue);

        if (liquidation.state == Status.DisputeSucceeded) {
            if (msg.sender == liquidation.disputer) {
                // Pay DISPUTER: disputer reward + dispute bond
                FixedPoint.Unsigned memory payToDisputer = disputerDisputeReward.add(disputeBondAmount);
                require(
                    collateralCurrency.transfer(msg.sender, payToDisputer.rawValue),
                    "failed to transfer reward for a successful dispute to disputer"
                );
            } else if (msg.sender == sponsor) {
                // Pay SPONSOR: remaining collateral (locked collateral - TRV) + sponsor reward
                FixedPoint.Unsigned memory remainingCollateral = liquidation.lockedCollateral.sub(tokenRedemptionValue);
                FixedPoint.Unsigned memory payToSponsor = sponsorDisputeReward.add(remainingCollateral);
                require(
                    collateralCurrency.transfer(msg.sender, payToSponsor.rawValue),
                    "failed to transfer reward for a successful dispute to sponsor"
                );
            } else if (msg.sender == liquidation.liquidator) {
                // Pay LIQUIDATOR: TRV - dispute reward - sponsor reward
                FixedPoint.Unsigned memory payToLiquidator = tokenRedemptionValue.sub(sponsorDisputeReward).sub(
                    disputerDisputeReward
                );
                require(
                    collateralCurrency.transfer(msg.sender, payToLiquidator.rawValue),
                    "failed to transfer reward for a successful dispute to liquidator"
                );
            }

            if (collateralCurrency.balanceOf(address(this)) == 0) {
                delete liquidations[sponsor][id];
            }
        } else if (liquidation.state == Status.DisputeFailed) {
            // Pay LIQUIDATOR: lockedCollateral + dispute bond
            if (msg.sender == liquidation.liquidator) {
                FixedPoint.Unsigned memory payToLiquidator = liquidation.lockedCollateral.add(disputeBondAmount);
                require(
                    collateralCurrency.transfer(msg.sender, payToLiquidator.rawValue),
                    "failed to transfer locked collateral plus dispute bond to liquidator"
                );
                delete liquidations[sponsor][id];
            } else {
                require(false, "only the liquidator can call withdrawal on an unsuccessfully disputed liquidation");
            }
        } else if (liquidation.state == Status.PreDispute) {
            // Pay LIQUIDATOR: lockedCollateral
            if (msg.sender == liquidation.liquidator) {
                require(
                    collateralCurrency.transfer(msg.sender, liquidation.lockedCollateral.rawValue),
                    "failed to transfer locked collateral to liquidator"
                );
                delete liquidations[sponsor][id];
            } else {
                require(false, "only the liquidator can call withdrawal on a non-disputed, expired liquidation");
            }
        }
    }

    /**
     * Return a liquidation or throw an error if it does not exist
     */
    function _getLiquidation(address sponsor, uint uuid) internal view returns (LiquidationData storage liquidation) {
        liquidation = liquidations[sponsor][uuid];
        require(liquidation.liquidator != address(0), "Liquidation does not exist: liquidator address is not set");
    }
    /**
     * Return a position or throw an error if it does not exist
     */
    function _getPosition(address sponsor) internal view returns (PositionData storage position) {
        position = positions[sponsor];
        require(position.sponsor != address(0), "Position does not exist: sponsor address is not set");
    }
}

pragma solidity ^0.5.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";

// import "../OracleInteface.sol";
import "../FixedPoint.sol";
import "../Testable.sol";
import "./PricelessPositionManager.sol";

// TODO:
// - Events
// - Connect with Oracle/DVM
// - Partial liquidations: should be trivial to add
// - In order to ensure that positions with < 100% collateralization are disputed,
// the contract forces liquidators to liquidate the “least-collateralized” positions first.
// instead of "locked collateral" (actual amount of collateral locked in contract)

/**
 * Adds logic to a position-managing contract that enables callers to
 * "liquidate" an undercollateralized position. The liquidator must burn
 * an amount of synthetic tokens that they are "liquidating" in order to potentially
 * withdraw a portion of the locked collateral in an undercollateralized position.
 * The liquidation has a liveness period before expiring successfully, during which
 * someone can "dispute" the liquidation, which sends a price request to the relevant
 * Oracle to settle the final collateralization ratio based on a DVM price. The
 * contract enforces dispute rewards in order to incentivize disputers to correctly
 * dispute false liquidations and compensate position sponsors who had their position
 * incorrectly liquidated. Importantly, a prospective disputer must deposit a dispute
 * bond that they can lose in the case of an unsuccessful dispute.
 */
contract Liquidatable is PricelessPositionManager {
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
        /**
         * Following variables check that each member can only withdraw once
         */
        bool hasSponsorWithdrawn;
        bool hasLiquidatorWithdrawn;
        bool hasDisputorWithdrawn;
    }

    /**
    * Contract-wide variables, consistent across all liquidations for synthetic tokens
    * of this template
    */

    // Liquidations are unique by ID per sponsor
    mapping(address => LiquidationData[]) public liquidations;

    // Amount of time for pending liquidation before expiry
    uint liquidationLiveness;
    // Required collateral:TRV ratio for a position to be considered sufficiently collateralized.
    FixedPoint.Unsigned collateralRequirement;
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

    // TODO: could this modifier be replaced with one called `onlyPreDispute` and then the function can use
    // the `onlyPreExpiration` modifier from the base contract and this one in conjunction?

    // Callable before the liquidation's expiry AND there is no pending dispute on the liquidation
    modifier onlyPreExpiryAndPreDispute(uint id, address sponsor) {
        LiquidationData storage liquidation = _getLiquidationData(sponsor, id);
        require(
            (getCurrentTime() < liquidation.expiry) && (liquidation.state == Status.PreDispute),
            "Liquidation has expired or has already been disputed"
        );
        _;
    }
    // Callable either post the liquidation's expiry or after a dispute has been resolved,
    // i.e. once a dispute has been requested, the liquidation's expiry ceases to matter
    modifier onlyPostExpiryOrPostDispute(uint id, address sponsor) {
        LiquidationData storage liquidation = _getLiquidationData(sponsor, id);
        Status state = liquidation.state;
        require(
            (state == Status.DisputeSucceeded) ||
                (state == Status.DisputeFailed) ||
                ((liquidation.expiry <= getCurrentTime()) && (state == Status.PreDispute)),
            "Liquidation has not expired or is pending dispute"
        );
        _;
    }
    // Callable only after a liquidation has been disputed but has not yet resolved
    modifier onlyPendingDispute(uint id, address sponsor) {
        require(
            _getLiquidationData(sponsor, id).state == Status.PendingDispute,
            "Liquidation is not currently pending dispute"
        );
        _;
    }

    /**
     * Constructor: set universal Liquidation variables
     */

    // TODO: order and name these constructor parameters in the same way that they are done in the priceless position manager.
    constructor(
        bool _isTest,
        uint _positionExpiry,
        uint _positionWithdrawalLiveness,
        address _collateralCurrency,
        FixedPoint.Unsigned memory _collateralRequirement,
        FixedPoint.Unsigned memory _disputeBondPct,
        FixedPoint.Unsigned memory _sponsorDisputeRewardPct,
        FixedPoint.Unsigned memory _disputerDisputeRewardPct,
        uint _liquidationLiveness,
        address _finderAddress,
        bytes32 _priceFeedIdentifier
    )
        public
        PricelessPositionManager(
            _positionExpiry,
            _positionWithdrawalLiveness,
            _collateralCurrency,
            _isTest,
            _finderAddress,
            _priceFeedIdentifier
        )
    {
        require(
            _sponsorDisputeRewardPct.add(_disputerDisputeRewardPct).isLessThan(1),
            "Sponsor and Disputer dispute rewards shouldn't sum to 100% or more"
        );
        require(_collateralRequirement.isGreaterThan(1), "The collateral requirement must be at minimum 100%");

        collateralRequirement = _collateralRequirement;
        disputeBondPct = _disputeBondPct;
        sponsorDisputeRewardPct = _sponsorDisputeRewardPct;
        disputerDisputeRewardPct = _disputerDisputeRewardPct;
        liquidationLiveness = _liquidationLiveness;
    }

    /**
     * Liquidates the sponsor's position if the caller has enough
     * synthetic tokens to retire the position's outstanding tokens.
     *
     * This method will generate an ID that will uniquely identify liquidation
     * for the sponsor.
     * Returns UUID of new liquidation for the sponsor
     */
    // TODO: Perhaps pass this ID via an event rather than a return value
    // TODO: Possibly allow partial liquidations
    // TODO: this should only be callable `onlyPreExpiration`
    function createLiquidation(address sponsor) public returns (uint uuid) {
        // Attempt to retrieve Position data for sponsor
        PositionData storage positionToLiquidate = _getPositionData(sponsor);

        // Construct liquidation object.
        // Note: all dispute-related values are just zeroed out until a dispute occurs.
        uint newLength = liquidations[sponsor].push(
            LiquidationData({
                expiry: getCurrentTime() + liquidationLiveness,
                liquidator: msg.sender,
                state: Status.PreDispute,
                lockedCollateral: positionToLiquidate.collateral,
                tokensOutstanding: positionToLiquidate.tokensOutstanding,
                liquidatedCollateral: positionToLiquidate.collateral.sub(positionToLiquidate.withdrawalRequestAmount),
                disputer: address(0),
                disputeTime: 0,
                settlementPrice: FixedPoint.fromUnscaledUint(0),
                hasSponsorWithdrawn: false,
                hasLiquidatorWithdrawn: false,
                hasDisputorWithdrawn: false
            })
        );

        // UUID is the index of the LiquidationData that was just pushed into the array, which is length - 1.
        uuid = newLength.sub(1);

        // Destroy tokens
        require(
            tokenCurrency.transferFrom(msg.sender, address(this), positionToLiquidate.tokensOutstanding.rawValue),
            "failed to transfer synthetic tokens from sender"
        );
        tokenCurrency.burn(positionToLiquidate.tokensOutstanding.rawValue);

        // Remove underlying collateral and debt from position and decrement the overall contract collateral and debt.
        _deleteSponsorPosition(sponsor);
    }

    /**
     * Disputes a liquidation if the caller has enough collateral to post a dispute bond.
     * Can only dispute a liquidation before the liquidation expires and if there are no
     * other pending disputes
     */
    function dispute(uint id, address sponsor) public onlyPreExpiryAndPreDispute(id, sponsor) {
        LiquidationData storage disputedLiquidation = _getLiquidationData(sponsor, id);

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

        // Enqueue a request with the DVM.
        _requestOraclePrice(disputedLiquidation.disputeTime);
    }

    /**
     * Anyone can call this method to settle a pending dispute. This
     * is only possible after the DVM has resolved a price. Callers should
     * call hasPrice() on the DVM before calling this to ensure
     * that the DVM has resolved a price. This method then calculates whether the
     * dispute on the liquidation was successful usin only the settlement price,
     * tokens outstanding, locked collateral (post-pending withdrawals), and liquidation ratio
     */
    function settleDispute(uint id, address sponsor) public onlyPendingDispute(id, sponsor) {
        LiquidationData storage disputedLiquidation = _getLiquidationData(sponsor, id);

        // Get the returned price from the oracle. If this has not yet resolved will revert.
        disputedLiquidation.settlementPrice = _getOraclePrice(disputedLiquidation.disputeTime);

        // Find the value of the tokens in the underlying collateral.
        FixedPoint.Unsigned memory tokenRedemptionValue = disputedLiquidation.tokensOutstanding.mul(
            disputedLiquidation.settlementPrice
        );

        // The required collateral is the value of the tokens in underlying * required collateral ratio.
        FixedPoint.Unsigned memory requiredCollateral = tokenRedemptionValue.mul(collateralRequirement);

        // If the position has more than the required collateral it is solvent and the dispute is valid(liquidation is invalid)
        // Note that this check uses the liquidatedCollateral not the lockedCollateral as this considers withdrawals.

        // TODO: refactor this to use `isGreaterThanOrEqual` when the fixedpoint lib is updated
        bool disputeSucceeded = requiredCollateral.isLessThan(disputedLiquidation.liquidatedCollateral);
        // bool disputeSucceeded = disputedLiquidation.liquidatedCollateral.isGreaterThan(requiredCollateral);

        if (disputeSucceeded) {
            disputedLiquidation.state = Status.DisputeSucceeded;

        } else {
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
        LiquidationData storage liquidation = _getLiquidationData(sponsor, id);
        require(
            (msg.sender == liquidation.disputer) || (msg.sender == liquidation.liquidator) || (msg.sender == sponsor),
            "must be a disputer, liquidator, or sponsor to request a withdrawal on a liquidation"
        );

        FixedPoint.Unsigned memory tokenRedemptionValue = liquidation.tokensOutstanding.mul(
            liquidation.settlementPrice
        );

        // Calculate rewards as a function of the TRV
        FixedPoint.Unsigned memory disputerDisputeReward = disputerDisputeRewardPct.mul(tokenRedemptionValue);
        FixedPoint.Unsigned memory sponsorDisputeReward = sponsorDisputeRewardPct.mul(tokenRedemptionValue);

        // Dispute bond can always be paid out
        FixedPoint.Unsigned memory disputeBondAmount = liquidation.lockedCollateral.mul(disputeBondPct);

        if (liquidation.state == Status.DisputeSucceeded) {
            if (msg.sender == liquidation.disputer && !liquidation.hasDisputorWithdrawn) {
                // Pay DISPUTER: disputer reward + dispute bond
                FixedPoint.Unsigned memory payToDisputer = disputerDisputeReward.add(disputeBondAmount);
                require(
                    collateralCurrency.transfer(msg.sender, payToDisputer.rawValue),
                    "failed to transfer reward for a successful dispute to disputer"
                );
                liquidation.hasDisputorWithdrawn = true;
            } else if (msg.sender == sponsor && !liquidation.hasSponsorWithdrawn) {
                // Pay SPONSOR: remaining collateral (locked collateral - TRV) + sponsor reward
                FixedPoint.Unsigned memory remainingCollateral;
                remainingCollateral = liquidation.lockedCollateral.sub(tokenRedemptionValue);
                FixedPoint.Unsigned memory payToSponsor = sponsorDisputeReward.add(remainingCollateral);
                require(
                    collateralCurrency.transfer(msg.sender, payToSponsor.rawValue),
                    "failed to transfer reward for a successful dispute to sponsor"
                );
                liquidation.hasSponsorWithdrawn = true;
            } else if (msg.sender == liquidation.liquidator && !liquidation.hasLiquidatorWithdrawn) {
                // Pay LIQUIDATOR: TRV - dispute reward - sponsor reward
                // If TRV > Collateral, then subtract rewards from locked collateral
                // NOTE: This should never be below zero since we prevent (sponsorDisputePct+disputerDisputePct) >= 0 in
                // the constructor when these params are set
                FixedPoint.Unsigned memory payToLiquidator;
                payToLiquidator = tokenRedemptionValue.sub(sponsorDisputeReward).sub(disputerDisputeReward);
                require(
                    collateralCurrency.transfer(msg.sender, payToLiquidator.rawValue),
                    "failed to transfer reward for a successful dispute to liquidator"
                );
                liquidation.hasLiquidatorWithdrawn = true;
            }
            // Free up space once all locked collateral is withdrawn
            if (collateralCurrency.balanceOf(address(this)) == 0) {
                delete liquidations[sponsor][id];
            }
        } else if (
            liquidation.state == Status.DisputeFailed &&
            msg.sender == liquidation.liquidator &&
            !liquidation.hasLiquidatorWithdrawn
        ) {
            // Pay LIQUIDATOR: lockedCollateral + dispute bond
            FixedPoint.Unsigned memory payToLiquidator = liquidation.lockedCollateral.add(disputeBondAmount);
            require(
                collateralCurrency.transfer(msg.sender, payToLiquidator.rawValue),
                "failed to transfer locked collateral plus dispute bond to liquidator"
            );
            liquidation.hasLiquidatorWithdrawn = true;
            delete liquidations[sponsor][id];

        } else if (
            liquidation.state == Status.PreDispute &&
            msg.sender == liquidation.liquidator &&
            !liquidation.hasLiquidatorWithdrawn
        ) {
            // Pay LIQUIDATOR: lockedCollateral
            require(
                collateralCurrency.transfer(msg.sender, liquidation.lockedCollateral.rawValue),
                "failed to transfer locked collateral to liquidator"
            );
            liquidation.hasLiquidatorWithdrawn = true;
            delete liquidations[sponsor][id];
        }
    }

    /**
     * Return a liquidation or throw an error if it does not exist
     */
    function _getLiquidationData(address sponsor, uint uuid)
        internal
        view
        returns (LiquidationData storage liquidation)
    {
        LiquidationData[] storage liquidationArray = liquidations[sponsor];

        // Revert if the caller is attempting to access an invalid liquidation (one that has never been created or one
        // that was deleted after resolution).
        require(
            uuid < liquidationArray.length && liquidationArray[uuid].liquidator != address(0),
            "Invalid liquidation: liquidator address is not set"
        );
        return liquidationArray[uuid];
    }
}

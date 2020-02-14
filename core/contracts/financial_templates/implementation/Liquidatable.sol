pragma solidity ^0.5.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";

import "../../common/FixedPoint.sol";
import "../../common/Testable.sol";
import "./PricelessPositionManager.sol";

/**
@title Liquidatable
@notice Adds logic to a position-managing contract that enables callers to
liquidate an undercollateralized position.
@dev The liquidation has a liveness period before expiring successfully, during which
someone can "dispute" the liquidation, which sends a price request to the relevant
Oracle to settle the final collateralization ratio based on a DVM price. The
contract enforces dispute rewards in order to incentivize disputers to correctly
dispute false liquidations and compensate position sponsors who had their position
incorrectly liquidated. Importantly, a prospective disputer must deposit a dispute
bond that they can lose in the case of an unsuccessful dispute.
*/
contract Liquidatable is PricelessPositionManager {
    using FixedPoint for FixedPoint.Unsigned;
    using SafeMath for uint;

    enum Status { Uninitialized, PreDispute, PendingDispute, DisputeSucceeded, DisputeFailed }

    struct LiquidationData {
        /** Following variables set upon creation of liquidation */
        uint expiry; // When Liquidation ends and becomes 'Expired'
        address sponsor; // Address of the liquidated position's sponsor
        address liquidator; // Address who created this liquidation
        Status state; // Liquidated (and expired or not), Pending a Dispute, or Dispute has resolved
        /** Following variables determined by the position that is being liquidated */
        FixedPoint.Unsigned tokensOutstanding; // Synthetic Tokens required to be burned by liquidator to initiate dispute
        FixedPoint.Unsigned lockedCollateral; // Collateral locked by contract and released upon expiry or post-dispute
        // Amount of collateral being liquidated, which could be different from
        // lockedCollateral if there were pending withdrawals at the time of liquidation
        FixedPoint.Unsigned liquidatedCollateral;
        /** Following variables set upon a dispute request */
        address disputer; // Person who is disputing a liquidation
        uint liquidationTime; // Time when liquidation is initiated, needed to get price from Oracle
        FixedPoint.Unsigned settlementPrice; // Final price as determined by an Oracle following a dispute
    }

    // Liquidations are unique by ID per sponsor
    mapping(address => LiquidationData[]) public liquidations;

    // Amount of time for pending liquidation before expiry
    uint public liquidationLiveness;
    // Required collateral:TRV ratio for a position to be considered sufficiently collateralized.
    FixedPoint.Unsigned public collateralRequirement;
    // Percent of a Liquidation/Position's lockedCollateral to be deposited by a potential disputer
    // Represented as a multiplier, for example 1.5e18 = "150%" and 0.05e18 = "5%"
    FixedPoint.Unsigned public disputeBondPct;
    // Percent of oraclePrice paid to sponsor in the Disputed state (i.e. following a successful dispute)
    // Represented as a multipler, see above
    FixedPoint.Unsigned public sponsorDisputeRewardPct;
    // Percent of oraclePrice paid to disputer in the Disputed state (i.e. following a successful dispute)
    // Represented as a multipler, see above
    FixedPoint.Unsigned public disputerDisputeRewardPct;

    event LiquidationCreated(
        address indexed sponsor,
        address indexed liquidator,
        uint indexed liquidationId,
        uint tokensOutstanding,
        uint lockedCollateral,
        uint liquidatedCollateral
    );
    event LiquidationDisputed(
        address indexed sponsor,
        address indexed liquidator,
        address indexed disputer,
        uint disputeId,
        uint disputeBondAmount
    );
    event DisputeSettled(
        address indexed caller,
        address indexed sponsor,
        address indexed liquidator,
        address disputer,
        uint disputeId,
        bool DisputeSucceeded
    );
    // TODO: add more fields to this event after refactoring the withdrawn function
    event LiquidationWithdrawn(address caller);

    // TODO: could this modifier be replaced with one called `onlyPreDispute` and then the function can use
    // the `onlyPreExpiration` modifier from the base contract and this one in conjunction?

    // Callable before the liquidation's expiry AND there is no pending dispute on the liquidation
    modifier onlyPreExpiryAndPreDispute(uint id, address sponsor) {
        LiquidationData storage liquidation = _getLiquidationData(sponsor, id);
        require((getCurrentTime() < liquidation.expiry) && (liquidation.state == Status.PreDispute));
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
                ((liquidation.expiry <= getCurrentTime()) && (state == Status.PreDispute))
        );
        _;
    }
    // Callable only after a liquidation has been disputed but has not yet resolved
    modifier onlyPendingDispute(uint id, address sponsor) {
        require(_getLiquidationData(sponsor, id).state == Status.PendingDispute);
        _;
    }

    // Define the contract's constructor parameters as a struct to enable more variables to be specified.
    struct ConstructorParams {
        // Params for PricelessPositionManager only.
        bool isTest;
        uint expirationTimestamp;
        uint withdrawalLiveness;
        address collateralAddress;
        address finderAddress;
        address tokenFactoryAddress;
        bytes32 priceFeedIdentifier;
        string syntheticName;
        string syntheticSymbol;
        // Params specifically for Liquidatable.
        uint liquidationLiveness;
        FixedPoint.Unsigned collateralRequirement;
        FixedPoint.Unsigned disputeBondPct;
        FixedPoint.Unsigned sponsorDisputeRewardPct;
        FixedPoint.Unsigned disputerDisputeRewardPct;
    }

    constructor(ConstructorParams memory params)
        public
        PricelessPositionManager(
            params.isTest,
            params.expirationTimestamp,
            params.withdrawalLiveness,
            params.collateralAddress,
            params.finderAddress,
            params.priceFeedIdentifier,
            params.syntheticName,
            params.syntheticSymbol,
            params.tokenFactoryAddress
        )
    {
        require(params.collateralRequirement.isGreaterThan(1));
        require(params.sponsorDisputeRewardPct.add(params.disputerDisputeRewardPct).isLessThan(1));

        // Set liquidatable specific variables.
        liquidationLiveness = params.liquidationLiveness;
        collateralRequirement = params.collateralRequirement;
        disputeBondPct = params.disputeBondPct;
        sponsorDisputeRewardPct = params.sponsorDisputeRewardPct;
        disputerDisputeRewardPct = params.disputerDisputeRewardPct;
    }

    /**
     * @notice Liquidates the sponsor's position if the caller has enough
     * synthetic tokens to retire the position's outstanding tokens.
     * @dev This method generates an ID that will uniquely identify liquidation
     * for the sponsor.
     * @param sponsor address to liquidate
     * @param amountToLiquidate amount of liquidatedCollateral that liquidator wants to liquidate
     * @return uuid of the newly created liquidation
     */

    // TODO: Perhaps pass this ID via an event rather than a return value
    function createLiquidation(address sponsor, FixedPoint.Unsigned calldata amountToLiquidate)
        external
        returns (uint uuid)
    {
        // Attempt to retrieve Position data for sponsor
        PositionData storage positionToLiquidate = _getPositionData(sponsor);
        FixedPoint.Unsigned memory positionCollateral = _getCollateral(positionToLiquidate);
        require(positionCollateral.isGreaterThan(0));

        // Caller is required to include in order to prevent front-running attacks that modify the liquidatedCollateral amount
        require(amountToLiquidate.isEqual(positionCollateral.sub(positionToLiquidate.withdrawalRequestAmount)));

        // Construct liquidation object.
        // Note: all dispute-related values are just zeroed out until a dispute occurs.
        uint newLength = liquidations[sponsor].push(
            LiquidationData({
                expiry: getCurrentTime() + liquidationLiveness,
                sponsor: sponsor,
                liquidator: msg.sender,
                state: Status.PreDispute,
                lockedCollateral: positionCollateral,
                tokensOutstanding: positionToLiquidate.tokensOutstanding,
                liquidatedCollateral: positionCollateral.sub(positionToLiquidate.withdrawalRequestAmount),
                disputer: address(0),
                liquidationTime: getCurrentTime(),
                settlementPrice: FixedPoint.fromUnscaledUint(0)
            })
        );

        // UUID is the index of the LiquidationData that was just pushed into the array, which is length - 1.
        uuid = newLength.sub(1);

        // Destroy tokens
        tokenCurrency.safeTransferFrom(msg.sender, address(this), positionToLiquidate.tokensOutstanding.rawValue);
        tokenCurrency.burn(positionToLiquidate.tokensOutstanding.rawValue);

        // Remove underlying collateral and debt from position and decrement the overall contract collateral and debt.
        _deleteSponsorPosition(sponsor);

        emit LiquidationCreated(
            sponsor,
            msg.sender,
            uuid,
            liquidations[sponsor][uuid].tokensOutstanding.rawValue,
            liquidations[sponsor][uuid].lockedCollateral.rawValue,
            liquidations[sponsor][uuid].liquidatedCollateral.rawValue
        );
    }

    /**
     * @notice Disputes a liquidation, if the caller has enough collateral to post a dispute bond and pay a fixed final fee charged on each price request.
     * @dev Can only dispute a liquidation before the liquidation expires and if there are no
     * other pending disputes.
     * @param id of the disputed liquidation.
     * @param sponsor the address of the sponsor who's liquidation is being disputed.
     */
    function dispute(uint id, address sponsor) external onlyPreExpiryAndPreDispute(id, sponsor) {
        LiquidationData storage disputedLiquidation = _getLiquidationData(sponsor, id);

        FixedPoint.Unsigned memory disputeBondAmount = disputedLiquidation.lockedCollateral.mul(disputeBondPct);

        collateralCurrency.safeTransferFrom(msg.sender, address(this), disputeBondAmount.rawValue);

        // Request a price from DVM,
        // Liquidation is pending dispute until DVM returns a price
        disputedLiquidation.state = Status.PendingDispute;
        disputedLiquidation.disputer = msg.sender;

        // Enqueue a request with the DVM.
        _requestOraclePrice(disputedLiquidation.liquidationTime);

        // Pay a final fee
        _payFinalFees(msg.sender);

        emit LiquidationDisputed(sponsor, disputedLiquidation.liquidator, msg.sender, id, disputeBondAmount.rawValue);
    }

    /**
     * @notice After a liquidation has been disputed, it can be settled by any caller enabling withdrawal to occur.
     * @dev This is only possible after the DVM has resolved a price. Callers should
     * call hasPrice() on the DVM before calling this to ensure
     * that the DVM has resolved a price. This method then calculates whether the
     * dispute on the liquidation was successful using only the settlement price,
     * tokens outstanding, locked collateral (post-pending withdrawals), and liquidation ratio
     * @param id to uniquely identify the dispute to settle
     * @param sponsor the address of the sponsor who's dispute is being settled
     */
    function settleDispute(uint id, address sponsor) external onlyPendingDispute(id, sponsor) {
        LiquidationData storage disputedLiquidation = _getLiquidationData(sponsor, id);

        // Get the returned price from the oracle. If this has not yet resolved will revert.
        disputedLiquidation.settlementPrice = _getOraclePrice(disputedLiquidation.liquidationTime);

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

        emit DisputeSettled(
            msg.sender,
            sponsor,
            disputedLiquidation.liquidator,
            disputedLiquidation.disputer,
            id,
            disputeSucceeded
        );
    }

    /**
     * @notice After a dispute has settled or after a non-disputed liquidation has expired,
     * the sponsor, liquidator, and/or disputer can call this method to receive payments.
     * @dev If the dispute SUCCEEDED: the sponsor, liquidator, and disputer are eligible for payment
     * If the dispute FAILED: only the liquidator can receive payment
     * Once all collateral is withdrawn, delete the liquidation data.
     * @param id uniquely identifies the sponsor's liquidation
     * @param sponsor address of the sponsor associated with the liquidation
     */
    function withdrawLiquidation(uint id, address sponsor)
        public
        onlyPostExpiryOrPostDispute(id, sponsor)
        returns (uint)
    {
        LiquidationData storage liquidation = _getLiquidationData(sponsor, id);
        require(
            (msg.sender == liquidation.disputer) ||
                (msg.sender == liquidation.liquidator) ||
                (msg.sender == liquidation.sponsor)
        );

        FixedPoint.Unsigned memory tokenRedemptionValue = liquidation.tokensOutstanding.mul(
            liquidation.settlementPrice
        );

        // Calculate rewards as a function of the TRV.
        FixedPoint.Unsigned memory disputerDisputeReward = disputerDisputeRewardPct.mul(tokenRedemptionValue);
        FixedPoint.Unsigned memory sponsorDisputeReward = sponsorDisputeRewardPct.mul(tokenRedemptionValue);

        // Dispute bond can always be paid out.
        FixedPoint.Unsigned memory disputeBondAmount = liquidation.lockedCollateral.mul(disputeBondPct);

        // There are three main outcome states: either the dispute succeeded, failed or was not updated.
        // Based on the state, different parties of a liquidation can withdraw different amounts.
        // Once a caller has been paid their address deleted from the struct.
        // This prevents them from being paid multiple from times the same liquidation.

        // Once a payment has been recorded this uint is set to inform clean up at function end.
        uint withdrawalMade = 0;
        if (liquidation.state == Status.DisputeSucceeded) {
            // If the dispute is successful then all three users can withdraw from the contract.
            if (msg.sender == liquidation.disputer) {
                // Pay DISPUTER: disputer reward + dispute bond
                FixedPoint.Unsigned memory payToDisputer = disputerDisputeReward.add(disputeBondAmount);
                require(collateralCurrency.transfer(msg.sender, payToDisputer.rawValue));
                delete liquidation.disputer;
                withdrawalMade = payToDisputer.rawValue;
            } else if (msg.sender == sponsor) {
                // Pay SPONSOR: remaining collateral (locked collateral - TRV) + sponsor reward
                FixedPoint.Unsigned memory remainingCollateral;
                remainingCollateral = liquidation.lockedCollateral.sub(tokenRedemptionValue);
                FixedPoint.Unsigned memory payToSponsor = sponsorDisputeReward.add(remainingCollateral);
                require(collateralCurrency.transfer(msg.sender, payToSponsor.rawValue));
                delete liquidation.sponsor;
                withdrawalMade = payToSponsor.rawValue;
            } else if (msg.sender == liquidation.liquidator) {
                // Pay LIQUIDATOR: TRV - dispute reward - sponsor reward
                // If TRV > Collateral, then subtract rewards from locked collateral
                // NOTE: This should never be below zero since we prevent (sponsorDisputePct+disputerDisputePct) >= 0 in
                // the constructor when these params are set
                FixedPoint.Unsigned memory payToLiquidator = tokenRedemptionValue.sub(sponsorDisputeReward).sub(
                    disputerDisputeReward
                );
                require(collateralCurrency.transfer(msg.sender, payToLiquidator.rawValue));
                delete liquidation.liquidator;
                withdrawalMade = payToLiquidator.rawValue;
            }
            // Free up space once all locked collateral is withdrawn
            if (collateralCurrency.balanceOf(address(this)) == 0) {
                delete liquidations[sponsor][id];
            }
            //In the case of a failed dispute only the liquidator can withdraw.
        } else if (liquidation.state == Status.DisputeFailed && msg.sender == liquidation.liquidator) {
            // Pay LIQUIDATOR: lockedCollateral + dispute bond
            FixedPoint.Unsigned memory payToLiquidator = liquidation.lockedCollateral.add(disputeBondAmount);
            require(collateralCurrency.transfer(msg.sender, payToLiquidator.rawValue));
            withdrawalMade = payToLiquidator.rawValue;
            delete liquidation.liquidator;
            delete liquidations[sponsor][id];
            //If the state is pre-dispute but time has passed liveness then the dispute failed and the liquidator can withdraw
        } else if (liquidation.state == Status.PreDispute && msg.sender == liquidation.liquidator) {
            // Pay LIQUIDATOR: lockedCollateral
            require(collateralCurrency.transfer(msg.sender, liquidation.lockedCollateral.rawValue));
            withdrawalMade = liquidation.lockedCollateral.rawValue;
            delete liquidation.liquidator;
            delete liquidations[sponsor][id];
        }
        if (withdrawalMade > 0) {
            // TODO: add this amount to the event in the issue #875.
            emit LiquidationWithdrawn(msg.sender);
            return withdrawalMade;
        }
        require(false);
    }

    function _getLiquidationData(address sponsor, uint uuid)
        internal
        view
        returns (LiquidationData storage liquidation)
    {
        LiquidationData[] storage liquidationArray = liquidations[sponsor];

        // Revert if the caller is attempting to access an invalid liquidation (one that has never been created or one
        // has never been initialized).
        require(uuid < liquidationArray.length && liquidationArray[uuid].state != Status.Uninitialized);
        return liquidationArray[uuid];
    }
}

pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import "../../common/implementation/FixedPoint.sol";
import "./PricelessPositionManager.sol";


/**
 * @title Liquidatable
 * @notice Adds logic to a position-managing contract that enables callers to liquidate an undercollateralized position.
 * @dev The liquidation has a liveness period before expiring successfully, during which someone can "dispute" the
 * liquidation, which sends a price request to the relevant Oracle to settle the final collateralization ratio based on
 * a DVM price. The contract enforces dispute rewards in order to incentivize disputers to correctly dispute false
 * liquidations and compensate position sponsors who had their position incorrectly liquidated. Importantly, a
 * prospective disputer must deposit a dispute bond that they can lose in the case of an unsuccessful dispute.
 */
contract Liquidatable is PricelessPositionManager {
    using FixedPoint for FixedPoint.Unsigned;
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    /****************************************
     *     LIQUIDATION DATA STRUCTURES      *
     ****************************************/

    // Because of the check in withdrawable(), the order of these enum values should not change.
    enum Status { Uninitialized, PreDispute, PendingDispute, DisputeSucceeded, DisputeFailed }

    struct LiquidationData {
        // Following variables set upon creation of liquidation:
        address sponsor; // Address of the liquidated position's sponsor
        address liquidator; // Address who created this liquidation
        Status state; // Liquidated (and expired or not), Pending a Dispute, or Dispute has resolved
        uint256 liquidationTime; // Time when liquidation is initiated, needed to get price from Oracle
        // Following variables determined by the position that is being liquidated:
        FixedPoint.Unsigned tokensOutstanding; // Synthetic tokens required to be burned by liquidator to initiate dispute
        FixedPoint.Unsigned lockedCollateral; // Collateral locked by contract and released upon expiry or post-dispute
        // Amount of collateral being liquidated, which could be different from
        // lockedCollateral if there were pending withdrawals at the time of liquidation
        FixedPoint.Unsigned liquidatedCollateral;
        // Unit value (starts at 1) that is used to track the fees per unit of collateral over the course of the liquidation.
        FixedPoint.Unsigned rawUnitCollateral;
        // Following variable set upon initiation of a dispute:
        address disputer; // Person who is disputing a liquidation
        // Following variable set upon a resolution of a dispute:
        FixedPoint.Unsigned settlementPrice; // Final price as determined by an Oracle following a dispute
        FixedPoint.Unsigned finalFee;
    }

    // Define the contract's constructor parameters as a struct to enable more variables to be specified.
    // This is required to enable more params, over and above Solidity's limits.
    struct ConstructorParams {
        // Params for PricelessPositionManager only.
        uint256 expirationTimestamp;
        uint256 withdrawalLiveness;
        address collateralAddress;
        address finderAddress;
        address tokenFactoryAddress;
        address timerAddress;
        bytes32 priceFeedIdentifier;
        string syntheticName;
        string syntheticSymbol;
        // Params specifically for Liquidatable.
        uint256 liquidationLiveness;
        FixedPoint.Unsigned collateralRequirement;
        FixedPoint.Unsigned disputeBondPct;
        FixedPoint.Unsigned sponsorDisputeRewardPct;
        FixedPoint.Unsigned disputerDisputeRewardPct;
        FixedPoint.Unsigned minSponsorTokens;
    }

    // Liquidations are unique by ID per sponsor
    mapping(address => LiquidationData[]) public liquidations;

    // Total collateral in liquidation.
    FixedPoint.Unsigned public rawLiquidationCollateral;

    // Immutable contract parameters.

    // Amount of time for pending liquidation before expiry
    uint256 public liquidationLiveness;
    // Required collateral:TRV ratio for a position to be considered sufficiently collateralized.
    FixedPoint.Unsigned public collateralRequirement;
    // Percent of a Liquidation/Position's lockedCollateral to be deposited by a potential disputer
    // Represented as a multiplier, for example 1.5e18 = "150%" and 0.05e18 = "5%"
    FixedPoint.Unsigned public disputeBondPct;
    // Percent of oraclePrice paid to sponsor in the Disputed state (i.e. following a successful dispute)
    // Represented as a multiplier, see above
    FixedPoint.Unsigned public sponsorDisputeRewardPct;
    // Percent of oraclePrice paid to disputer in the Disputed state (i.e. following a successful dispute)
    // Represented as a multiplier, see above
    FixedPoint.Unsigned public disputerDisputeRewardPct;

    /****************************************
     *                EVENTS                *
     ****************************************/

    event LiquidationCreated(
        address indexed sponsor,
        address indexed liquidator,
        uint256 indexed liquidationId,
        uint256 tokensOutstanding,
        uint256 lockedCollateral,
        uint256 liquidatedCollateral
    );
    event LiquidationDisputed(
        address indexed sponsor,
        address indexed liquidator,
        address indexed disputer,
        uint256 liquidationId,
        uint256 disputeBondAmount
    );
    event DisputeSettled(
        address indexed caller,
        address indexed sponsor,
        address indexed liquidator,
        address disputer,
        uint256 liquidationId,
        bool disputeSucceeded
    );
    event LiquidationWithdrawn(address indexed caller, uint256 withdrawalAmount, Status indexed liquidationStatus);

    /****************************************
     *              MODIFIERS               *
     ****************************************/

    modifier disputable(uint256 liquidationId, address sponsor) {
        _disputable(liquidationId, sponsor);
        _;
    }

    modifier withdrawable(uint256 liquidationId, address sponsor) {
        _withdrawable(liquidationId, sponsor);
        _;
    }

    /**
     * @notice Constructs the liquidatable contract.
     * @param params struct to define input parameters for construction of Liquidatable. Some params
     * are fed directly into the PricelessPositionManager's constructor within the inheritance tree.
     */
    constructor(ConstructorParams memory params)
        public
        PricelessPositionManager(
            params.expirationTimestamp,
            params.withdrawalLiveness,
            params.collateralAddress,
            params.finderAddress,
            params.priceFeedIdentifier,
            params.syntheticName,
            params.syntheticSymbol,
            params.tokenFactoryAddress,
            params.minSponsorTokens,
            params.timerAddress
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

    /****************************************
     *        LIQUIDATION FUNCTIONS         *
     ****************************************/

    /**
     * @notice Liquidates the sponsor's position if the caller has enough
     * synthetic tokens to retire the position's outstanding tokens.
     * @dev This method generates an ID that will uniquely identify liquidation for the sponsor. This contract must be
     * approved to spend at least `tokensLiquidated` of `tokenCurrency` and at least `finalFeeBond` of `collateralCurrency`.
     * @param sponsor address to liquidate.
     * @param collateralPerToken abort the liquidation if the position's collateral per token exceeds this value.
     * @param maxTokensToLiquidate max number of tokens to liquidate.
     * @return liquidationId of the newly created liquidation.
     */
    function createLiquidation(
        address sponsor,
        FixedPoint.Unsigned calldata collateralPerToken,
        FixedPoint.Unsigned calldata maxTokensToLiquidate
    )
        external
        fees()
        onlyPreExpiration()
        returns (
            uint256 liquidationId,
            FixedPoint.Unsigned memory tokensLiquidated,
            FixedPoint.Unsigned memory finalFeeBond
        )
    {
        // Retrieve Position data for sponsor
        PositionData storage positionToLiquidate = _getPositionData(sponsor);

        tokensLiquidated = FixedPoint.min(maxTokensToLiquidate, positionToLiquidate.tokensOutstanding);
        FixedPoint.Unsigned memory ratio = tokensLiquidated.div(positionToLiquidate.tokensOutstanding);

        // Starting values for the Position being liquidated.
        // If withdrawal request amount is > position's collateral, then set this to 0, otherwise set it to (startCollateral - withdrawal request amount).
        FixedPoint.Unsigned memory startCollateral = _getFeeAdjustedCollateral(positionToLiquidate.rawCollateral);
        FixedPoint.Unsigned memory startCollateralNetOfWithdrawal = FixedPoint.fromUnscaledUint(0);
        if (positionToLiquidate.withdrawalRequestAmount.isLessThanOrEqual(startCollateral)) {
            startCollateralNetOfWithdrawal = startCollateral.sub(positionToLiquidate.withdrawalRequestAmount);
        }

        // Scoping to get rid of a stack too deep error.
        {
            FixedPoint.Unsigned memory startTokens = positionToLiquidate.tokensOutstanding;

            // Check the max price constraint to ensure that the Position's collateralization ratio hasn't increased beyond
            // what the liquidator was willing to liquidate at.
            // collateralPerToken >= startCollateralNetOfWithdrawal / startTokens.
            require(collateralPerToken.mul(startTokens).isGreaterThanOrEqual(startCollateralNetOfWithdrawal));
        }

        // The actual amount of collateral that gets moved to the liquidation.
        FixedPoint.Unsigned memory lockedCollateral = startCollateral.mul(ratio);
        // For purposes of disputes, it's actually this liquidatedCollateral value that's used. This value is net of
        // withdrawal requests.
        FixedPoint.Unsigned memory liquidatedCollateral = startCollateralNetOfWithdrawal.mul(ratio);
        // Part of the withdrawal request is also removed. Ideally:
        // liquidatedCollateral + withdrawalAmountToRemove = lockedCollateral.
        FixedPoint.Unsigned memory withdrawalAmountToRemove = positionToLiquidate.withdrawalRequestAmount.mul(ratio);

        // Compute final fee at time of liquidation.
        finalFeeBond = _computeFinalFees();

        // Construct liquidation object.
        // Note: all dispute-related values are just zeroed out until a dispute occurs.
        // liquidationId is the index of the new LiquidationData that we will push into the array,
        // which is equal to the current length of the array pre-push.
        liquidationId = liquidations[sponsor].length;
        liquidations[sponsor].push(
            LiquidationData({
                sponsor: sponsor,
                liquidator: msg.sender,
                state: Status.PreDispute,
                liquidationTime: getCurrentTime(),
                tokensOutstanding: tokensLiquidated,
                lockedCollateral: lockedCollateral,
                liquidatedCollateral: liquidatedCollateral,
                rawUnitCollateral: _convertToRawCollateral(FixedPoint.fromUnscaledUint(1)),
                disputer: address(0),
                settlementPrice: FixedPoint.fromUnscaledUint(0),
                finalFee: finalFeeBond
            })
        );

        // Adjust the sponsor's remaining position.
        _reduceSponsorPosition(sponsor, tokensLiquidated, lockedCollateral, withdrawalAmountToRemove);

        // Add to the global liquidation collateral count.
        _addCollateral(rawLiquidationCollateral, lockedCollateral.add(finalFeeBond));

        emit LiquidationCreated(
            sponsor,
            msg.sender,
            liquidationId,
            tokensLiquidated.rawValue,
            lockedCollateral.rawValue,
            liquidatedCollateral.rawValue
        );

        // Destroy tokens
        tokenCurrency.safeTransferFrom(msg.sender, address(this), tokensLiquidated.rawValue);
        tokenCurrency.burn(tokensLiquidated.rawValue);

        // Pull final fee from liquidator.
        collateralCurrency.safeTransferFrom(msg.sender, address(this), finalFeeBond.rawValue);
    }

    /**
     * @notice Disputes a liquidation, if the caller has enough collateral to post a dispute bond
     * and pay a fixed final fee charged on each price request.
     * @dev Can only dispute a liquidation before the liquidation expires and if there are no other pending disputes.
     * This contract must be approved to spend at least the dispute bond amount of `collateralCurrency`. This dispute
     * bond amount is calculated from `disputeBondPct` times the collateral in the liquidation.
     * @param liquidationId of the disputed liquidation.
     * @param sponsor the address of the sponsor whose liquidation is being disputed.
     */
    function dispute(uint256 liquidationId, address sponsor)
        external
        disputable(liquidationId, sponsor)
        fees()
        returns (FixedPoint.Unsigned memory totalPaid)
    {
        LiquidationData storage disputedLiquidation = _getLiquidationData(sponsor, liquidationId);

        // Multiply by the unit collateral so the dispute bond is a percentage of the locked collateral after fees.
        FixedPoint.Unsigned memory disputeBondAmount = disputedLiquidation.lockedCollateral.mul(disputeBondPct).mul(
            _getFeeAdjustedCollateral(disputedLiquidation.rawUnitCollateral)
        );
        _addCollateral(rawLiquidationCollateral, disputeBondAmount);

        // Request a price from DVM,
        // Liquidation is pending dispute until DVM returns a price
        disputedLiquidation.state = Status.PendingDispute;
        disputedLiquidation.disputer = msg.sender;

        // Enqueue a request with the DVM.
        _requestOraclePrice(disputedLiquidation.liquidationTime);

        emit LiquidationDisputed(
            sponsor,
            disputedLiquidation.liquidator,
            msg.sender,
            liquidationId,
            disputeBondAmount.rawValue
        );

        totalPaid = disputeBondAmount.add(disputedLiquidation.finalFee);

        // Pay a final fee.
        _payFinalFees(msg.sender, disputedLiquidation.finalFee);

        collateralCurrency.safeTransferFrom(msg.sender, address(this), disputeBondAmount.rawValue);
    }

    /**
     * @notice After a dispute has settled or after a non-disputed liquidation has expired,
     * the sponsor, liquidator, and/or disputer can call this method to receive payments.
     * @dev If the dispute SUCCEEDED: the sponsor, liquidator, and disputer are eligible for payment.
     * If the dispute FAILED: only the liquidator can receive payment
     * Once all collateral is withdrawn, delete the liquidation data.
     * @param liquidationId uniquely identifies the sponsor's liquidation.
     * @param sponsor address of the sponsor associated with the liquidation.
     * @return amountWithdrawn the total amount of underlying returned from the liquidation.
     */
    function withdrawLiquidation(uint256 liquidationId, address sponsor)
        public
        withdrawable(liquidationId, sponsor)
        fees()
        returns (FixedPoint.Unsigned memory amountWithdrawn)
    {
        LiquidationData storage liquidation = _getLiquidationData(sponsor, liquidationId);
        require(
            (msg.sender == liquidation.disputer) ||
                (msg.sender == liquidation.liquidator) ||
                (msg.sender == liquidation.sponsor)
        );

        // Settles the liquidation if necessary.
        // Note: this will fail if the price has not resolved yet.
        _settle(liquidationId, sponsor);

        // Calculate rewards as a function of the TRV. Note: all payouts are scaled by the unit collateral value so
        // all payouts are charged the fees pro rata.
        FixedPoint.Unsigned memory feeAttenuation = _getFeeAdjustedCollateral(liquidation.rawUnitCollateral);
        FixedPoint.Unsigned memory tokenRedemptionValue = liquidation
            .tokensOutstanding
            .mul(liquidation.settlementPrice)
            .mul(feeAttenuation);
        FixedPoint.Unsigned memory collateral = liquidation.lockedCollateral.mul(feeAttenuation);
        FixedPoint.Unsigned memory disputerDisputeReward = disputerDisputeRewardPct.mul(tokenRedemptionValue);
        FixedPoint.Unsigned memory sponsorDisputeReward = sponsorDisputeRewardPct.mul(tokenRedemptionValue);
        FixedPoint.Unsigned memory disputeBondAmount = collateral.mul(disputeBondPct);
        FixedPoint.Unsigned memory finalFee = liquidation.finalFee.mul(feeAttenuation);

        // There are three main outcome states: either the dispute succeeded, failed or was not updated.
        // Based on the state, different parties of a liquidation can withdraw different amounts.
        // Once a caller has been paid their address deleted from the struct.
        // This prevents them from being paid multiple from times the same liquidation.
        FixedPoint.Unsigned memory withdrawalAmount = FixedPoint.fromUnscaledUint(0);
        if (liquidation.state == Status.DisputeSucceeded) {
            // If the dispute is successful then all three users can withdraw from the contract.
            if (msg.sender == liquidation.disputer) {
                // Pay DISPUTER: disputer reward + dispute bond + returned final fee
                FixedPoint.Unsigned memory payToDisputer = disputerDisputeReward.add(disputeBondAmount).add(finalFee);
                withdrawalAmount = withdrawalAmount.add(payToDisputer);
                delete liquidation.disputer;
            }

            if (msg.sender == liquidation.sponsor) {
                // Pay SPONSOR: remaining collateral (collateral - TRV) + sponsor reward
                FixedPoint.Unsigned memory remainingCollateral = collateral.sub(tokenRedemptionValue);
                FixedPoint.Unsigned memory payToSponsor = sponsorDisputeReward.add(remainingCollateral);
                withdrawalAmount = withdrawalAmount.add(payToSponsor);
                delete liquidation.sponsor;
            }

            if (msg.sender == liquidation.liquidator) {
                // Pay LIQUIDATOR: TRV - dispute reward - sponsor reward
                // If TRV > Collateral, then subtract rewards from collateral
                // NOTE: This should never be below zero since we prevent (sponsorDisputePct+disputerDisputePct) >= 0 in
                // the constructor when these params are set
                FixedPoint.Unsigned memory payToLiquidator = tokenRedemptionValue.sub(sponsorDisputeReward).sub(
                    disputerDisputeReward
                );
                withdrawalAmount = withdrawalAmount.add(payToLiquidator);
                delete liquidation.liquidator;
            }

            // Free up space once all collateral is withdrawn
            if (
                liquidation.disputer == address(0) &&
                liquidation.sponsor == address(0) &&
                liquidation.liquidator == address(0)
            ) {
                delete liquidations[sponsor][liquidationId];
            }
            // In the case of a failed dispute only the liquidator can withdraw.
        } else if (liquidation.state == Status.DisputeFailed && msg.sender == liquidation.liquidator) {
            // Pay LIQUIDATOR: collateral + dispute bond + returned final fee
            withdrawalAmount = collateral.add(disputeBondAmount).add(finalFee);
            delete liquidations[sponsor][liquidationId];
            // If the state is pre-dispute but time has passed liveness then the dispute failed and the liquidator can withdraw
        } else if (liquidation.state == Status.PreDispute && msg.sender == liquidation.liquidator) {
            // Pay LIQUIDATOR: collateral + returned final fee
            withdrawalAmount = collateral.add(finalFee);
            delete liquidations[sponsor][liquidationId];
        }

        require(withdrawalAmount.isGreaterThan(0));
        amountWithdrawn = _removeCollateral(rawLiquidationCollateral, withdrawalAmount);

        emit LiquidationWithdrawn(msg.sender, amountWithdrawn.rawValue, liquidation.state);

        collateralCurrency.safeTransfer(msg.sender, amountWithdrawn.rawValue);
    }

    /**
     * @dev This overrides pfc() so the Liquidatable contract can report its profit from corruption.
     */
    function pfc() public override view returns (FixedPoint.Unsigned memory) {
        return super.pfc().add(_getFeeAdjustedCollateral(rawLiquidationCollateral));
    }

    function getLiquidations(address sponsor) external view returns (LiquidationData[] memory) {
        return liquidations[sponsor];
    }

    /****************************************
     *          INTERNAL FUNCTIONS          *
     ****************************************/

    // This settles a liquidation if it is in the PendingDispute state. If not, it will immediately return.
    // If the liquidation is in the PendingDispute state, but a price is not available, this will revert.
    function _settle(uint256 liquidationId, address sponsor) internal {
        LiquidationData storage liquidation = _getLiquidationData(sponsor, liquidationId);

        // Settlement only happens when state == PendingDispute and will only happen once per liquidation.
        // If this liquidation is not ready to be settled, this method should return immediately.
        if (liquidation.state != Status.PendingDispute) {
            return;
        }

        // Get the returned price from the oracle. If this has not yet resolved will revert.
        liquidation.settlementPrice = _getOraclePrice(liquidation.liquidationTime);

        // Find the value of the tokens in the underlying collateral.
        FixedPoint.Unsigned memory tokenRedemptionValue = liquidation.tokensOutstanding.mul(
            liquidation.settlementPrice
        );

        // The required collateral is the value of the tokens in underlying * required collateral ratio.
        FixedPoint.Unsigned memory requiredCollateral = tokenRedemptionValue.mul(collateralRequirement);

        // If the position has more than the required collateral it is solvent and the dispute is valid(liquidation is invalid)
        // Note that this check uses the liquidatedCollateral not the lockedCollateral as this considers withdrawals.
        bool disputeSucceeded = liquidation.liquidatedCollateral.isGreaterThanOrEqual(requiredCollateral);
        liquidation.state = disputeSucceeded ? Status.DisputeSucceeded : Status.DisputeFailed;

        emit DisputeSettled(
            msg.sender,
            sponsor,
            liquidation.liquidator,
            liquidation.disputer,
            liquidationId,
            disputeSucceeded
        );
    }

    function _getLiquidationData(address sponsor, uint256 liquidationId)
        internal
        view
        returns (LiquidationData storage liquidation)
    {
        LiquidationData[] storage liquidationArray = liquidations[sponsor];

        // Revert if the caller is attempting to access an invalid liquidation
        // (one that has never been created or one has never been initialized).
        require(
            liquidationId < liquidationArray.length && liquidationArray[liquidationId].state != Status.Uninitialized
        );
        return liquidationArray[liquidationId];
    }

    function _getLiquidationExpiry(LiquidationData storage liquidation) internal view returns (uint256) {
        return liquidation.liquidationTime.add(liquidationLiveness);
    }

    // These internal functions are supposed to act identically to modifiers, but re-used modifiers
    // unnecessarily increase contract bytecode size.
    // source: https://blog.polymath.network/solidity-tips-and-tricks-to-save-gas-and-reduce-bytecode-size-c44580b218e6
    function _disputable(uint256 liquidationId, address sponsor) internal view {
        LiquidationData storage liquidation = _getLiquidationData(sponsor, liquidationId);
        require((getCurrentTime() < _getLiquidationExpiry(liquidation)) && (liquidation.state == Status.PreDispute));
    }

    function _withdrawable(uint256 liquidationId, address sponsor) internal view {
        LiquidationData storage liquidation = _getLiquidationData(sponsor, liquidationId);
        Status state = liquidation.state;

        // Must be disputed or the liquidation has passed expiry.
        require(
            (state > Status.PreDispute) ||
                ((_getLiquidationExpiry(liquidation) <= getCurrentTime()) && (state == Status.PreDispute))
        );
    }
}

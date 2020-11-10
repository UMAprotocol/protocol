pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "../../common/implementation/FixedPoint.sol";
import "./PerpetualPositionManagerPoolPartyLib.sol";
import "./PerpetualLiquidatablePoolParty.sol";
import "../common/FeePayerPoolPartyLib.sol";


library PerpetualLiquidatablePoolPartyLib {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    using SafeERC20 for JarvisExpandedIERC20;
    using FixedPoint for FixedPoint.Unsigned;
    using PerpetualPositionManagerPoolPartyLib for PerpetualPositionManagerPoolParty.PositionData;
    using FeePayerPoolPartyLib for FixedPoint.Unsigned;
    using PerpetualPositionManagerPoolPartyLib for PerpetualPositionManagerPoolParty.PositionManagerData;
    using PerpetualLiquidatablePoolPartyLib for PerpetualLiquidatablePoolParty.LiquidationData;

    struct CreateLiquidationParams {
        FixedPoint.Unsigned minCollateralPerToken;
        FixedPoint.Unsigned maxCollateralPerToken;
        FixedPoint.Unsigned maxTokensToLiquidate;
        uint256 actualTime;
        uint256 deadline;
        FixedPoint.Unsigned finalFee;
        address sponsor;
    }

    struct CreateLiquidationCollateral {
        FixedPoint.Unsigned startCollateral;
        FixedPoint.Unsigned startCollateralNetOfWithdrawal;
        FixedPoint.Unsigned finalFeeBond;
        address sponsor;
    }

    struct CreateLiquidationReturnParams {
        uint256 liquidationId;
        FixedPoint.Unsigned lockedCollateral;
        FixedPoint.Unsigned liquidatedCollateral;
        FixedPoint.Unsigned tokensLiquidated;
        FixedPoint.Unsigned finalFeeBond;
    }

    struct SettleParams {
        FixedPoint.Unsigned feeAttenuation;
        FixedPoint.Unsigned settlementPrice;
        FixedPoint.Unsigned tokenRedemptionValue;
        FixedPoint.Unsigned collateral;
        FixedPoint.Unsigned disputerDisputeReward;
        FixedPoint.Unsigned sponsorDisputeReward;
        FixedPoint.Unsigned disputeBondAmount;
        FixedPoint.Unsigned finalFee;
        FixedPoint.Unsigned withdrawalAmount;
    }

    event LiquidationCreated(
        address indexed sponsor,
        address indexed liquidator,
        uint256 indexed liquidationId,
        uint256 tokensOutstanding,
        uint256 lockedCollateral,
        uint256 liquidatedCollateral,
        uint256 liquidationTime
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

    event LiquidationWithdrawn(
        address indexed caller,
        uint256 paidToLiquidator,
        uint256 paidToDisputer,
        uint256 paidToSponsor,
        PerpetualLiquidatablePoolParty.Status indexed liquidationStatus,
        uint256 settlementPrice
    );

    function createLiquidation(
        PerpetualPositionManagerPoolParty.PositionData storage positionToLiquidate,
        PerpetualPositionManagerPoolParty.GlobalPositionData storage globalPositionData,
        PerpetualPositionManagerPoolParty.PositionManagerData storage positionManagerData,
        PerpetualLiquidatablePoolParty.LiquidatableData storage liquidatableData,
        PerpetualLiquidatablePoolParty.LiquidationData[] storage liquidations,
        CreateLiquidationParams memory params,
        FeePayerPoolParty.FeePayerData storage feePayerData
    ) external returns (CreateLiquidationReturnParams memory returnValues) {
        FixedPoint.Unsigned memory startCollateral;
        FixedPoint.Unsigned memory startCollateralNetOfWithdrawal;

        (startCollateral, startCollateralNetOfWithdrawal, returnValues.tokensLiquidated) = calculateNetLiquidation(
            positionToLiquidate,
            params,
            feePayerData
        );

        // Scoping to get rid of a stack too deep error.
        {
            FixedPoint.Unsigned memory startTokens = positionToLiquidate.tokensOutstanding;

            // The Position's collateralization ratio must be between [minCollateralPerToken, maxCollateralPerToken].
            // maxCollateralPerToken >= startCollateralNetOfWithdrawal / startTokens.
            require(
                params.maxCollateralPerToken.mul(startTokens).isGreaterThanOrEqual(startCollateralNetOfWithdrawal),
                "CR is more than max liq. price"
            );
            // minCollateralPerToken >= startCollateralNetOfWithdrawal / startTokens.
            require(
                params.minCollateralPerToken.mul(startTokens).isLessThanOrEqual(startCollateralNetOfWithdrawal),
                "CR is less than min liq. price"
            );
        }
        {
            // Compute final fee at time of liquidation.
            returnValues.finalFeeBond = params.finalFee;

            // These will be populated within the scope below.
            FixedPoint.Unsigned memory lockedCollateral;
            FixedPoint.Unsigned memory liquidatedCollateral;

            CreateLiquidationCollateral memory liquidationCollateral = CreateLiquidationCollateral(
                startCollateral,
                startCollateralNetOfWithdrawal,
                returnValues.finalFeeBond,
                params.sponsor
            );

            (lockedCollateral, liquidatedCollateral, returnValues.tokensLiquidated) = liquidateCollateral(
                positionToLiquidate,
                globalPositionData,
                positionManagerData,
                liquidatableData,
                feePayerData,
                liquidationCollateral
            );

            // Construct liquidation object.
            // Note: All dispute-related values are zeroed out until a dispute occurs. liquidationId is the index of the new
            // LiquidationData that is pushed into the array, which is equal to the current length of the array pre-push.
            returnValues.liquidationId = liquidations.length;
            liquidations.push(
                PerpetualLiquidatablePoolParty.LiquidationData({
                    sponsor: params.sponsor,
                    liquidator: msg.sender,
                    state: PerpetualLiquidatablePoolParty.Status.PreDispute,
                    liquidationTime: params.actualTime,
                    tokensOutstanding: returnValues.tokensLiquidated,
                    lockedCollateral: lockedCollateral,
                    liquidatedCollateral: liquidatedCollateral,
                    rawUnitCollateral: FixedPoint.fromUnscaledUint(1).convertToRawCollateral(
                        feePayerData.cumulativeFeeMultiplier
                    ),
                    disputer: address(0),
                    settlementPrice: FixedPoint.fromUnscaledUint(0),
                    finalFee: returnValues.finalFeeBond
                })
            );
        }
        // If this liquidation is a subsequent liquidation on the position, and the liquidation size is larger than
        // some "griefing threshold", then re-set the liveness. This enables a liquidation against a withdraw request to be
        // "dragged out" if the position is very large and liquidators need time to gather funds. The griefing threshold
        // is enforced so that liquidations for trivially small # of tokens cannot drag out an honest sponsor's slow withdrawal.

        // We arbitrarily set the "griefing threshold" to `minSponsorTokens` because it is the only parameter
        // denominated in token currency units and we can avoid adding another parameter.

        {
            FixedPoint.Unsigned memory griefingThreshold = positionManagerData.minSponsorTokens;
            if (
                positionToLiquidate.withdrawalRequestPassTimestamp > 0 && // The position is undergoing a slow withdrawal.
                positionToLiquidate.withdrawalRequestPassTimestamp <= params.actualTime && // The slow withdrawal has not yet expired.
                returnValues.tokensLiquidated.isGreaterThanOrEqual(griefingThreshold) // The liquidated token count is above a "griefing threshold".
            ) {
                positionToLiquidate.withdrawalRequestPassTimestamp = params.actualTime.add(
                    liquidatableData.liquidationLiveness
                );
            }
        }

        emit LiquidationCreated(
            params.sponsor,
            msg.sender,
            returnValues.liquidationId,
            returnValues.tokensLiquidated.rawValue,
            returnValues.lockedCollateral.rawValue,
            returnValues.liquidatedCollateral.rawValue,
            params.actualTime
        );

        burnAndLiquidateFee(
            positionManagerData,
            feePayerData,
            returnValues.tokensLiquidated,
            returnValues.finalFeeBond
        );
    }

    function dispute(
        PerpetualLiquidatablePoolParty.LiquidationData storage disputedLiquidation,
        PerpetualLiquidatablePoolParty.LiquidatableData storage liquidatableData,
        PerpetualPositionManagerPoolParty.PositionManagerData storage positionManagerData,
        FeePayerPoolParty.FeePayerData storage feePayerData,
        uint256 liquidationId,
        address sponsor
    ) external returns (FixedPoint.Unsigned memory totalPaid) {
        // Multiply by the unit collateral so the dispute bond is a percentage of the locked collateral after fees.
        FixedPoint.Unsigned memory disputeBondAmount = disputedLiquidation
            .lockedCollateral
            .mul(liquidatableData.disputeBondPct)
            .mul(disputedLiquidation.rawUnitCollateral.getFeeAdjustedCollateral(feePayerData.cumulativeFeeMultiplier));
        liquidatableData.rawLiquidationCollateral.addCollateral(
            disputeBondAmount,
            feePayerData.cumulativeFeeMultiplier
        );

        // Request a price from DVM. Liquidation is pending dispute until DVM returns a price.
        disputedLiquidation.state = PerpetualLiquidatablePoolParty.Status.PendingDispute;
        disputedLiquidation.disputer = msg.sender;

        // Enqueue a request with the DVM.
        positionManagerData.requestOraclePrice(disputedLiquidation.liquidationTime, feePayerData);

        emit LiquidationDisputed(
            sponsor,
            disputedLiquidation.liquidator,
            msg.sender,
            liquidationId,
            disputeBondAmount.rawValue
        );

        totalPaid = disputeBondAmount.add(disputedLiquidation.finalFee);

        // Pay the final fee for requesting price from the DVM.
        FeePayerPoolParty(address(this)).payFinalFees(msg.sender, disputedLiquidation.finalFee);

        // Transfer the dispute bond amount from the caller to this contract.
        feePayerData.collateralCurrency.safeTransferFrom(msg.sender, address(this), disputeBondAmount.rawValue);
    }

    function withdrawLiquidation(
        PerpetualLiquidatablePoolParty.LiquidationData storage liquidation,
        PerpetualLiquidatablePoolParty.LiquidatableData storage liquidatableData,
        PerpetualPositionManagerPoolParty.PositionManagerData storage positionManagerData,
        FeePayerPoolParty.FeePayerData storage feePayerData,
        uint256 liquidationId,
        address sponsor
    ) external returns (PerpetualLiquidatablePoolParty.RewardsData memory rewards) {
        // Settles the liquidation if necessary. This call will revert if the price has not resolved yet.
        liquidation._settle(positionManagerData, liquidatableData, feePayerData, liquidationId, sponsor);

        SettleParams memory settleParams;
        // Calculate rewards as a function of the TRV.
        // Note: all payouts are scaled by the unit collateral value so all payouts are charged the fees pro rata.
        settleParams.feeAttenuation = liquidation.rawUnitCollateral.getFeeAdjustedCollateral(
            feePayerData.cumulativeFeeMultiplier
        );
        settleParams.settlementPrice = liquidation.settlementPrice;
        settleParams.tokenRedemptionValue = liquidation.tokensOutstanding.mul(settleParams.settlementPrice).mul(
            settleParams.feeAttenuation
        );
        settleParams.collateral = liquidation.lockedCollateral.mul(settleParams.feeAttenuation);
        settleParams.disputerDisputeReward = liquidatableData.disputerDisputeRewardPct.mul(
            settleParams.tokenRedemptionValue
        );
        settleParams.sponsorDisputeReward = liquidatableData.sponsorDisputeRewardPct.mul(
            settleParams.tokenRedemptionValue
        );
        settleParams.disputeBondAmount = settleParams.collateral.mul(liquidatableData.disputeBondPct);
        settleParams.finalFee = liquidation.finalFee.mul(settleParams.feeAttenuation);

        // There are three main outcome states: either the dispute succeeded, failed or was not updated.
        // Based on the state, different parties of a liquidation receive different amounts.
        // After assigning rewards based on the liquidation status, decrease the total collateral held in this contract
        // by the amount to pay each party. The actual amounts withdrawn might differ if _removeCollateral causes
        // precision loss.

        if (liquidation.state == PerpetualLiquidatablePoolParty.Status.DisputeSucceeded) {
            // If the dispute is successful then all three users should receive rewards:

            // Pay DISPUTER: disputer reward + dispute bond + returned final fee
            rewards.payToDisputer = settleParams.disputerDisputeReward.add(settleParams.disputeBondAmount).add(
                settleParams.finalFee
            );

            // Pay SPONSOR: remaining collateral (collateral - TRV) + sponsor reward
            rewards.payToSponsor = settleParams.sponsorDisputeReward.add(
                settleParams.collateral.sub(settleParams.tokenRedemptionValue)
            );

            // Pay LIQUIDATOR: TRV - dispute reward - sponsor reward
            // If TRV > Collateral, then subtract rewards from collateral
            // NOTE: This should never be below zero since we prevent (sponsorDisputePct+disputerDisputePct) >= 0 in
            // the constructor when these params are set.
            rewards.payToLiquidator = settleParams.tokenRedemptionValue.sub(settleParams.sponsorDisputeReward).sub(
                settleParams.disputerDisputeReward
            );

            // Transfer rewards and debit collateral
            rewards.paidToLiquidator = liquidatableData.rawLiquidationCollateral.removeCollateral(
                rewards.payToLiquidator,
                feePayerData.cumulativeFeeMultiplier
            );
            rewards.paidToSponsor = liquidatableData.rawLiquidationCollateral.removeCollateral(
                rewards.payToSponsor,
                feePayerData.cumulativeFeeMultiplier
            );
            rewards.paidToDisputer = liquidatableData.rawLiquidationCollateral.removeCollateral(
                rewards.payToDisputer,
                feePayerData.cumulativeFeeMultiplier
            );

            feePayerData.collateralCurrency.safeTransfer(liquidation.disputer, rewards.paidToDisputer.rawValue);
            feePayerData.collateralCurrency.safeTransfer(liquidation.liquidator, rewards.paidToLiquidator.rawValue);
            feePayerData.collateralCurrency.safeTransfer(liquidation.sponsor, rewards.paidToSponsor.rawValue);

            // In the case of a failed dispute only the liquidator can withdraw.
        } else if (liquidation.state == PerpetualLiquidatablePoolParty.Status.DisputeFailed) {
            // Pay LIQUIDATOR: collateral + dispute bond + returned final fee
            rewards.payToLiquidator = settleParams.collateral.add(settleParams.disputeBondAmount).add(
                settleParams.finalFee
            );

            // Transfer rewards and debit collateral
            rewards.paidToLiquidator = liquidatableData.rawLiquidationCollateral.removeCollateral(
                rewards.payToLiquidator,
                feePayerData.cumulativeFeeMultiplier
            );

            feePayerData.collateralCurrency.safeTransfer(liquidation.liquidator, rewards.paidToLiquidator.rawValue);

            // If the state is pre-dispute but time has passed liveness then there was no dispute. We represent this
            // state as a dispute failed and the liquidator can withdraw.
        } else if (liquidation.state == PerpetualLiquidatablePoolParty.Status.PreDispute) {
            // Pay LIQUIDATOR: collateral + returned final fee
            rewards.payToLiquidator = settleParams.collateral.add(settleParams.finalFee);

            // Transfer rewards and debit collateral
            rewards.paidToLiquidator = liquidatableData.rawLiquidationCollateral.removeCollateral(
                rewards.payToLiquidator,
                feePayerData.cumulativeFeeMultiplier
            );

            feePayerData.collateralCurrency.safeTransfer(liquidation.liquidator, rewards.paidToLiquidator.rawValue);
        }

        emit LiquidationWithdrawn(
            msg.sender,
            rewards.paidToLiquidator.rawValue,
            rewards.paidToDisputer.rawValue,
            rewards.paidToSponsor.rawValue,
            liquidation.state,
            settleParams.settlementPrice.rawValue
        );

        // Free up space after collateral is withdrawn by removing the liquidation object from the array.
        PerpetualLiquidatablePoolParty(address(this)).deleteLiquidation(liquidationId, sponsor);

        return rewards;
    }

    function calculateNetLiquidation(
        PerpetualPositionManagerPoolParty.PositionData storage positionToLiquidate,
        CreateLiquidationParams memory params,
        FeePayerPoolParty.FeePayerData storage feePayerData
    )
        internal
        view
        returns (
            FixedPoint.Unsigned memory startCollateral,
            FixedPoint.Unsigned memory startCollateralNetOfWithdrawal,
            FixedPoint.Unsigned memory tokensLiquidated
        )
    {
        // Check that this transaction was mined pre-deadline.
        tokensLiquidated = FixedPoint.min(params.maxTokensToLiquidate, positionToLiquidate.tokensOutstanding);
        require(tokensLiquidated.isGreaterThan(0), "Liquidating 0 tokens");

        // Check that this transaction was mined pre-deadline.
        require(params.actualTime <= params.deadline, "Mined after deadline");

        // Starting values for the Position being liquidated. If withdrawal request amount is > position's collateral,
        // then set this to 0, otherwise set it to (startCollateral - withdrawal request amount).
        startCollateral = positionToLiquidate.rawCollateral._getFeeAdjustedCollateral(
            feePayerData.cumulativeFeeMultiplier
        );
        startCollateralNetOfWithdrawal = FixedPoint.fromUnscaledUint(0);

        if (positionToLiquidate.withdrawalRequestAmount.isLessThanOrEqual(startCollateral)) {
            startCollateralNetOfWithdrawal = startCollateral.sub(positionToLiquidate.withdrawalRequestAmount);
        }
    }

    function liquidateCollateral(
        PerpetualPositionManagerPoolParty.PositionData storage positionToLiquidate,
        PerpetualPositionManagerPoolParty.GlobalPositionData storage globalPositionData,
        PerpetualPositionManagerPoolParty.PositionManagerData storage positionManagerData,
        PerpetualLiquidatablePoolParty.LiquidatableData storage liquidatableData,
        FeePayerPoolParty.FeePayerData storage feePayerData,
        CreateLiquidationCollateral memory liquidationCollateralParams
    )
        internal
        returns (
            FixedPoint.Unsigned memory lockedCollateral,
            FixedPoint.Unsigned memory liquidatedCollateral,
            FixedPoint.Unsigned memory tokensLiquidated
        )
    {
        // Scoping to get rid of a stack too deep error.
        {
            FixedPoint.Unsigned memory ratio = tokensLiquidated.div(positionToLiquidate.tokensOutstanding);

            // The actual amount of collateral that gets moved to the liquidation.
            lockedCollateral = liquidationCollateralParams.startCollateral.mul(ratio);

            // For purposes of disputes, it's actually this liquidatedCollateral value that's used. This value is net of
            // withdrawal requests.
            liquidatedCollateral = liquidationCollateralParams.startCollateralNetOfWithdrawal.mul(ratio);

            // Part of the withdrawal request is also removed. Ideally:
            // liquidatedCollateral + withdrawalAmountToRemove = lockedCollateral.
            FixedPoint.Unsigned memory withdrawalAmountToRemove = positionToLiquidate.withdrawalRequestAmount.mul(
                ratio
            );

            positionToLiquidate.reduceSponsorPosition(
                globalPositionData,
                positionManagerData,
                tokensLiquidated,
                lockedCollateral,
                withdrawalAmountToRemove,
                feePayerData,
                liquidationCollateralParams.sponsor
            );
        }

        // Add to the global liquidation collateral count.
        liquidatableData.rawLiquidationCollateral.addCollateral(
            lockedCollateral.add(liquidationCollateralParams.finalFeeBond),
            feePayerData.cumulativeFeeMultiplier
        );
    }

    function burnAndLiquidateFee(
        PerpetualPositionManagerPoolParty.PositionManagerData storage positionManagerData,
        FeePayerPoolParty.FeePayerData storage feePayerData,
        FixedPoint.Unsigned memory tokensLiquidated,
        FixedPoint.Unsigned memory finalFeeBond
    ) internal {
        // Destroy tokens
        positionManagerData.tokenCurrency.safeTransferFrom(msg.sender, address(this), tokensLiquidated.rawValue);
        positionManagerData.tokenCurrency.burn(tokensLiquidated.rawValue);

        // Pull final fee from liquidator.
        feePayerData.collateralCurrency.safeTransferFrom(msg.sender, address(this), finalFeeBond.rawValue);
    }

    // This settles a liquidation if it is in the PendingDispute state. If not, it will immediately return.
    // If the liquidation is in the PendingDispute state, but a price is not available, this will revert.
    function _settle(
        PerpetualLiquidatablePoolParty.LiquidationData storage liquidation,
        PerpetualPositionManagerPoolParty.PositionManagerData storage positionManagerData,
        PerpetualLiquidatablePoolParty.LiquidatableData storage liquidatableData,
        FeePayerPoolParty.FeePayerData storage feePayerData,
        uint256 liquidationId,
        address sponsor
    ) internal {
        // Settlement only happens when state == PendingDispute and will only happen once per liquidation.
        // If this liquidation is not ready to be settled, this method should return immediately.
        if (liquidation.state != PerpetualLiquidatablePoolParty.Status.PendingDispute) {
            return;
        }

        // Get the returned price from the oracle. If this has not yet resolved will revert.
        liquidation.settlementPrice = positionManagerData._getOraclePrice(liquidation.liquidationTime, feePayerData);

        // Find the value of the tokens in the underlying collateral.
        FixedPoint.Unsigned memory tokenRedemptionValue = liquidation.tokensOutstanding.mul(
            liquidation.settlementPrice
        );

        // The required collateral is the value of the tokens in underlying * required collateral ratio.
        FixedPoint.Unsigned memory requiredCollateral = tokenRedemptionValue.mul(
            liquidatableData.collateralRequirement
        );

        // If the position has more than the required collateral it is solvent and the dispute is valid(liquidation is invalid)
        // Note that this check uses the liquidatedCollateral not the lockedCollateral as this considers withdrawals.
        bool disputeSucceeded = liquidation.liquidatedCollateral.isGreaterThanOrEqual(requiredCollateral);
        liquidation.state = disputeSucceeded
            ? PerpetualLiquidatablePoolParty.Status.DisputeSucceeded
            : PerpetualLiquidatablePoolParty.Status.DisputeFailed;

        emit DisputeSettled(
            msg.sender,
            sponsor,
            liquidation.liquidator,
            liquidation.disputer,
            liquidationId,
            disputeSucceeded
        );
    }
}

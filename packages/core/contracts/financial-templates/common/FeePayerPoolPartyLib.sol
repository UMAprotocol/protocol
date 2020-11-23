// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "../../common/implementation/FixedPoint.sol";
import "./FeePayerPoolParty.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "../../oracle/interfaces/StoreInterface.sol";

library FeePayerPoolPartyLib {
    using FixedPoint for FixedPoint.Unsigned;
    using FeePayerPoolPartyLib for FixedPoint.Unsigned;
    using SafeERC20 for IERC20;

    /****************************************
     *                EVENTS                *
     ****************************************/

    event RegularFeesPaid(uint256 indexed regularFee, uint256 indexed lateFee);
    event FinalFeesPaid(uint256 indexed amount);

    /**
     * @notice Pays UMA DVM regular fees (as a % of the collateral pool) to the Store contract.
     * @dev These must be paid periodically for the life of the contract. If the contract has not paid its regular fee
     * in a week or more then a late penalty is applied which is sent to the caller. If the amount of
     * fees owed are greater than the pfc, then this will pay as much as possible from the available collateral.
     * An event is only fired if the fees charged are greater than 0.
     * @return totalPaid Amount of collateral that the contract paid (sum of the amount paid to the Store and caller).
     * This returns 0 and exit early if there is no pfc, fees were already paid during the current block, or the fee rate is 0.
     */
    function payRegularFees(
        FeePayerPoolParty.FeePayerData storage feePayerData,
        StoreInterface store,
        uint256 time,
        FixedPoint.Unsigned memory collateralPool
    )
        external
        returns (
            FixedPoint.Unsigned memory totalPaid,
            FixedPoint.Unsigned memory regularFee,
            FixedPoint.Unsigned memory latePenalty
        )
    {
        // Exit early if there is no collateral from which to pay fees.
        if (collateralPool.isEqual(0)) {
            return (totalPaid, regularFee, latePenalty);
        }

        // Exit early if fees were already paid during this block.
        if (feePayerData.lastPaymentTime == time) {
            return (totalPaid, regularFee, latePenalty);
        }

        (regularFee, latePenalty) = store.computeRegularFee(feePayerData.lastPaymentTime, time, collateralPool);
        feePayerData.lastPaymentTime = time;

        totalPaid = regularFee.add(latePenalty);
        if (totalPaid.isEqual(0)) {
            return (totalPaid, regularFee, latePenalty);
        }
        // If the effective fees paid as a % of the pfc is > 100%, then we need to reduce it and make the contract pay
        // as much of the fee that it can (up to 100% of its pfc). We'll reduce the late penalty first and then the
        // regular fee, which has the effect of paying the store first, followed by the caller if there is any fee remaining.
        if (totalPaid.isGreaterThan(collateralPool)) {
            FixedPoint.Unsigned memory deficit = totalPaid.sub(collateralPool);
            FixedPoint.Unsigned memory latePenaltyReduction = FixedPoint.min(latePenalty, deficit);
            latePenalty = latePenalty.sub(latePenaltyReduction);
            deficit = deficit.sub(latePenaltyReduction);
            regularFee = regularFee.sub(FixedPoint.min(regularFee, deficit));
            totalPaid = collateralPool;
        }

        emit RegularFeesPaid(regularFee.rawValue, latePenalty.rawValue);

        feePayerData.cumulativeFeeMultiplier._adjustCumulativeFeeMultiplier(totalPaid, collateralPool);

        if (regularFee.isGreaterThan(0)) {
            feePayerData.collateralCurrency.safeIncreaseAllowance(address(store), regularFee.rawValue);
            store.payOracleFeesErc20(address(feePayerData.collateralCurrency), regularFee);
        }

        if (latePenalty.isGreaterThan(0)) {
            feePayerData.collateralCurrency.safeTransfer(msg.sender, latePenalty.rawValue);
        }
        return (totalPaid, regularFee, latePenalty);
    }

    // Pays UMA Oracle final fees of `amount` in `collateralCurrency` to the Store contract. Final fee is a flat fee
    // charged for each price request. If payer is the contract, adjusts internal bookkeeping variables. If payer is not
    // the contract, pulls in `amount` of collateral currency.

    function payFinalFees(
        FeePayerPoolParty.FeePayerData storage feePayerData,
        StoreInterface store,
        FixedPoint.Unsigned memory collateralPool,
        address payer,
        FixedPoint.Unsigned memory amount
    ) external {
        if (amount.isEqual(0)) {
            return;
        }

        if (payer != address(this)) {
            // If the payer is not the contract pull the collateral from the payer.
            feePayerData.collateralCurrency.safeTransferFrom(payer, address(this), amount.rawValue);
        } else {
            // The final fee must be < available collateral or the fee will be larger than 100%.
            require(collateralPool.isGreaterThan(amount), "Final fee is more than PfC");

            feePayerData.cumulativeFeeMultiplier._adjustCumulativeFeeMultiplier(amount, collateralPool);
        }

        emit FinalFeesPaid(amount.rawValue);

        feePayerData.collateralCurrency.safeIncreaseAllowance(address(store), amount.rawValue);
        store.payOracleFeesErc20(address(feePayerData.collateralCurrency), amount);
    }

    //Call to the internal one (see _getFeeAdjustedCollateral)
    function getFeeAdjustedCollateral(
        FixedPoint.Unsigned memory rawCollateral,
        FixedPoint.Unsigned memory cumulativeFeeMultiplier
    ) external pure returns (FixedPoint.Unsigned memory collateral) {
        return rawCollateral._getFeeAdjustedCollateral(cumulativeFeeMultiplier);
    }

    //Call to the internal one (see _convertToRawCollateral)
    function convertToRawCollateral(
        FixedPoint.Unsigned memory collateral,
        FixedPoint.Unsigned memory cumulativeFeeMultiplier
    ) external pure returns (FixedPoint.Unsigned memory rawCollateral) {
        return collateral._convertToRawCollateral(cumulativeFeeMultiplier);
    }

    // Decrease rawCollateral by a fee-adjusted collateralToRemove amount. Fee adjustment scales up collateralToRemove
    // by dividing it by cumulativeFeeMultiplier. There is potential for this quotient to be floored, therefore
    // rawCollateral is decreased by less than expected. Because this method is usually called in conjunction with an
    // actual removal of collateral from this contract, return the fee-adjusted amount that the rawCollateral is
    // decreased by so that the caller can minimize error between collateral removed and rawCollateral debited.
    function removeCollateral(
        FixedPoint.Unsigned storage rawCollateral,
        FixedPoint.Unsigned memory collateralToRemove,
        FixedPoint.Unsigned memory cumulativeFeeMultiplier
    ) external returns (FixedPoint.Unsigned memory removedCollateral) {
        FixedPoint.Unsigned memory initialBalance = rawCollateral._getFeeAdjustedCollateral(cumulativeFeeMultiplier);
        FixedPoint.Unsigned memory adjustedCollateral =
            collateralToRemove._convertToRawCollateral(cumulativeFeeMultiplier);
        rawCollateral.rawValue = rawCollateral.sub(adjustedCollateral).rawValue;
        removedCollateral = initialBalance.sub(rawCollateral._getFeeAdjustedCollateral(cumulativeFeeMultiplier));
    }

    // Increase rawCollateral by a fee-adjusted collateralToAdd amount. Fee adjustment scales up collateralToAdd
    // by dividing it by cumulativeFeeMultiplier. There is potential for this quotient to be floored, therefore
    // rawCollateral is increased by less than expected. Because this method is usually called in conjunction with an
    // actual addition of collateral to this contract, return the fee-adjusted amount that the rawCollateral is
    // increased by so that the caller can minimize error between collateral added and rawCollateral credited.
    // NOTE: This return value exists only for the sake of symmetry with _removeCollateral. We don't actually use it
    // because we are OK if more collateral is stored in the contract than is represented by rawTotalPositionCollateral.
    function addCollateral(
        FixedPoint.Unsigned storage rawCollateral,
        FixedPoint.Unsigned memory collateralToAdd,
        FixedPoint.Unsigned memory cumulativeFeeMultiplier
    ) external returns (FixedPoint.Unsigned memory addedCollateral) {
        FixedPoint.Unsigned memory initialBalance = rawCollateral._getFeeAdjustedCollateral(cumulativeFeeMultiplier);
        FixedPoint.Unsigned memory adjustedCollateral =
            collateralToAdd._convertToRawCollateral(cumulativeFeeMultiplier);
        rawCollateral.rawValue = rawCollateral.add(adjustedCollateral).rawValue;
        addedCollateral = rawCollateral._getFeeAdjustedCollateral(cumulativeFeeMultiplier).sub(initialBalance);
    }

    // Scale the cumulativeFeeMultiplier by the ratio of fees paid to the current available collateral.
    function _adjustCumulativeFeeMultiplier(
        FixedPoint.Unsigned storage cumulativeFeeMultiplier,
        FixedPoint.Unsigned memory amount,
        FixedPoint.Unsigned memory currentPfc
    ) internal {
        FixedPoint.Unsigned memory effectiveFee = amount.divCeil(currentPfc);
        cumulativeFeeMultiplier.rawValue = cumulativeFeeMultiplier
            .mul(FixedPoint.fromUnscaledUint(1).sub(effectiveFee))
            .rawValue;
    }

    // Returns the user's collateral minus any fees that have been subtracted since it was originally
    // deposited into the contract. Note: if the contract has paid fees since it was deployed, the raw
    // value should be larger than the returned value.
    function _getFeeAdjustedCollateral(
        FixedPoint.Unsigned memory rawCollateral,
        FixedPoint.Unsigned memory cumulativeFeeMultiplier
    ) internal pure returns (FixedPoint.Unsigned memory collateral) {
        return rawCollateral.mul(cumulativeFeeMultiplier);
    }

    // Converts a user-readable collateral value into a raw value that accounts for already-assessed fees. If any fees
    // have been taken from this contract in the past, then the raw value will be larger than the user-readable value.
    function _convertToRawCollateral(
        FixedPoint.Unsigned memory collateral,
        FixedPoint.Unsigned memory cumulativeFeeMultiplier
    ) internal pure returns (FixedPoint.Unsigned memory rawCollateral) {
        return collateral.div(cumulativeFeeMultiplier);
    }
}

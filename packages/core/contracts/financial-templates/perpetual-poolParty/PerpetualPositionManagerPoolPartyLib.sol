// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "../../common/interfaces/IERC20Standard.sol";
import "../../common/implementation/FixedPoint.sol";
import "../../common/interfaces/MintableBurnableIERC20.sol";
import "../../oracle/interfaces/OracleInterface.sol";
import "../../oracle/implementation/Constants.sol";
import "./PerpetualPositionManagerPoolParty.sol";
import "../common/FeePayerPoolPartyLib.sol";

library PerpetualPositionManagerPoolPartyLib {
    using SafeMath for uint256;
    using FixedPoint for FixedPoint.Unsigned;
    using SafeERC20 for IERC20;
    using SafeERC20 for MintableBurnableIERC20;
    using PerpetualPositionManagerPoolPartyLib for PerpetualPositionManagerPoolParty.PositionData;
    using PerpetualPositionManagerPoolPartyLib for PerpetualPositionManagerPoolParty.PositionManagerData;
    using PerpetualPositionManagerPoolPartyLib for FeePayerPoolParty.FeePayerData;
    using PerpetualPositionManagerPoolPartyLib for FixedPoint.Unsigned;
    using FeePayerPoolPartyLib for FixedPoint.Unsigned;

    /****************************************
     *                EVENTS                *
     ****************************************/

    event Deposit(address indexed sponsor, uint256 indexed collateralAmount);
    event Withdrawal(address indexed sponsor, uint256 indexed collateralAmount);
    event RequestWithdrawal(address indexed sponsor, uint256 indexed collateralAmount);
    event RequestWithdrawalExecuted(address indexed sponsor, uint256 indexed collateralAmount);
    event RequestWithdrawalCanceled(address indexed sponsor, uint256 indexed collateralAmount);
    event PositionCreated(address indexed sponsor, uint256 indexed collateralAmount, uint256 indexed tokenAmount);
    event NewSponsor(address indexed sponsor);
    event EndedSponsorPosition(address indexed sponsor);
    event Redeem(address indexed sponsor, uint256 indexed collateralAmount, uint256 indexed tokenAmount);
    event Repay(address indexed sponsor, uint256 indexed numTokensRepaid, uint256 indexed newTokenCount);
    event EmergencyShutdown(address indexed caller, uint256 shutdownTimestamp);
    event SettleEmergencyShutdown(
        address indexed caller,
        uint256 indexed collateralReturned,
        uint256 indexed tokensBurned
    );

    function depositTo(
        PerpetualPositionManagerPoolParty.PositionData storage positionData,
        PerpetualPositionManagerPoolParty.GlobalPositionData storage globalPositionData,
        FixedPoint.Unsigned memory collateralAmount,
        FeePayerPoolParty.FeePayerData storage feePayerData,
        address sponsor
    ) external {
        require(collateralAmount.isGreaterThan(0), "Invalid collateral amount");
        // Increase the position and global collateral balance by collateral amount.
        positionData._incrementCollateralBalances(globalPositionData, collateralAmount, feePayerData);

        emit Deposit(sponsor, collateralAmount.rawValue);

        // Move collateral currency from sender to contract.
        feePayerData.collateralCurrency.safeTransferFrom(msg.sender, address(this), collateralAmount.rawValue);
    }

    function withdraw(
        PerpetualPositionManagerPoolParty.PositionData storage positionData,
        PerpetualPositionManagerPoolParty.GlobalPositionData storage globalPositionData,
        FixedPoint.Unsigned memory collateralAmount,
        FeePayerPoolParty.FeePayerData storage feePayerData
    ) external returns (FixedPoint.Unsigned memory amountWithdrawn) {
        require(collateralAmount.isGreaterThan(0), "Invalid collateral amount");
        // Decrement the sponsor's collateral and global collateral amounts. Check the GCR between decrement to ensure
        // position remains above the GCR within the witdrawl. If this is not the case the caller must submit a request.
        amountWithdrawn = _decrementCollateralBalancesCheckGCR(
            positionData,
            globalPositionData,
            collateralAmount,
            feePayerData
        );

        emit Withdrawal(msg.sender, amountWithdrawn.rawValue);

        // Move collateral currency from contract to sender.
        // Note: that we move the amount of collateral that is decreased from rawCollateral (inclusive of fees)
        // instead of the user requested amount. This eliminates precision loss that could occur
        // where the user withdraws more collateral than rawCollateral is decremented by.
        feePayerData.collateralCurrency.safeTransfer(msg.sender, amountWithdrawn.rawValue);
    }

    function requestWithdrawal(
        PerpetualPositionManagerPoolParty.PositionData storage positionData,
        PerpetualPositionManagerPoolParty.PositionManagerData storage positionManagerData,
        FixedPoint.Unsigned memory collateralAmount,
        uint256 actualTime,
        FeePayerPoolParty.FeePayerData storage feePayerData
    ) external {
        require(
            collateralAmount.isGreaterThan(0) &&
                collateralAmount.isLessThanOrEqual(
                    positionData.rawCollateral.getFeeAdjustedCollateral(feePayerData.cumulativeFeeMultiplier)
                ),
            "Invalid collateral amount"
        );

        // Update the position object for the user.
        positionData.withdrawalRequestPassTimestamp = actualTime.add(positionManagerData.withdrawalLiveness);
        positionData.withdrawalRequestAmount = collateralAmount;

        emit RequestWithdrawal(msg.sender, collateralAmount.rawValue);
    }

    function withdrawPassedRequest(
        PerpetualPositionManagerPoolParty.PositionData storage positionData,
        PerpetualPositionManagerPoolParty.GlobalPositionData storage globalPositionData,
        uint256 actualTime,
        FeePayerPoolParty.FeePayerData storage feePayerData
    ) external returns (FixedPoint.Unsigned memory amountWithdrawn) {
        require(
            positionData.withdrawalRequestPassTimestamp != 0 &&
                positionData.withdrawalRequestPassTimestamp <= actualTime,
            "Invalid withdraw request"
        );

        // If withdrawal request amount is > position collateral, then withdraw the full collateral amount.
        // This situation is possible due to fees charged since the withdrawal was originally requested.
        FixedPoint.Unsigned memory amountToWithdraw = positionData.withdrawalRequestAmount;
        if (
            positionData.withdrawalRequestAmount.isGreaterThan(
                positionData.rawCollateral.getFeeAdjustedCollateral(feePayerData.cumulativeFeeMultiplier)
            )
        ) {
            amountToWithdraw = positionData.rawCollateral.getFeeAdjustedCollateral(
                feePayerData.cumulativeFeeMultiplier
            );
        }

        // Decrement the sponsor's collateral and global collateral amounts.
        amountWithdrawn = positionData._decrementCollateralBalances(globalPositionData, amountToWithdraw, feePayerData);

        // Reset withdrawal request by setting withdrawal amount and withdrawal timestamp to 0.
        positionData._resetWithdrawalRequest();

        // Transfer approved withdrawal amount from the contract to the caller.
        feePayerData.collateralCurrency.safeTransfer(msg.sender, amountWithdrawn.rawValue);

        emit RequestWithdrawalExecuted(msg.sender, amountWithdrawn.rawValue);
    }

    function cancelWithdrawal(PerpetualPositionManagerPoolParty.PositionData storage positionData) external {
        require(positionData.withdrawalRequestPassTimestamp != 0, "No pending withdrawal");

        emit RequestWithdrawalCanceled(msg.sender, positionData.withdrawalRequestAmount.rawValue);

        // Reset withdrawal request by setting withdrawal amount and withdrawal timestamp to 0.
        _resetWithdrawalRequest(positionData);
    }

    function create(
        PerpetualPositionManagerPoolParty.PositionData storage positionData,
        PerpetualPositionManagerPoolParty.GlobalPositionData storage globalPositionData,
        PerpetualPositionManagerPoolParty.PositionManagerData storage positionManagerData,
        FixedPoint.Unsigned memory collateralAmount,
        FixedPoint.Unsigned memory numTokens,
        FeePayerPoolParty.FeePayerData storage feePayerData
    ) external {
        // Either the new create ratio or the resultant position CR must be above the current GCR.
        require(
            (_checkCollateralization(
                globalPositionData,
                positionData.rawCollateral.getFeeAdjustedCollateral(feePayerData.cumulativeFeeMultiplier).add(
                    collateralAmount
                ),
                positionData.tokensOutstanding.add(numTokens),
                feePayerData
            ) || _checkCollateralization(globalPositionData, collateralAmount, numTokens, feePayerData)),
            "Insufficient collateral"
        );

        require(positionData.withdrawalRequestPassTimestamp == 0, "Pending withdrawal");
        if (positionData.tokensOutstanding.isEqual(0)) {
            require(
                numTokens.isGreaterThanOrEqual(positionManagerData.minSponsorTokens),
                "Below minimum sponsor position"
            );
            emit NewSponsor(msg.sender);
        }

        // Increase the position and global collateral balance by collateral amount.
        _incrementCollateralBalances(positionData, globalPositionData, collateralAmount, feePayerData);

        // Add the number of tokens created to the position's outstanding tokens.
        positionData.tokensOutstanding = positionData.tokensOutstanding.add(numTokens);

        globalPositionData.totalTokensOutstanding = globalPositionData.totalTokensOutstanding.add(numTokens);

        emit PositionCreated(msg.sender, collateralAmount.rawValue, numTokens.rawValue);

        // Transfer tokens into the contract from caller and mint corresponding synthetic tokens to the caller's address.
        feePayerData.collateralCurrency.safeTransferFrom(msg.sender, address(this), collateralAmount.rawValue);
        require(
            positionManagerData.tokenCurrency.mint(msg.sender, numTokens.rawValue),
            "Minting synthetic tokens failed"
        );
    }

    function redeeem(
        PerpetualPositionManagerPoolParty.PositionData storage positionData,
        PerpetualPositionManagerPoolParty.GlobalPositionData storage globalPositionData,
        PerpetualPositionManagerPoolParty.PositionManagerData storage positionManagerData,
        FixedPoint.Unsigned memory numTokens,
        FeePayerPoolParty.FeePayerData storage feePayerData,
        address sponsor
    ) external returns (FixedPoint.Unsigned memory amountWithdrawn) {
        require(numTokens.isLessThanOrEqual(positionData.tokensOutstanding), "Invalid token amount");

        FixedPoint.Unsigned memory fractionRedeemed = numTokens.div(positionData.tokensOutstanding);
        FixedPoint.Unsigned memory collateralRedeemed =
            fractionRedeemed.mul(
                positionData.rawCollateral.getFeeAdjustedCollateral(feePayerData.cumulativeFeeMultiplier)
            );

        // If redemption returns all tokens the sponsor has then we can delete their position. Else, downsize.
        if (positionData.tokensOutstanding.isEqual(numTokens)) {
            amountWithdrawn = positionData._deleteSponsorPosition(globalPositionData, feePayerData, sponsor);
        } else {
            // Decrement the sponsor's collateral and global collateral amounts.
            amountWithdrawn = positionData._decrementCollateralBalances(
                globalPositionData,
                collateralRedeemed,
                feePayerData
            );

            // Decrease the sponsors position tokens size. Ensure it is above the min sponsor size.
            FixedPoint.Unsigned memory newTokenCount = positionData.tokensOutstanding.sub(numTokens);
            require(
                newTokenCount.isGreaterThanOrEqual(positionManagerData.minSponsorTokens),
                "Below minimum sponsor position"
            );
            positionData.tokensOutstanding = newTokenCount;

            // Update the totalTokensOutstanding after redemption.
            globalPositionData.totalTokensOutstanding = globalPositionData.totalTokensOutstanding.sub(numTokens);
        }

        emit Redeem(msg.sender, amountWithdrawn.rawValue, numTokens.rawValue);

        // Transfer collateral from contract to caller and burn callers synthetic tokens.
        feePayerData.collateralCurrency.safeTransfer(msg.sender, amountWithdrawn.rawValue);
        positionManagerData.tokenCurrency.safeTransferFrom(msg.sender, address(this), numTokens.rawValue);
        positionManagerData.tokenCurrency.burn(numTokens.rawValue);
    }

    function repay(
        PerpetualPositionManagerPoolParty.PositionData storage positionData,
        PerpetualPositionManagerPoolParty.GlobalPositionData storage globalPositionData,
        PerpetualPositionManagerPoolParty.PositionManagerData storage positionManagerData,
        FixedPoint.Unsigned memory numTokens
    ) external {
        require(numTokens.isLessThanOrEqual(positionData.tokensOutstanding), "Invalid token amount");

        // Decrease the sponsors position tokens size. Ensure it is above the min sponsor size.
        FixedPoint.Unsigned memory newTokenCount = positionData.tokensOutstanding.sub(numTokens);
        require(
            newTokenCount.isGreaterThanOrEqual(positionManagerData.minSponsorTokens),
            "Below minimum sponsor position"
        );
        positionData.tokensOutstanding = newTokenCount;

        // Update the totalTokensOutstanding after redemption.
        globalPositionData.totalTokensOutstanding = globalPositionData.totalTokensOutstanding.sub(numTokens);

        emit Repay(msg.sender, numTokens.rawValue, newTokenCount.rawValue);

        // Transfer the tokens back from the sponsor and burn them.
        positionManagerData.tokenCurrency.safeTransferFrom(msg.sender, address(this), numTokens.rawValue);
        positionManagerData.tokenCurrency.burn(numTokens.rawValue);
    }

    function settleEmergencyShutdown(
        PerpetualPositionManagerPoolParty.PositionData storage positionData,
        PerpetualPositionManagerPoolParty.GlobalPositionData storage globalPositionData,
        PerpetualPositionManagerPoolParty.PositionManagerData storage positionManagerData,
        FeePayerPoolParty.FeePayerData storage feePayerData
    ) external returns (FixedPoint.Unsigned memory amountWithdrawn) {
        if (positionManagerData.emergencyShutdownPrice.isEqual(FixedPoint.fromUnscaledUint(0))) {
            FixedPoint.Unsigned memory oraclePrice = positionManagerData._getOracleEmergencyShutdownPrice(feePayerData);
            positionManagerData.emergencyShutdownPrice = oraclePrice._decimalsScalingFactor(feePayerData);
        }

        // Get caller's tokens balance and calculate amount of underlying entitled to them.
        FixedPoint.Unsigned memory tokensToRedeem =
            FixedPoint.Unsigned(positionManagerData.tokenCurrency.balanceOf(msg.sender));

        FixedPoint.Unsigned memory totalRedeemableCollateral =
            tokensToRedeem.mul(positionManagerData.emergencyShutdownPrice);

        // If the caller is a sponsor with outstanding collateral they are also entitled to their excess collateral after their debt.

        if (
            positionData.rawCollateral.getFeeAdjustedCollateral(feePayerData.cumulativeFeeMultiplier).isGreaterThan(0)
        ) {
            // Calculate the underlying entitled to a token sponsor. This is collateral - debt in underlying with
            // the funding rate applied to the outstanding token debt.

            FixedPoint.Unsigned memory tokenDebtValueInCollateral =
                positionData.tokensOutstanding.mul(positionManagerData.emergencyShutdownPrice);
            FixedPoint.Unsigned memory positionCollateral =
                positionData.rawCollateral.getFeeAdjustedCollateral(feePayerData.cumulativeFeeMultiplier);

            // If the debt is greater than the remaining collateral, they cannot redeem anything.
            FixedPoint.Unsigned memory positionRedeemableCollateral =
                tokenDebtValueInCollateral.isLessThan(positionCollateral)
                    ? positionCollateral.sub(tokenDebtValueInCollateral)
                    : FixedPoint.Unsigned(0);

            // Add the number of redeemable tokens for the sponsor to their total redeemable collateral.
            totalRedeemableCollateral = totalRedeemableCollateral.add(positionRedeemableCollateral);

            PerpetualPositionManagerPoolParty(address(this)).deleteSponsorPosition(msg.sender);
            emit EndedSponsorPosition(msg.sender);
        }

        // Take the min of the remaining collateral and the collateral "owed". If the contract is undercapitalized,
        // the caller will get as much collateral as the contract can pay out.
        FixedPoint.Unsigned memory payout =
            FixedPoint.min(
                globalPositionData.rawTotalPositionCollateral.getFeeAdjustedCollateral(
                    feePayerData.cumulativeFeeMultiplier
                ),
                totalRedeemableCollateral
            );

        // Decrement total contract collateral and outstanding debt.
        amountWithdrawn = globalPositionData.rawTotalPositionCollateral.removeCollateral(
            payout,
            feePayerData.cumulativeFeeMultiplier
        );
        globalPositionData.totalTokensOutstanding = globalPositionData.totalTokensOutstanding.sub(tokensToRedeem);

        emit SettleEmergencyShutdown(msg.sender, amountWithdrawn.rawValue, tokensToRedeem.rawValue);

        // Transfer tokens & collateral and burn the redeemed tokens.
        feePayerData.collateralCurrency.safeTransfer(msg.sender, amountWithdrawn.rawValue);
        positionManagerData.tokenCurrency.safeTransferFrom(msg.sender, address(this), tokensToRedeem.rawValue);
        positionManagerData.tokenCurrency.burn(tokensToRedeem.rawValue);
    }

    function trimExcess(
        PerpetualPositionManagerPoolParty.PositionManagerData storage positionManagerData,
        IERC20 token,
        FixedPoint.Unsigned memory pfcAmount,
        FeePayerPoolParty.FeePayerData storage feePayerData
    ) external returns (FixedPoint.Unsigned memory amount) {
        FixedPoint.Unsigned memory balance = FixedPoint.Unsigned(token.balanceOf(address(this)));
        if (address(token) == address(feePayerData.collateralCurrency)) {
            // If it is the collateral currency, send only the amount that the contract is not tracking.
            // Note: this could be due to rounding error or balance-changing tokens, like aTokens.
            amount = balance.sub(pfcAmount);
        } else {
            // If it's not the collateral currency, send the entire balance.
            amount = balance;
        }
        token.safeTransfer(positionManagerData.excessTokenBeneficiary, amount.rawValue);
    }

    function requestOraclePrice(
        PerpetualPositionManagerPoolParty.PositionManagerData storage positionManagerData,
        uint256 requestedTime,
        FeePayerPoolParty.FeePayerData storage feePayerData
    ) external {
        feePayerData._getOracle().requestPrice(positionManagerData.priceIdentifier, requestedTime);
    }

    // Reduces a sponsor's position and global counters by the specified parameters. Handles deleting the entire
    // position if the entire position is being removed. Does not make any external transfers.
    function reduceSponsorPosition(
        PerpetualPositionManagerPoolParty.PositionData storage positionData,
        PerpetualPositionManagerPoolParty.GlobalPositionData storage globalPositionData,
        PerpetualPositionManagerPoolParty.PositionManagerData storage positionManagerData,
        FixedPoint.Unsigned memory tokensToRemove,
        FixedPoint.Unsigned memory collateralToRemove,
        FixedPoint.Unsigned memory withdrawalAmountToRemove,
        FeePayerPoolParty.FeePayerData storage feePayerData,
        address sponsor
    ) external {
        // If the entire position is being removed, delete it instead.
        if (
            tokensToRemove.isEqual(positionData.tokensOutstanding) &&
            positionData.rawCollateral.getFeeAdjustedCollateral(feePayerData.cumulativeFeeMultiplier).isEqual(
                collateralToRemove
            )
        ) {
            positionData._deleteSponsorPosition(globalPositionData, feePayerData, sponsor);
            return;
        }

        // Decrement the sponsor's collateral and global collateral amounts.
        positionData._decrementCollateralBalances(globalPositionData, collateralToRemove, feePayerData);

        // Ensure that the sponsor will meet the min position size after the reduction.
        positionData.tokensOutstanding = positionData.tokensOutstanding.sub(tokensToRemove);
        require(
            positionData.tokensOutstanding.isGreaterThanOrEqual(positionManagerData.minSponsorTokens),
            "Below minimum sponsor position"
        );

        // Decrement the position's withdrawal amount.
        positionData.withdrawalRequestAmount = positionData.withdrawalRequestAmount.sub(withdrawalAmountToRemove);

        // Decrement the total outstanding tokens in the overall contract.
        globalPositionData.totalTokensOutstanding = globalPositionData.totalTokensOutstanding.sub(tokensToRemove);
    }

    //Call to the internal one (see _getOraclePrice)
    function getOraclePrice(
        PerpetualPositionManagerPoolParty.PositionManagerData storage positionManagerData,
        uint256 requestedTime,
        FeePayerPoolParty.FeePayerData storage feePayerData
    ) external view returns (FixedPoint.Unsigned memory price) {
        return _getOraclePrice(positionManagerData, requestedTime, feePayerData);
    }

    //Call to the internal one (see _decimalsScalingFactor)
    function decimalsScalingFactor(
        FixedPoint.Unsigned memory oraclePrice,
        FeePayerPoolParty.FeePayerData storage feePayerData
    ) external view returns (FixedPoint.Unsigned memory scaledPrice) {
        return _decimalsScalingFactor(oraclePrice, feePayerData);
    }

    function _incrementCollateralBalances(
        PerpetualPositionManagerPoolParty.PositionData storage positionData,
        PerpetualPositionManagerPoolParty.GlobalPositionData storage globalPositionData,
        FixedPoint.Unsigned memory collateralAmount,
        FeePayerPoolParty.FeePayerData memory feePayerData
    ) internal returns (FixedPoint.Unsigned memory) {
        positionData.rawCollateral.addCollateral(collateralAmount, feePayerData.cumulativeFeeMultiplier);
        return
            globalPositionData.rawTotalPositionCollateral.addCollateral(
                collateralAmount,
                feePayerData.cumulativeFeeMultiplier
            );
    }

    // Ensure individual and global consistency when decrementing collateral balances. Returns the change to the
    // position. We elect to return the amount that the global collateral is decreased by, rather than the individual
    // position's collateral, because we need to maintain the invariant that the global collateral is always
    // <= the collateral owned by the contract to avoid reverts on withdrawals. The amount returned = amount withdrawn.
    function _decrementCollateralBalances(
        PerpetualPositionManagerPoolParty.PositionData storage positionData,
        PerpetualPositionManagerPoolParty.GlobalPositionData storage globalPositionData,
        FixedPoint.Unsigned memory collateralAmount,
        FeePayerPoolParty.FeePayerData storage feePayerData
    ) internal returns (FixedPoint.Unsigned memory) {
        positionData.rawCollateral.removeCollateral(collateralAmount, feePayerData.cumulativeFeeMultiplier);
        return
            globalPositionData.rawTotalPositionCollateral.removeCollateral(
                collateralAmount,
                feePayerData.cumulativeFeeMultiplier
            );
    }

    function _decrementCollateralBalancesCheckGCR(
        PerpetualPositionManagerPoolParty.PositionData storage positionData,
        PerpetualPositionManagerPoolParty.GlobalPositionData storage globalPositionData,
        FixedPoint.Unsigned memory collateralAmount,
        FeePayerPoolParty.FeePayerData storage feePayerData
    ) internal returns (FixedPoint.Unsigned memory) {
        positionData.rawCollateral.removeCollateral(collateralAmount, feePayerData.cumulativeFeeMultiplier);
        require(_checkPositionCollateralization(positionData, globalPositionData, feePayerData), "CR below GCR");
        return
            globalPositionData.rawTotalPositionCollateral.removeCollateral(
                collateralAmount,
                feePayerData.cumulativeFeeMultiplier
            );
    }

    function _checkPositionCollateralization(
        PerpetualPositionManagerPoolParty.PositionData storage positionData,
        PerpetualPositionManagerPoolParty.GlobalPositionData storage globalPositionData,
        FeePayerPoolParty.FeePayerData storage feePayerData
    ) internal view returns (bool) {
        return
            _checkCollateralization(
                globalPositionData,
                positionData.rawCollateral.getFeeAdjustedCollateral(feePayerData.cumulativeFeeMultiplier),
                positionData.tokensOutstanding,
                feePayerData
            );
    }

    // Checks whether the provided `collateral` and `numTokens` have a collateralization ratio above the global
    // collateralization ratio.
    function _checkCollateralization(
        PerpetualPositionManagerPoolParty.GlobalPositionData storage globalPositionData,
        FixedPoint.Unsigned memory collateral,
        FixedPoint.Unsigned memory numTokens,
        FeePayerPoolParty.FeePayerData storage feePayerData
    ) internal view returns (bool) {
        FixedPoint.Unsigned memory global =
            _getCollateralizationRatio(
                globalPositionData.rawTotalPositionCollateral.getFeeAdjustedCollateral(
                    feePayerData.cumulativeFeeMultiplier
                ),
                globalPositionData.totalTokensOutstanding
            );
        FixedPoint.Unsigned memory thisChange = _getCollateralizationRatio(collateral, numTokens);
        return !global.isGreaterThan(thisChange);
    }

    function _getCollateralizationRatio(FixedPoint.Unsigned memory collateral, FixedPoint.Unsigned memory numTokens)
        internal
        pure
        returns (FixedPoint.Unsigned memory ratio)
    {
        return numTokens.isLessThanOrEqual(0) ? FixedPoint.fromUnscaledUint(0) : collateral.div(numTokens);
    }

    // Reset withdrawal request by setting the withdrawal request and withdrawal timestamp to 0.
    function _resetWithdrawalRequest(PerpetualPositionManagerPoolParty.PositionData storage positionData) internal {
        positionData.withdrawalRequestAmount = FixedPoint.fromUnscaledUint(0);
        positionData.withdrawalRequestPassTimestamp = 0;
    }

    // Deletes a sponsor's position and updates global counters. Does not make any external transfers.
    function _deleteSponsorPosition(
        PerpetualPositionManagerPoolParty.PositionData storage positionToLiquidate,
        PerpetualPositionManagerPoolParty.GlobalPositionData storage globalPositionData,
        FeePayerPoolParty.FeePayerData storage feePayerData,
        address sponsor
    ) internal returns (FixedPoint.Unsigned memory) {
        FixedPoint.Unsigned memory startingGlobalCollateral =
            globalPositionData.rawTotalPositionCollateral.getFeeAdjustedCollateral(
                feePayerData.cumulativeFeeMultiplier
            );

        // Remove the collateral and outstanding from the overall total position.
        globalPositionData.rawTotalPositionCollateral = globalPositionData.rawTotalPositionCollateral.sub(
            positionToLiquidate.rawCollateral
        );
        globalPositionData.totalTokensOutstanding = globalPositionData.totalTokensOutstanding.sub(
            positionToLiquidate.tokensOutstanding
        );

        PerpetualPositionManagerPoolParty(address(this)).deleteSponsorPosition(sponsor);

        emit EndedSponsorPosition(sponsor);

        // Return fee-adjusted amount of collateral deleted from position.
        return
            startingGlobalCollateral.sub(
                globalPositionData.rawTotalPositionCollateral.getFeeAdjustedCollateral(
                    feePayerData.cumulativeFeeMultiplier
                )
            );
    }

    // Fetches a resolved Oracle price from the Oracle. Reverts if the Oracle hasn't resolved for this request.
    function _getOracleEmergencyShutdownPrice(
        PerpetualPositionManagerPoolParty.PositionManagerData storage positionManagerData,
        FeePayerPoolParty.FeePayerData storage feePayerData
    ) internal view returns (FixedPoint.Unsigned memory) {
        require(positionManagerData.emergencyShutdownTimestamp != 0, "No shutdown timestamp set");
        return positionManagerData._getOraclePrice(positionManagerData.emergencyShutdownTimestamp, feePayerData);
    }

    // Fetches a resolved Oracle price from the Oracle. Reverts if the Oracle hasn't resolved for this request.
    function _getOraclePrice(
        PerpetualPositionManagerPoolParty.PositionManagerData storage positionManagerData,
        uint256 requestedTime,
        FeePayerPoolParty.FeePayerData storage feePayerData
    ) internal view returns (FixedPoint.Unsigned memory price) {
        // Create an instance of the oracle and get the price. If the price is not resolved revert.
        OracleInterface oracle = feePayerData._getOracle();
        require(oracle.hasPrice(positionManagerData.priceIdentifier, requestedTime), "Unresolved oracle price");
        int256 oraclePrice = oracle.getPrice(positionManagerData.priceIdentifier, requestedTime);

        // For now we don't want to deal with negative prices in positions.
        if (oraclePrice < 0) {
            oraclePrice = 0;
        }
        return FixedPoint.Unsigned(uint256(oraclePrice));
    }

    function _getOracle(FeePayerPoolParty.FeePayerData storage feePayerData) internal view returns (OracleInterface) {
        return OracleInterface(feePayerData.finder.getImplementationAddress(OracleInterfaces.Oracle));
    }

    //Reduce orcale price according to the decimals of the collateral
    function _decimalsScalingFactor(
        FixedPoint.Unsigned memory oraclePrice,
        FeePayerPoolParty.FeePayerData storage feePayerData
    ) internal view returns (FixedPoint.Unsigned memory scaledPrice) {
        uint8 collateralDecimalsNumber = IERC20Standard(address(feePayerData.collateralCurrency)).decimals();
        scaledPrice = oraclePrice.div((10**(uint256(18)).sub(collateralDecimalsNumber)));
    }
}

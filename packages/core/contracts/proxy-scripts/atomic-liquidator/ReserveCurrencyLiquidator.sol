// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "@uniswap/lib/contracts/libraries/TransferHelper.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router01.sol";

import "../../common/implementation/FixedPoint.sol";

/**
 * @title ReserveCurrencyLiquidator
 * @notice Helper contract to enable a liquidator to hold one reserver currency and liquidate against any number of
 * financial contracts. Is assumed to be called by a DSProxy which holds reserve currency.
 */

contract ReserveCurrencyLiquidator {
    using SafeMath for uint256;
    using FixedPoint for FixedPoint.Unsigned;

    /**
     * @notice Swaps required amount of reserve currency to collateral currency which is then used to mint tokens to
     * liquidate a position within one transaction.
     * @dev After the liquidation is done the DSProxy that called this method will have an open position AND pending
     * liquidation within the financial contract. The bot using the DSProxy should withdraw the liquidation once it has
     * passed liveness. At this point the position can be manually unwound.
     * @dev Any synthetics & collateral that the DSProxy already has are considered in the amount swapped and minted.
     * These existing tokens will be used first before any swaps or mints are done.
     * @dev If there is a token shortfall (either from not enough reserve to buy sufficient collateral or not enough
     * collateral to begins with or due to slippage) the script will liquidate as much as possible given the reserves.
     * @param uniswapRouter address of the uniswap router used to facilitate trades.
     * @param financialContract address of the financial contract on which the liquidation is occurring.
     * @param reserveCurrency address of the token to swap for collateral. THis is the common currency held by the DSProxy.
     * @param liquidatedSponsor address of the sponsor to be liquidated.
     * @param maxSlippage max slip the trade on uniswap will accept before reverting.
     * @param minCollateralPerTokenLiquidated abort the liquidation if the position's collateral per token is below this value.
     * @param maxCollateralPerTokenLiquidated abort the liquidation if the position's collateral per token exceeds this value.
     * @param maxTokensToLiquidate max number of tokens to liquidate. For a full liquidation this is the full position debt.
     * @param deadline abort the trade and liquidation if the transaction is mined after this timestamp.
     **/
    function swapMintLiquidate(
        address uniswapRouter,
        address financialContract,
        address reserveCurrency,
        address liquidatedSponsor,
        FixedPoint.Unsigned calldata minCollateralPerTokenLiquidated,
        FixedPoint.Unsigned calldata maxCollateralPerTokenLiquidated,
        FixedPoint.Unsigned memory maxTokensToLiquidate,
        uint256 maxSlippage,
        uint256 deadline
    ) public {
        IFinancialContract fc = IFinancialContract(financialContract);

        // 1. Calculate the token shortfall. This is the synthetics to liquidate minus any synthetics the DSProxy already
        // has. If this number is negative(balance large than synthetics to liquidate) the return 0 (no shortfall).
        FixedPoint.Unsigned memory tokenShortfall = subOrZero(maxTokensToLiquidate, getSyntheticBalance(fc));

        // 2. Calculate how much collateral is needed to make up the token shortfall from minting new synthetics.
        FixedPoint.Unsigned memory gcr = fc.pfc().divCeil(fc.totalTokensOutstanding());
        FixedPoint.Unsigned memory collateralToMintShortfall = tokenShortfall.mulCeil(gcr);

        // 3. Calculate the total collateral required. This considers the final fee for the given collateral type + any
        // collateral needed to mint the token short fall.

        FixedPoint.Unsigned memory totalCollateralRequired = getFinalFee(fc).add(collateralToMintShortfall);

        // 4.a. Calculate how much collateral needs to be purchased. If the DSProxy already has some collateral then this
        // will factor this in. If the DSProxy has more collateral than the total amount required the purchased = 0.
        uint256 collateralToBePurchased = subOrZero(totalCollateralRequired, getCollateralBalance(fc)).rawValue;

        // 4.b. If there is some collateral to be purchased, execute a trade on uniswap to meet the shortfall.
        // Note the path assumes a direct route from the reserve currency to the collateral currency.
        // Note the maxInputAmount is computed by taking the 1000000 wei trade as the spot price from the router,
        // multiplied by collateral to be purchased to arrive at a "zero slippage input amount". This would be the amount of
        // required input to buy the amountOut, assuming zero slippage. This is then scalded by maxSlippage & swap fees
        // to find the amountInMax that factors in the max tolerable exchange slippage. The maxSlippage is divided by two
        // as slippage in an AMM is constituted by the inputToken going up and the outputToken going down in proportion.
        // the +1e18 is used to offset the slippage percentage provided. i.e a 5% will be input at 0.05e18, offset by 1e18
        // to bring it up to 1.05e18. the *997 and *1000 in the numerator and denominator respectively are for uniswap fees.
        if (collateralToBePurchased > 0 && reserveCurrency != fc.collateralCurrency()) {
            IUniswapV2Router01 router = IUniswapV2Router01(uniswapRouter);
            address[] memory path = new address[](2);
            path[0] = reserveCurrency;
            path[1] = fc.collateralCurrency();

            TransferHelper.safeApprove(reserveCurrency, address(router), type(uint256).max);
            router.swapTokensForExactTokens(
                collateralToBePurchased, // amountOut
                (router.getAmountsIn(1000000, path)[0] * collateralToBePurchased * (1e18 + maxSlippage / 2) * 997) /
                    (1000000 * 1e18 * 1000), // amountInMax
                path,
                address(this),
                deadline
            );
        }

        // 4.c. If at this point we were not able to get `the required amount of collateral (due to insufficient reserve
        // or not enough collateral in the contract) the script should try to liquidate as much as it can regardless.
        // Update the values of total collateral to the current collateral balance and re-compute the tokenShortfall
        // as the maximum tokens that could be liquidated at the current GCR.
        if (totalCollateralRequired.isGreaterThan(getCollateralBalance(fc))) {
            totalCollateralRequired = getCollateralBalance(fc);
            collateralToMintShortfall = totalCollateralRequired.sub(getFinalFee(fc));
            tokenShortfall = collateralToMintShortfall.divCeil(gcr);
        }
        // 5. Mint the shortfall synthetics with collateral. Note we are minting at the GCR.
        // If the DSProxy already has enough tokens (tokenShortfall = 0) we still preform the approval on the collateral
        // currency as this is needed to pay the final fee in the liquidation tx.
        TransferHelper.safeApprove(fc.collateralCurrency(), address(fc), totalCollateralRequired.rawValue);
        if (tokenShortfall.isGreaterThan(0)) fc.create(collateralToMintShortfall, tokenShortfall);

        // The liquidatableTokens is either the maxTokensToLiquidate (if we were able to buy/mint enough) or the full
        // token token balance at this point if there was a shortfall.
        if (maxTokensToLiquidate.isGreaterThan(getSyntheticBalance(fc))) maxTokensToLiquidate = getSyntheticBalance(fc);

        // 6. Liquidate position with newly minted synthetics.
        TransferHelper.safeApprove(fc.tokenCurrency(), address(fc), maxTokensToLiquidate.rawValue);
        fc.createLiquidation(
            liquidatedSponsor,
            minCollateralPerTokenLiquidated,
            maxCollateralPerTokenLiquidated,
            maxTokensToLiquidate,
            deadline
        );
    }

    // Helper method to work around subtraction overflow in the case of: a - b with b > a.
    function subOrZero(FixedPoint.Unsigned memory a, FixedPoint.Unsigned memory b)
        internal
        pure
        returns (FixedPoint.Unsigned memory)
    {
        return b.isGreaterThanOrEqual(a) ? FixedPoint.fromUnscaledUint(0) : a.sub(b);
    }

    // Helper method to return the current final fee for a given financial contract instance.
    function getFinalFee(IFinancialContract fc) internal view returns (FixedPoint.Unsigned memory) {
        return IStore(IFinder(fc.finder()).getImplementationAddress("Store")).computeFinalFee(fc.collateralCurrency());
    }

    // Helper method to return the collateral balance of this contract.
    function getCollateralBalance(IFinancialContract fc) internal view returns (FixedPoint.Unsigned memory) {
        return FixedPoint.Unsigned(IERC20(fc.collateralCurrency()).balanceOf(address(this)));
    }

    // Helper method to return the synthetic balance of this contract.
    function getSyntheticBalance(IFinancialContract fc) internal view returns (FixedPoint.Unsigned memory) {
        return FixedPoint.Unsigned(IERC20(fc.tokenCurrency()).balanceOf(address(this)));
    }
}

// Define some simple interfaces for dealing with UMA contracts.
interface IFinancialContract {
    struct PositionData {
        FixedPoint.Unsigned tokensOutstanding;
        uint256 withdrawalRequestPassTimestamp;
        FixedPoint.Unsigned withdrawalRequestAmount;
        FixedPoint.Unsigned rawCollateral;
        uint256 transferPositionRequestPassTimestamp;
    }

    function positions(address sponsor) external view returns (PositionData memory);

    function collateralCurrency() external view returns (address);

    function tokenCurrency() external view returns (address);

    function finder() external view returns (address);

    function pfc() external view returns (FixedPoint.Unsigned memory);

    function totalTokensOutstanding() external view returns (FixedPoint.Unsigned memory);

    function create(FixedPoint.Unsigned memory collateralAmount, FixedPoint.Unsigned memory numTokens) external;

    function createLiquidation(
        address sponsor,
        FixedPoint.Unsigned calldata minCollateralPerToken,
        FixedPoint.Unsigned calldata maxCollateralPerToken,
        FixedPoint.Unsigned calldata maxTokensToLiquidate,
        uint256 deadline
    )
        external
        returns (
            uint256 liquidationId,
            FixedPoint.Unsigned memory tokensLiquidated,
            FixedPoint.Unsigned memory finalFeeBond
        );
}

interface IStore {
    function computeFinalFee(address currency) external view returns (FixedPoint.Unsigned memory);
}

interface IFinder {
    function getImplementationAddress(bytes32 interfaceName) external view returns (address);
}

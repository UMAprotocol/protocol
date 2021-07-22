// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;
pragma abicoder v2;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "@uniswap/lib/contracts/libraries/TransferHelper.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router01.sol";

import "../../common/implementation/FixedPoint.sol";

/**
 * @title ReserveCurrencyDisputer
 * @notice Helper contract to enable a disputer to hold one reserver currency and dispute against any number of
 * financial contracts. Is assumed to be called by a DSProxy which holds reserve currency.
 */

contract ReserveCurrencyDisputer {
    using SafeMath for uint256;
    using FixedPoint for FixedPoint.Unsigned;

    /**
     * @notice Swaps required amount of reserve currency to collateral currency which is then used to dispute a liquidation.
     * @dev Any collateral the contract has will be used before anything is purchased on Uniswap.
     * @param uniswapRouter address of the uniswap router used to facilitate trades.
     * @param financialContract address of the financial contract on which the liquidation is occurring.
     * @param reserveCurrency address of the token to swap for collateral. This is the common currency held by the DSProxy.
     * @param sponsor address of the sponsor who's liquidation is disputed.
     * @param liquidationId index of the liquidation for the given sponsor.
     * @param maxReserveTokenSpent maximum number of reserve tokens to spend in the trade. Bounds slippage.
     * @param deadline abort the trade and dispute if the transaction is mined after this timestamp.
     **/
    function swapDispute(
        address uniswapRouter,
        address financialContract,
        address reserveCurrency,
        uint256 liquidationId,
        address sponsor,
        uint256 maxReserveTokenSpent,
        uint256 deadline
    ) public {
        IFinancialContract fc = IFinancialContract(financialContract);

        // 1. Fetch information about the liquidation from the financial contract.
        IFinancialContract.LiquidationData memory liquidationData = fc.liquidations(sponsor, liquidationId);

        // 2. Fetch the disputeBondPercentage from the financial contract.
        FixedPoint.Unsigned memory disputeBondPercentage = fc.disputeBondPercentage();

        // 3. Compute the disputeBondAmount. Multiply by the unit collateral so the dispute bond is a percentage of the
        // locked collateral after fees. To add fees we simply multiply the rawUnitCollateral by the cumulativeFeeMultiplier.
        FixedPoint.Unsigned memory disputeBondAmount =
            liquidationData.lockedCollateral.mul(disputeBondPercentage).mul(
                (liquidationData.rawUnitCollateral).mul(fc.cumulativeFeeMultiplier())
            );

        // 4. Calculate required collateral. Cost of a dispute is the dispute bond + the final fee.
        FixedPoint.Unsigned memory totalCollateralRequired = disputeBondAmount.add(liquidationData.finalFee);

        // 5. Compute the collateral shortfall. This considers and collateral that is current in the contract.
        FixedPoint.Unsigned memory collateralToBePurchased =
            subOrZero(totalCollateralRequired, getCollateralBalance(fc));

        // 6. If there is collateral to be purchased, buy it on uniswap with the reserve currency.
        if (collateralToBePurchased.isGreaterThan(0) && reserveCurrency != fc.collateralCurrency()) {
            IUniswapV2Router01 router = IUniswapV2Router01(uniswapRouter);
            address[] memory path = new address[](2);
            path[0] = reserveCurrency;
            path[1] = fc.collateralCurrency();

            TransferHelper.safeApprove(reserveCurrency, address(router), maxReserveTokenSpent);
            router.swapTokensForExactTokens(
                collateralToBePurchased.rawValue,
                maxReserveTokenSpent,
                path,
                address(this),
                deadline
            );
        }

        // 7. Finally, submit the dispute.
        TransferHelper.safeApprove(fc.collateralCurrency(), address(fc), totalCollateralRequired.rawValue);
        fc.dispute(liquidationId, sponsor);
    }

    // Helper method to work around subtraction overflow in the case of: a - b with b > a.
    function subOrZero(FixedPoint.Unsigned memory a, FixedPoint.Unsigned memory b)
        internal
        pure
        returns (FixedPoint.Unsigned memory)
    {
        return b.isGreaterThanOrEqual(a) ? FixedPoint.fromUnscaledUint(0) : a.sub(b);
    }

    // Helper method to return the collateral balance of this contract.
    function getCollateralBalance(IFinancialContract fc) internal view returns (FixedPoint.Unsigned memory) {
        return FixedPoint.Unsigned(IERC20(fc.collateralCurrency()).balanceOf(address(this)));
    }
}

// Define some simple interfaces for dealing with UMA contracts.
interface IFinancialContract {
    enum Status { Uninitialized, NotDisputed, Disputed, DisputeSucceeded, DisputeFailed }

    struct LiquidationData {
        address sponsor;
        address liquidator;
        Status state;
        uint256 liquidationTime;
        FixedPoint.Unsigned tokensOutstanding;
        FixedPoint.Unsigned lockedCollateral;
        FixedPoint.Unsigned liquidatedCollateral;
        FixedPoint.Unsigned rawUnitCollateral;
        address disputer;
        FixedPoint.Unsigned settlementPrice;
        FixedPoint.Unsigned finalFee;
    }

    function liquidations(address sponsor, uint256 liquidationId) external view returns (LiquidationData memory);

    function disputeBondPercentage() external view returns (FixedPoint.Unsigned memory);

    function disputerDisputeRewardPct() external view returns (FixedPoint.Unsigned memory);

    function cumulativeFeeMultiplier() external view returns (FixedPoint.Unsigned memory);

    function collateralCurrency() external view returns (address);

    function dispute(uint256 liquidationId, address sponsor) external returns (FixedPoint.Unsigned memory totalPaid);
}

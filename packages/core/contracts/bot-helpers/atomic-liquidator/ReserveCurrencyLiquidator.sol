pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";
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
     * @param uniswapRouter address of the uniswap router used to facilitate trades.
     * @param financialContract address of the financial contract on which the liquidation is occurring.
     * @param reserveCurrency address of the token to swap for collateral. THis is the common currency held by the DSProxy.
     * @param liquidatedSponsor address of the sponsor to be liquidated.
     * @param maxReserveTokenSpent maximum number of reserve tokens to spend in the trade. Bounds slippage.
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
        FixedPoint.Unsigned calldata maxReserveTokenSpent,
        FixedPoint.Unsigned calldata minCollateralPerTokenLiquidated,
        FixedPoint.Unsigned calldata maxCollateralPerTokenLiquidated,
        FixedPoint.Unsigned calldata maxTokensToLiquidate,
        uint256 deadline
    ) public {
        IFinancialContract fc = IFinancialContract(financialContract);

        // 1. Calculate the token shortfall. This is the synthetics to liquidate minus any synthetics the DSProxy already
        // has. If this number is negative(balance large than synthetics to liquidate) the return 0 (no shortfall).
        FixedPoint.Unsigned memory tokenShortfall =
            subOrZero(maxTokensToLiquidate, FixedPoint.Unsigned(IERC20(fc.tokenCurrency()).balanceOf(address(this))));

        // 2. Calculate how much collateral is needed to make up the token shortfall from minting new synthetics.
        FixedPoint.Unsigned memory gcr = fc.pfc().divCeil(fc.totalTokensOutstanding());
        FixedPoint.Unsigned memory collateralToMintShortfall = tokenShortfall.mul(gcr);

        // 3. Calculate the total collateral required. This considers the final fee for the given collateral type + any
        // collateral needed to mint the token short fall.
        FixedPoint.Unsigned memory totalCollateralRequired =
            IStore(IFinder(fc.finder()).getImplementationAddress("Store")).computeFinalFee(fc.collateralCurrency()).add(
                collateralToMintShortfall
            );

        // 4. Calculate how much collateral needs to be purchased. If the DSProxy already has some collateral then this
        // will factor this in. If the DSProxy has more collateral than the total amount required the purchased = 0.
        FixedPoint.Unsigned memory collateralToBePurchased =
            subOrZero(
                totalCollateralRequired,
                FixedPoint.Unsigned(IERC20(fc.collateralCurrency()).balanceOf(address(this)))
            );

        // 4.a. If there is some collateral to be purchased, execute a trade on uniswap to meet the shortfall.
        // Note the path assumes a direct route from the reserve currency to the collateral currency.
        // Note that if the reserve currency is equal to the collateral currency no trade will execute within the router.
        if (collateralToBePurchased.isGreaterThan(FixedPoint.fromUnscaledUint(0))) {
            IUniswapV2Router01 router = IUniswapV2Router01(uniswapRouter);
            address[] memory path = new address[](2);
            path[0] = reserveCurrency;
            path[1] = fc.collateralCurrency();

            TransferHelper.safeApprove(reserveCurrency, address(router), maxReserveTokenSpent.rawValue);
            router.swapTokensForExactTokens(
                collateralToBePurchased.rawValue,
                maxReserveTokenSpent.rawValue,
                path,
                address(this),
                deadline
            );
        }
        // 5. Mint the shortfall synthetics with collateral. Note we are minting at the GCR.
        // If the DSProxy already has enough tokens (tokenShortfall = 0) we still preform the approval on the collateral
        // currency as this is needed to pay the final fee in the liquidation tx.
        TransferHelper.safeApprove(fc.collateralCurrency(), address(fc), totalCollateralRequired.rawValue);
        if (tokenShortfall.isGreaterThan(FixedPoint.fromUnscaledUint(0))) {
            fc.create(collateralToMintShortfall, tokenShortfall);
        }

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

    function positions(address sponsor) external returns (PositionData memory);

    function collateralCurrency() external returns (address);

    function tokenCurrency() external returns (address);

    function finder() external returns (address);

    function pfc() external returns (FixedPoint.Unsigned memory);

    function totalTokensOutstanding() external returns (FixedPoint.Unsigned memory);

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
    function computeFinalFee(address currency) external returns (FixedPoint.Unsigned memory);
}

interface IFinder {
    function getImplementationAddress(bytes32 interfaceName) external view returns (address);
}

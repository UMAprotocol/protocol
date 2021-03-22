pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";

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
     * @dev After the liquidation is done the DSProxy that called this method will have an open positon AND pending
     * liquidation within the financial contract. The bot using the DSProxy should withdraw the liquidation once it has
     * passed liveness. At this point the position can be manually unwound.
     * @param uniswapRouter address of the uniswap router used to facilate trades.
     * @param financialContract address of the financial contract on which the liquidation is occuring.
     * @param reserveCurrency address of the token to swap for collateral. THis is the common currency held by the DSProxy.
     * @param liquidatedSponsor address of the sponsor to be liquidated.
     * @param maxReserverTokenSpent maximum number of reserve tokens to spend in the trade. Bounds slippage.
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
        FixedPoint.Unsigned calldata maxReserverTokenSpent,
        FixedPoint.Unsigned calldata minCollateralPerTokenLiquidated,
        FixedPoint.Unsigned calldata maxCollateralPerTokenLiquidated,
        FixedPoint.Unsigned calldata maxTokensToLiquidate,
        uint256 deadline
    ) public {
        IUniswapV2Router01 router = IUniswapV2Router01(uniswapRouter);
        FinancialContractInterface fc = FinancialContractInterface(financialContract);

        // 1. Calculate how much collateral needed to mint maxTokensToLiquidate.
        FixedPoint.Unsigned memory gcr = fc.pfc().div(fc.totalTokensOutstanding());
        FixedPoint.Unsigned memory collateralToMintAtGcr = maxTokensToLiquidate.mul(gcr);

        // 2. Calculate how much collateral is needed for the final fee.
        FinderInterface finder = FinderInterface(fc.finder());
        StoreInterface store = StoreInterface(finder.getImplementationAddress("Store"));
        FixedPoint.Unsigned memory totalCollateralNeeded =
            collateralToMintAtGcr.add(store.computeFinalFee(fc.collateralCurrency()));

        // 3. swap reserve currency to get required collateral for the mint + final fee.
        address[] memory path = new address[](2);
        path[0] = reserveCurrency;
        path[1] = fc.collateralCurrency();

        TransferHelper.safeApprove(reserveCurrency, address(router), maxReserverTokenSpent.rawValue);
        router.swapTokensForExactTokens(
            totalCollateralNeeded.rawValue,
            maxReserverTokenSpent.rawValue,
            path,
            address(this),
            deadline
        );

        // 4. Mint synthetics with collateral. Note we are minting at the GCR and minting the exact number liquidated.
        TransferHelper.safeApprove(fc.collateralCurrency(), address(fc), totalCollateralNeeded.rawValue);
        fc.create(collateralToMintAtGcr, maxTokensToLiquidate);

        // 5. Liquidate position with newly minted synthetics.
        TransferHelper.safeApprove(fc.tokenCurrency(), address(fc), maxTokensToLiquidate.rawValue);
        fc.createLiquidation(
            liquidatedSponsor,
            minCollateralPerTokenLiquidated,
            maxCollateralPerTokenLiquidated,
            maxTokensToLiquidate,
            deadline
        );
    }
}

// Define some simple interfaces for dealing with UMA contracts.
interface FinancialContractInterface {
    struct PositionData {
        FixedPoint.Unsigned tokensOutstanding;
        uint256 withdrawalRequestPassTimestamp;
        FixedPoint.Unsigned withdrawalRequestAmount;
        FixedPoint.Unsigned rawCollateral;
        uint256 transferPositionRequestPassTimestamp;
    }

    function positions(address sponsor) external returns (PositionData memory);

    function collateralCurrency() external returns (address);

    function finder() external returns (address);

    function tokenCurrency() external returns (address);

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

interface StoreInterface {
    function computeFinalFee(address currency) external returns (FixedPoint.Unsigned memory);
}

interface FinderInterface {
    function getImplementationAddress(bytes32 interfaceName) external view returns (address);
}

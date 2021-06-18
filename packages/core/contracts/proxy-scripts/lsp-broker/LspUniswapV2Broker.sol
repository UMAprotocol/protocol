// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "@uniswap/lib/contracts/libraries/TransferHelper.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router01.sol";

import "../../common/implementation/FixedPoint.sol";

import "../../financial-templates/long-short-pair/LongShortPair.sol";

/**
 * @title ReserveCurrencyLiquidator
 * @notice Helper contract to enable a liquidator to hold one reserver currency and liquidate against any number of
 * financial contracts. Is assumed to be called by a DSProxy which holds reserve currency.
 */

contract LspUniswapV2Broker {
    using SafeMath for uint256;
    using FixedPoint for FixedPoint.Unsigned;

    function atomicMintAddLiquidity() public {}

    function atomicMintSellOneSide(
        bool tradingAsEOA,
        bool tradingLong,
        LongShortPair longShortPair,
        IUniswapV2Router01 router,
        uint256 collateralToMintWith,
        address[] memory swapPath,
        uint256 deadline
    ) public {
        require(address(longShortPair) != address(0), "Bad long short pair");
        require(address(router) != address(0), "Bad router");
        require(collateralToMintWith != 0, "Collateral to mint with");

        if (tradingAsEOA)
            TransferHelper.safeTransferFrom(
                address(longShortPair.collateralToken()),
                msg.sender,
                address(this),
                collateralToMintWith
            );

        TransferHelper.safeApprove(
            address(longShortPair.collateralToken()),
            address(longShortPair),
            collateralToMintWith
        );

        longShortPair.create(collateralToMintWith);

        IERC20 soldToken = IERC20(tradingLong ? longShortPair.shortToken() : longShortPair.longToken());

        require(swapPath[0] == address(soldToken), "Sold token != 0th swapPath");

        TransferHelper.safeApprove(address(soldToken), address(router), soldToken.balanceOf(address(this)));

        router.swapExactTokensForTokens(
            soldToken.balanceOf(address(this)), // sell all of the sold tokens held by the contract.
            0,
            swapPath,
            address(this),
            deadline
        );

        if (tradingAsEOA) {
            IERC20 otherToken = IERC20(!tradingLong ? longShortPair.shortToken() : longShortPair.longToken());
            otherToken.transfer(msg.sender, otherToken.balanceOf(address(this)));
        }
    }
}

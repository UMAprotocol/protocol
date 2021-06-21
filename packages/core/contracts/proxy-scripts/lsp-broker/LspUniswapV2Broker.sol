// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "@uniswap/lib/contracts/libraries/TransferHelper.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router01.sol";

import "../../common/implementation/FixedPoint.sol";

import "../../financial-templates/long-short-pair/LongShortPair.sol";

/**
 * @title LspUniswapV2Broker
 * @notice Helper contract to facilitate batched LSP and UniswapV2 transactions, including Mint+Sell and Mint+LP.
 */
contract LspUniswapV2Broker {
    using FixedPoint for FixedPoint.Unsigned;

    /**
     * @notice Mint long and short tokens and deposit them all into a UniV2 Pool.
     */
    function atomicMintAddLiquidity() public {
        /* TODO */
    }

    /**
     * @notice Mint long and short tokens and convert all of one side into the other.
     * @param tradingAsEOA If True, caller has balance of collateral and expects to receive back all long/short tokens.
     * @param sellLong If True, converts all long tokens into short, else the opposite.
     * @param longShortPair LSP contract address to mint position on.
     * @param router Contract to call to exchange long and short tokens.
     * @param collateralToMintWith Amount of collateral to deposit and borrow long and short tokens against.
     * @param swapPath `Router.swapExactTokensForTokens` param: path with which to swap token to sell for the other.
     * @param deadline `Router.swapExactTokensForTokens` param: time before transaction must be mined.
     */
    function atomicMintSellOneSide(
        bool tradingAsEOA,
        bool sellLong,
        LongShortPair longShortPair,
        IUniswapV2Router01 router, /* TODO: Should we allow `router` to be any exchange, such as a Matcha multihop? */
        uint256 collateralToMintWith,
        address[] memory swapPath,
        uint256 deadline
    ) public {
        require(address(longShortPair) != address(0), "Invalid long short pair");
        require(address(router) != address(0), "Invalid router");
        require(collateralToMintWith != 0, "Collateral to mint with");

        // 0) Pull collateral from caller if necessary and approve LSP to spend it.
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

        // 1) Deposit collateral into LSP and mint long and short tokens.
        longShortPair.create(collateralToMintWith);

        // 2) Determine which token we are selling and convert it all into the other.
        IERC20 soldToken = IERC20(sellLong ? longShortPair.shortToken() : longShortPair.longToken());
        TransferHelper.safeApprove(address(soldToken), address(router), soldToken.balanceOf(address(this)));
        require(swapPath[0] == address(soldToken), "Sold token != 0th swapPath");
        router.swapExactTokensForTokens(
            soldToken.balanceOf(address(this)), // sell all of the sold tokens held by the contract.
            0,
            swapPath,
            address(this),
            deadline
        );

        // 3) Send tokens back to caller if neccessary.
        if (tradingAsEOA) {
            IERC20 otherToken = IERC20(!sellLong ? longShortPair.shortToken() : longShortPair.longToken());
            otherToken.transfer(msg.sender, otherToken.balanceOf(address(this)));
        }
    }
}

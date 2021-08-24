// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

/**
 * @title Interface for Uniswap v3.
 * @dev This only contains the methods/events that we use in our contracts or offchain infrastructure.
 */
abstract contract UniswapV3 {
    // Called after every swap showing the new uniswap price for this token pair.
    event Swap(
        address indexed sender,
        address indexed recipient,
        int256 amount0,
        int256 amount1,
        uint160 sqrtPriceX96,
        uint128 liquidity,
        int24 tick
    );
    // Base currency.
    address public token0;
    // Quote currency.
    address public token1;
}

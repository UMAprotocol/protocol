// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../interfaces/UniswapV3.sol";

/**
 * @title Uniswap v3 Mock that allows manual price injection.
 */
contract UniswapV3Mock is UniswapV3 {
    function setTokens(address _token0, address _token1) external {
        token0 = _token0;
        token1 = _token1;
    }

    function setPrice(
        address sender,
        address recipient,
        int256 amount0,
        int256 amount1,
        uint160 sqrtPriceX96,
        uint128 liquidity,
        int24 tick
    ) external {
        emit Swap(sender, recipient, amount0, amount1, sqrtPriceX96, liquidity, tick);
    }
}

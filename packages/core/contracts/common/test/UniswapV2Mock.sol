// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../interfaces/UniswapV2.sol";

/**
 * @title Uniswap v2 Mock that allows manual price injection.
 */
contract UniswapV2Mock is UniswapV2 {
    function setTokens(address _token0, address _token1) external {
        token0 = _token0;
        token1 = _token1;
    }

    function setPrice(uint112 reserve0, uint112 reserve1) external {
        emit Sync(reserve0, reserve1);
    }
}

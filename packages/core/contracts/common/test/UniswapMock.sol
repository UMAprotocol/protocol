// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.6.0;

import "../interfaces/Uniswap.sol";

/**
 * @title Uniswap v2 Mock that allows manual price injection.
 */
contract UniswapMock is Uniswap {
    function setTokens(address _token0, address _token1) external {
        token0 = _token0;
        token1 = _token1;
    }

    function setPrice(uint112 reserve0, uint112 reserve1) external {
        emit Sync(reserve0, reserve1);
    }
}

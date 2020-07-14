pragma solidity ^0.6.0;

import "../interfaces/Uniswap.sol";


/**
 * @title Uniswap v2 Mock that allows manual price injection.
 */
contract UniswapMock is Uniswap {
    function setPrice(uint112 reserve0, uint112 reserve1) external {
        emit Sync(reserve0, reserve1);
    }

    function addLiquidity(
        address sender,
        uint256 amount0,
        uint256 amount1
    ) external {
        emit Mint(sender, amount0, amount1);
    }

    function removeLiquidity(
        address sender,
        uint256 amount0,
        uint256 amount1,
        address to
    ) external {
        emit Burn(sender, amount0, amount1, to);
    }
}

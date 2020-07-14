pragma solidity ^0.6.0;


/**
 * @title Interface for Uniswap v2.
 * @dev This only contains the methods/events that we use in our contracts or offchain infrastructure.
 */
abstract contract Uniswap {
    // Called after every swap showing the new uniswap "price" for this token pair.
    event Sync(uint112 reserve0, uint112 reserve1);

    // Called after adding liquidity to this tokens pool.
    event Mint(address indexed sender, uint256 amount0, uint256 amount1);

    // Called after removing liquidity from this tokens pool.
    event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to);
}

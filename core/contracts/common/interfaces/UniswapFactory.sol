pragma solidity ^0.6.0;


/**
 * @title Interface for the Uniswap v2 Factory.
 * @dev This only contains the methods/events that we use in our contracts or offchain infrastructure.
 */
abstract contract UniswapFactory {
    // Used to retrieve a factory's address.
    function getPair(address tokenA, address tokenB) external view returns (address pair);
}

pragma solidity ^0.6.0;

import "../interfaces/UniswapFactory.sol";


/**
 * @title Uniswap v2 Factory Mock that allows anyone to set pair addresses.
 */
contract UniswapFactoryMock is UniswapFactory {
    mapping(address => address => address) pairs;

    function addPair(address tokenA, address tokenB, address pair) external {
        pairs[tokenA][tokenB] = pair;
    }

    function getPair(address tokenA, address tokenB) external view returns (address pair) override {
        pair = pairs[tokenA][tokenB];
        if (pair == address(0)) {
            pair = pairs[tokenB][tokenA];
        }
    }
}
pragma solidity ^0.6.0;

import "../interfaces/Uniswap.sol";


/**
 * @title Uniswap v2 Mock that allows manual price injection.
 */
contract UniswapMock is Uniswap {
    // Called after every swap showing the new uniswap "price" for this token pair.
    event Sync(uint112 reserve0, uint112 reserve1);

    function setPrice(uint112 reserve0, uint112 reserve1) external {
        emit Sync(reserve0, reserve1);
    }
}

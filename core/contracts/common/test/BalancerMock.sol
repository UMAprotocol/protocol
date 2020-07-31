pragma solidity ^0.6.0;

import "../interfaces/Balancer.sol";


/**
 * @title Balancer Mock
 */
contract BalancerMock is Balancer {
    function getSpotPriceSansFee(address tokenIn, address tokenOut)
        external
        virtual
        override
        view
        returns (uint256 spotPrice)
    {
        return 0;
    }
}

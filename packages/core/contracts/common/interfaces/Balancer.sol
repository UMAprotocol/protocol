// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

/**
 * @title Interface for Balancer.
 * @dev This only contains the methods/events that we use in our contracts or offchain infrastructure.
 */
abstract contract Balancer {
    function getSpotPriceSansFee(address tokenIn, address tokenOut) external view virtual returns (uint256 spotPrice);
}

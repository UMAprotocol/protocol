// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../interfaces/Balancer.sol";

/**
 * @title Balancer Mock
 */
contract BalancerMock is Balancer {
    uint256 price = 0;

    // these params arent used in the mock, but this is to maintain compatibility with balancer API
    function getSpotPriceSansFee(address, address) external view virtual override returns (uint256 spotPrice) {
        return price;
    }

    // this is not a balancer call, but for testing for changing price.
    function setPrice(uint256 newPrice) external {
        price = newPrice;
    }
}

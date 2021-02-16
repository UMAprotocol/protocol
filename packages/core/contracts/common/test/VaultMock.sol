// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.6.0;

import "../interfaces/VaultInterface.sol";

/**
 * @title Mock for yearn-style vaults for use in tests.
 */
abstract contract VaultMock is VaultInterface {
    uint256 private pricePerFullShare = 0;

    function getPricePerFullShare() public view override returns (uint256) {
        return pricePerFullShare;
    }

    function setPricePerFullShare(uint256 _pricePerFullShare) external {
        pricePerFullShare = _pricePerFullShare;
    }
}

// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../interfaces/HarvestVaultInterface.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title Mock for Harvest-style vaults for use in tests.
 */
contract HarvestVaultMock is HarvestVaultInterface {
    IERC20 public override underlying;
    uint256 private pricePerFullShare = 0;

    constructor(IERC20 _underlying) {
        underlying = _underlying;
    }

    function getPricePerFullShare() external view override returns (uint256) {
        return pricePerFullShare;
    }

    function setPricePerFullShare(uint256 _pricePerFullShare) external {
        pricePerFullShare = _pricePerFullShare;
    }
}

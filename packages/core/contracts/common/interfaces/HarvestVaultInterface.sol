// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title Interface for Harvest-style vaults.
 * @dev This only contains the methods/events that we use in our contracts or offchain infrastructure.
 */
abstract contract HarvestVaultInterface {
    // Return the underlying token.
    function underlying() external view virtual returns (IERC20);

    // Gets the number of return tokens that a "share" of this vault is worth.
    function getPricePerFullShare() external view virtual returns (uint256);
}

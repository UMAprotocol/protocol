// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.6.0;

/**
 * @title Interface for Yearn-style vaults.
 * @dev This only contains the methods/events that we use in our contracts or offchain infrastructure.
 */
abstract contract VaultInterface {
    // Gets the number of return tokens that a "share" of this vault is worth.
    function getPricePerFullShare() public view virtual returns (uint256);
}

// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @notice Contract deployed on L1 that ingests liquidity from passive liquidity providers and returns them claims to
 * withdraw their funds.
 */
abstract contract BridgePool is ERC20 {
    event ProvidedLiquidity(address indexed token, uint256 amount, uint256 lpTokensMinted, address liquidityProvider);
}

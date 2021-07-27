// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity >=0.7.6;

/**
 * @notice Contract deployed on L1 that ingests liquidity from passive liquidity providers and returns them claims to
 * withdraw their funds.
 */
contract BridgePool {
    event ProvidedLiquidity(address indexed token, uint256 amount, uint256 lpTokensMinted, address liquidityProvider);
}

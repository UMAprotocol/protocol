// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title L2StandardBridge
 * @dev The L2 Standard bridge is a contract which works together with the L1 Standard bridge to
 * enable ETH and ERC20 transitions between L1 and L2.
 * This contract acts as a minter for new tokens when it hears about deposits into the L1 Standard
 * bridge.
 * This contract also acts as a burner of the tokens intended for withdrawal, informing the L1
 * bridge to release L1 funds.
 */
contract OptimismL2StandardBridge {
    /********************************
     * External Contract References *
     ********************************/

    address public l1TokenBridge;
}

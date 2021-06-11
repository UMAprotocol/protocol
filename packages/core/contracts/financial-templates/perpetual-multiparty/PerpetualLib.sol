// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "./Perpetual.sol";

/**
 * @title Provides convenient Perpetual Multi Party contract utilities.
 * @dev Using this library to deploy Perpetuals allows calling contracts to avoid importing the full bytecode.
 */
library PerpetualLib {
    /**
     * @notice Returns address of new Perpetual deployed with given `params` configuration.
     * @dev Caller will need to register new Perpetual with the Registry to begin requesting prices. Caller is also
     * responsible for enforcing constraints on `params`.
     * @param params is a `ConstructorParams` object from Perpetual.
     * @return address of the deployed Perpetual contract
     */
    function deploy(Perpetual.ConstructorParams memory params) public returns (address) {
        Perpetual derivative = new Perpetual(params);
        return address(derivative);
    }
}

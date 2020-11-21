// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "./PerpetualPoolParty.sol";

/**
 * @title Provides convenient Perpetual Multi Party contract utilities.
 * @dev Using this library to deploy Perpetuals allows calling contracts to avoid importing the full bytecode.
 */
library PerpetualPoolPartyLib {
    /**
     * @notice Returns address of new Perpetual deployed with given `params` configuration.
     * @dev Caller will need to register new Perpetual with the Registry to begin requesting prices. Caller is also
     * responsible for enforcing constraints on `params`.
     * @param params is a `ConstructorParams` object from Perpetual.
     * @return address of the deployed Perpetual contract
     */
    function deploy(PerpetualPoolParty.ConstructorParams memory params) public returns (address) {
        PerpetualPoolParty derivative = new PerpetualPoolParty(params);
        return address(derivative);
    }
}

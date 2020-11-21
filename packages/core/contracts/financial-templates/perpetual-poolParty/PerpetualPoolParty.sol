// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "./PerpetualLiquidatablePoolParty.sol";

/**
 * @title Perpetual Multiparty Contract.
 * @notice Convenient wrapper for Liquidatable.
 */
contract PerpetualPoolParty is PerpetualLiquidatablePoolParty {
    /**
     * @notice Constructs the Perpetual contract.
     * @param params struct to define input parameters for construction of Liquidatable. Some params
     * are fed directly into the PositionManager's constructor within the inheritance tree.
     */
    constructor(ConstructorParams memory params)
        public
        PerpetualLiquidatablePoolParty(params)
    // Note: since there is no logic here, there is no need to add a re-entrancy guard.
    {

    }
}

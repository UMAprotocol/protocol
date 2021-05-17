// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "./PerpetualLiquidatable.sol";

/**
 * @title Perpetual Multiparty Contract.
 * @notice Convenient wrapper for Liquidatable.
 */
contract Perpetual is PerpetualLiquidatable {
    /**
     * @notice Constructs the Perpetual contract.
     * @param params struct to define input parameters for construction of Liquidatable. Some params
     * are fed directly into the PositionManager's constructor within the inheritance tree.
     */
    constructor(ConstructorParams memory params)
        PerpetualLiquidatable(params)
    // Note: since there is no logic here, there is no need to add a re-entrancy guard.
    {

    }
}

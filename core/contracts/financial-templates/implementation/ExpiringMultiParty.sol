pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "./Liquidatable.sol";


contract ExpiringMultiParty is Liquidatable {
    /**
     * @notice Note on party members of this registered financial contract.
     * @dev Before creating a position, the ExpiringMultiParty contract must be registered with the Registry so that it can add and remove members to its party.
     * Party members is the position sponsor if the position has a non-zero amount of un-liquidated collateral.
     * The liquidator and disputer are never registered with the financial contract because they interact with liquidated collateral,
     * which is conceptually not part of the position.
     */

    constructor(ConstructorParams memory params) public Liquidatable(params) {}
}

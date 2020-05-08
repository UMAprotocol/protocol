pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "./Liquidatable.sol";


contract ExpiringMultiParty is Liquidatable {
    constructor(ConstructorParams memory params)
        public
        Liquidatable(params)
    // Note: since there is no logic here, there is no need to add a re-entrancy guard.
    {

    }
}

pragma solidity ^0.5.0;
pragma experimental ABIEncoderV2;

import "./Liquidatable.sol";
import "../FixedPoint.sol";

contract ExpiringMultiParty is Liquidatable {
    using FixedPoint for FixedPoint.Unsigned;
    constructor(ConstructorParams memory params)
        public
        Liquidatable(params)
    {}
}
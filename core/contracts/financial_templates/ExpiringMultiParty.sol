pragma solidity ^0.5.0;
pragma experimental ABIEncoderV2;

import "../common/FixedPoint.sol";
import "./Liquidatable.sol";

contract ExpiringMultiParty is Liquidatable {
    constructor(ConstructorParams memory params) public Liquidatable(params) {}
}

pragma solidity ^0.5.0;
pragma experimental ABIEncoderV2;

import "./Position.sol";

contract ExpiringMultiParty is Position {
    constructor(uint _expirationTimestamp, address collateralAddress, bool _isTest) public
    Position(_expirationTimestamp, collateralAddress, _isTest) {}
}

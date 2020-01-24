pragma solidity ^0.5.0;
pragma experimental ABIEncoderV2;

import "./Liquidation.sol";
import "./Position.sol";

contract ExpiringMultiParty is Position, Liquidation {
    constructor(uint _expirationTimestamp, bool _isTest) public Position(_expirationTimestamp, _isTest) {}
}

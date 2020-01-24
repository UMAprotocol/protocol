pragma solidity ^0.5.0;

import "./Liquidation.sol";
import "./Position.sol";

contract ExpiringMultiParty is Position, Liquidation {}

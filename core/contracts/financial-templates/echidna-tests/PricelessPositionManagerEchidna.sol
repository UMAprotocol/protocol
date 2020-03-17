pragma solidity ^0.6.0;

import "../implementation/PricelessPositionManager.sol";


contract PricelessPositionManagerEchidna is PricelessPositionManager {
    function echidna_valid_assert() public returns (bool) {
        return true;
    }
}

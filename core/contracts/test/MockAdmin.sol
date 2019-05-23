pragma solidity ^0.5.0;

import "../AdminInterface.sol";


// A mock implementation of AdminInterface, taking the place of a financial contract.
contract MockAdmin is AdminInterface {

    uint public timesRemargined;
    uint public timesEmergencyShutdown;

    function remargin() external {
        timesRemargined++;
    }

    function emergencyShutdown() external {
        timesEmergencyShutdown++;
    }
}

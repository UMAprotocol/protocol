pragma solidity ^0.5.0;

import "../AdministrateeInterface.sol";


// A mock implementation of AdministrateeInterface, taking the place of a financial contract.
contract MockAdministratee is AdministrateeInterface {

    uint public timesRemargined;
    uint public timesEmergencyShutdown;

    function remargin() external {
        timesRemargined++;
    }

    function emergencyShutdown() external {
        timesEmergencyShutdown++;
    }
}

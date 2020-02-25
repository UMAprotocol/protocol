pragma solidity ^0.6.0;

import "../../interfaces/AdministrateeInterface.sol";


// A mock implementation of AdministrateeInterface, taking the place of a financial contract.
contract MockAdministratee is AdministrateeInterface {
    uint public timesRemargined;
    uint public timesEmergencyShutdown;

    function remargin() external override {
        timesRemargined++;
    }

    function emergencyShutdown() external override {
        timesEmergencyShutdown++;
    }
}

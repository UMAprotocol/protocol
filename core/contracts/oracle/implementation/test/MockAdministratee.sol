pragma solidity ^0.6.0;

import "../../interfaces/AdministrateeInterface.sol";


// A mock implementation of AdministrateeInterface, taking the place of a financial contract.
contract MockAdministratee is AdministrateeInterface {
    uint public timesRemargined;
    uint public timesEmergencyShutdown;

     // TODO(#969) Remove once prettier-plugin-solidity can handle the "override" keyword
     // prettier-ignore
    function remargin() external override {
        timesRemargined++;
    }

     // TODO(#969) Remove once prettier-plugin-solidity can handle the "override" keyword
     // prettier-ignore
    function emergencyShutdown() external override {
        timesEmergencyShutdown++;
    }
}

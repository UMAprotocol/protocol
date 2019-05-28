/*
  AdministrateeInterface contract.
  The interfact that enumerates the functionality that derivative contracts expose to the admin.
*/
pragma solidity ^0.5.0;


// The functionality that all derivative contracts expose to the admin.
interface AdministrateeInterface {
    // Initiates the shutdown process, in case of an emergency.
    function emergencyShutdown() external;

    // A core contract method called immediately before or after any financial transaction. It pays fees and moves money
    // between margin accounts to make sure they reflect the NAV of the contract.
    function remargin() external;
}

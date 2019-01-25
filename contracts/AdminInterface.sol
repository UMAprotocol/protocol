/*
  AdminInterface contract.
  The interfact that enumerates the functionality that derivative contracts expose to the admin.
*/
pragma solidity ^0.5.0;


// The functionality that all derivative contracts expose to the admin.
interface AdminInterface {
    function emergencyShutdown() external;

    function remargin() external;
}

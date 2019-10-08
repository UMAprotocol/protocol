/**
 * AdministrateeInterface contract.
 * The interface that enumerates the functionality that derivative contracts expose to the admin.
 */
pragma solidity 0.5.0;


/**
 * @title Interface that all derivative contracts expose to the admin.
 */
interface AdministrateeInterface {
    /**
     * @notice Initiates the shutdown process, in case of an emergency.
     */
    function emergencyShutdown() external;

    /**
     * @notice A core contract method called independently or as a part of other financial contract transactions. It
     * pays fees and moves money between margin accounts to make sure they reflect the NAV of the contract.
     */
    function remargin() external;
}

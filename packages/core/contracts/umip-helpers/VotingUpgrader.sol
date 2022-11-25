// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

import "../data-verification-mechanism/implementation/Finder.sol";
import "../data-verification-mechanism/implementation/Constants.sol";
import "../data-verification-mechanism/implementation/Voting.sol";

/**
 * @title A contract that executes a short series of upgrade calls that must be performed atomically as a part of the
 * upgrade process for Voting.sol.
 * @dev Note: the complete upgrade process requires more than just the transactions in this contract. These are only
 * the ones that need to be performed atomically.
 */
contract VotingUpgrader {
    // Existing governor is the only one who can initiate the upgrade.
    address public governor;

    // Existing Voting contract needs to be informed of the address of the new Voting contract.
    Voting public existingVoting;

    // New governor will be the new owner of the finder.

    // Finder contract to push upgrades to.
    Finder public finder;

    // Addresses to upgrade.
    address public newVoting;

    // Address to call setMigrated on the old voting contract.
    address public setMigratedAddress;

    /**
     * @notice Removes an address from the whitelist.
     * @param _governor the Governor contract address.
     * @param _existingVoting the current/existing Voting contract address.
     * @param _newVoting the new Voting deployment address.
     * @param _finder the Finder contract address.
     * @param _setMigratedAddress the address to set migrated. This address will be able to continue making calls to
     *                            old voting contract (used to claim rewards on others' behalf). Note: this address
     *                            can always be changed by the voters.
     */
    constructor(
        address _governor,
        address _existingVoting,
        address _newVoting,
        address _finder,
        address _setMigratedAddress
    ) {
        governor = _governor;
        existingVoting = Voting(_existingVoting);
        newVoting = _newVoting;
        finder = Finder(_finder);
        setMigratedAddress = _setMigratedAddress;
    }

    /**
     * @notice Performs the atomic portion of the upgrade process.
     * @dev This method updates the Voting address in the finder, sets the old voting contract to migrated state, and
     * returns ownership of the existing Voting contract and Finder back to the Governor.
     */
    function upgrade() external {
        require(msg.sender == governor, "Upgrade can only be initiated by the existing governor.");

        // Change the addresses in the Finder.
        finder.changeImplementationAddress(OracleInterfaces.Oracle, newVoting);

        // Set the preset "migrated" address to allow this address to claim rewards on voters' behalf.
        // This also effectively shuts down the existing voting contract so new votes cannot be triggered.
        existingVoting.setMigrated(setMigratedAddress);

        // Transfer back ownership of old voting contract and the finder to the governor.
        existingVoting.transferOwnership(governor);
        finder.transferOwnership(governor);
    }
}

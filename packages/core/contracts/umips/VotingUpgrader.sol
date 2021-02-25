// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.6.0;

import "../oracle/implementation/Finder.sol";
import "../oracle/implementation/Constants.sol";
import "../oracle/implementation/Voting.sol";

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

    /**
     * @notice Removes an address from the whitelist.
     * @param _governor the Governor contract address.
     * @param _existingVoting the current/existing Voting contract address.
     * @param _newVoting the new Voting deployment address.
     * @param _finder the Finder contract address.
     */
    constructor(
        address _governor,
        address _existingVoting,
        address _newVoting,
        address _finder
    ) public {
        governor = _governor;
        existingVoting = Voting(_existingVoting);
        newVoting = _newVoting;
        finder = Finder(_finder);
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
        // Set current Voting contract to migrated.
        existingVoting.setMigrated(newVoting);

        // Transfer back ownership of old voting contract and the finder to the governor.
        existingVoting.transferOwnership(governor);
        finder.transferOwnership(governor);
    }
}

// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../oracle/implementation/Finder.sol";
import "../oracle/implementation/Constants.sol";
import "../oracle/implementation/Voting.sol";

import "../common/implementation/MultiRole.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

// Ownable contracts to transfer ownership of
struct OwnableContracts {
    address identifierWhitelist;
    address financialContractsAdmin;
    address addressWhitelist;
    address governorRootTunnel;
    address arbitrumParentMessenger;
    address oracleHub;
    address governorHub;
    address bobaParentMessenger;
    address optimismParentMessenger;
    address proposer;
}

// Multirole contracts to transfer ownership of
struct MultiroleContracts {
    address registry;
    address store;
}

/**
 * @title A contract that executes a short series of upgrade calls that must be performed atomically as a part of the
 * upgrade process for Voting.sol.
 * @dev Note: the complete upgrade process requires more than just the transactions in this contract. These are only
 * the ones that need to be performed atomically.
 */
contract VotingUpgraderV2 {
    // Existing governor is the only one who can initiate the upgrade.
    address public existingGovernor;

    // Existing governor is the only one who can initiate the upgrade.
    address public newGovernor;

    // Existing Voting contract needs to be informed of the address of the new Voting contract.
    Voting public existingVoting;

    // New governor will be the new owner of the finder.

    // Finder contract to push upgrades to.
    Finder public finder;

    // Addresses to upgrade.
    address public newVoting;

    // Additional ownable contracts to transfer ownership of.
    OwnableContracts public ownableContracts;

    // Additional multirole contracts to transfer ownership of.
    MultiroleContracts public multiroleContracts;

    /**
     * @notice Removes an address from the whitelist.
     * @param _existingGovernor the existing Governor contract address.
     * @param _newGovernor the new Governor contract address.
     * @param _existingVoting the current/existing Voting contract address.
     * @param _newVoting the new Voting deployment address.
     * @param _finder the Finder contract address.
     * @param _ownableContracts additional ownable contracts to transfer ownership of.
     * @param _multiroleContracts additional multirole contracts to transfer ownership of.
     */
    constructor(
        address _existingGovernor,
        address _newGovernor,
        address _existingVoting,
        address _newVoting,
        address _finder,
        OwnableContracts memory _ownableContracts,
        MultiroleContracts memory _multiroleContracts
    ) {
        existingGovernor = _existingGovernor;
        newGovernor = _newGovernor;
        existingVoting = Voting(_existingVoting);
        newVoting = _newVoting;
        finder = Finder(_finder);
        ownableContracts = _ownableContracts;
        multiroleContracts = _multiroleContracts;
    }

    /**
     * @notice Performs the atomic portion of the upgrade process.
     * @dev This method updates the Voting address in the finder, sets the old voting contract to migrated state, and
     * returns ownership of the existing Voting contract and Finder back to the Governor.
     */
    function upgrade() external {
        require(msg.sender == existingGovernor, "Upgrade can only be initiated by the existing governor.");

        // Change the addresses in the Finder.
        finder.changeImplementationAddress(OracleInterfaces.Oracle, newVoting);

        // Set the preset "migrated" address to allow this address to claim rewards on voters' behalf.
        // This also effectively shuts down the existing voting contract so new votes cannot be triggered.
        existingVoting.setMigrated(newVoting);

        // Transfer back ownership of old voting contract and the finder to the governor.
        existingVoting.transferOwnership(newGovernor);
        finder.transferOwnership(newGovernor);

        // Additional ownable contracts
        Ownable(ownableContracts.identifierWhitelist).transferOwnership(newGovernor);
        Ownable(ownableContracts.financialContractsAdmin).transferOwnership(newGovernor);
        Ownable(ownableContracts.addressWhitelist).transferOwnership(newGovernor);
        Ownable(ownableContracts.governorRootTunnel).transferOwnership(newGovernor);
        Ownable(ownableContracts.arbitrumParentMessenger).transferOwnership(newGovernor);
        Ownable(ownableContracts.oracleHub).transferOwnership(newGovernor);
        Ownable(ownableContracts.governorHub).transferOwnership(newGovernor);
        Ownable(ownableContracts.bobaParentMessenger).transferOwnership(newGovernor);
        Ownable(ownableContracts.optimismParentMessenger).transferOwnership(newGovernor);
        Ownable(ownableContracts.proposer).transferOwnership(newGovernor);

        // Set the new governor as the owner of the old governor
        MultiRole(existingGovernor).resetMember(0, newGovernor);

        // Additional multirole contracts
        MultiRole(multiroleContracts.registry).resetMember(0, newGovernor);
        MultiRole(multiroleContracts.store).resetMember(0, newGovernor);
    }
}

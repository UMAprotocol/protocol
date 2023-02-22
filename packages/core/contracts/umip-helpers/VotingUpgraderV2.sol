// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

import "../data-verification-mechanism/implementation/Finder.sol";
import "../data-verification-mechanism/implementation/Constants.sol";
import "../data-verification-mechanism/implementation/Voting.sol";

import "../common/implementation/MultiRole.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

// Ownable contracts to transfer ownership of
struct OwnableContracts {
    Ownable identifierWhitelist;
    Ownable financialContractsAdmin;
    Ownable addressWhitelist;
    Ownable governorRootTunnel;
    Ownable arbitrumParentMessenger;
    Ownable oracleHub;
    Ownable governorHub;
    Ownable bobaParentMessenger;
    Ownable optimismParentMessenger;
    Ownable optimisticOracleV3;
}

// Multirole contracts to transfer ownership of
struct MultiroleContracts {
    MultiRole registry;
    MultiRole store;
}

/**
 * @title A contract that executes a short series of upgrade calls that must be performed atomically as a part of the
 * upgrade process for VotingV2.sol, GovernorV2.sol and ProposerV2.sol.
 * @dev Note: the complete upgrade process requires more than just the transactions in this contract. These are only
 * the ones that need to be performed atomically.
 */
contract VotingUpgraderV2 {
    // The only one who can initiate the upgrade.
    address public immutable upgrader;

    // Existing governor is the only one who can initiate the upgrade.
    MultiRole public immutable existingGovernor;

    // New governor contract, set to be the UMA DVM owner post upgrade.
    address public immutable newGovernor;

    // Existing Voting contract needs to be informed of the address of the new Voting contract.
    Voting public immutable existingVoting;

    // New governor will be the new owner of the finder.

    // Finder contract to push upgrades to.
    Finder public immutable finder;

    // Address to upgrade to.
    address public immutable newVoting;

    // Proposer contract.
    Ownable public immutable existingProposer;

    // Additional ownable contracts to transfer ownership of.
    OwnableContracts public ownableContracts;

    // Additional multirole contracts to transfer ownership of.
    MultiroleContracts public multiroleContracts;

    /**
     * @notice Constructs the voting upgrader to upgrade to the DVM V2. This upgrades the voting, governor and proposer
     *  contracts.
     * @param _existingGovernor the existing Governor contract address.
     * @param _newGovernor the new Governor contract address.
     * @param _existingVoting the current/existing Voting contract address.
     * @param _newVoting the new Voting deployment address.
     * @param _finder the Finder contract address.
     * @param _ownableContracts additional ownable contracts to transfer ownership of.
     * @param _multiroleContracts additional multirole contracts to transfer ownership of.
     */
    constructor(
        address _upgrader,
        address _existingGovernor,
        address _newGovernor,
        address _existingVoting,
        address _newVoting,
        address _existingProposer,
        address _finder,
        OwnableContracts memory _ownableContracts,
        MultiroleContracts memory _multiroleContracts
    ) {
        upgrader = _upgrader;
        existingGovernor = MultiRole(_existingGovernor);
        newGovernor = _newGovernor;
        existingVoting = Voting(_existingVoting);
        newVoting = _newVoting;
        existingProposer = Ownable(_existingProposer);
        finder = Finder(_finder);
        ownableContracts = _ownableContracts;
        multiroleContracts = _multiroleContracts;
    }

    /**
     * @notice Checks if the caller is the upgrader.
     * @dev This is used as the first transaction in the upgrade process to block any other transactions from being
     * executed if the upgrade is not initiated by the upgrader.
     */
    function canRun() public view {
        require(tx.origin == upgrader);
    }

    /**
     * @notice Performs the atomic portion of the upgrade process.
     * @dev This method updates the Voting address in the finder, sets the old voting contract to migrated state, and
     * transfers the required ownership of the contracts to GovernorV2.
     */
    function upgrade() external {
        require(msg.sender == address(existingGovernor), "Upgrade can only be initiated by the existing governor.");

        // Change the addresses in the Finder.
        finder.changeImplementationAddress(OracleInterfaces.Oracle, newVoting);

        // Set the preset "migrated" address to allow this address to claim rewards on voters' behalf.
        // This also effectively shuts down the existing voting contract so new votes cannot be triggered.
        existingVoting.setMigrated(newVoting);

        // Transfer back ownership of old voting contract and the finder to the governor.
        existingVoting.transferOwnership(newGovernor);
        finder.transferOwnership(newGovernor);

        // Transfer ownership of existingProposer contract to the new governor.
        existingProposer.transferOwnership(newGovernor);

        // Additional ownable contracts
        ownableContracts.identifierWhitelist.transferOwnership(newGovernor);
        ownableContracts.financialContractsAdmin.transferOwnership(newGovernor);
        ownableContracts.addressWhitelist.transferOwnership(newGovernor);
        ownableContracts.governorRootTunnel.transferOwnership(newGovernor);
        ownableContracts.arbitrumParentMessenger.transferOwnership(newGovernor);
        ownableContracts.oracleHub.transferOwnership(newGovernor);
        ownableContracts.governorHub.transferOwnership(newGovernor);
        ownableContracts.bobaParentMessenger.transferOwnership(newGovernor);
        ownableContracts.optimismParentMessenger.transferOwnership(newGovernor);
        ownableContracts.optimisticOracleV3.transferOwnership(newGovernor);

        // Set the new governor as the owner of the old governor
        existingGovernor.resetMember(0, newGovernor);

        // Set governor as the owner of governor
        MultiRole(newGovernor).resetMember(0, newGovernor);

        // Additional multirole contracts
        multiroleContracts.registry.resetMember(0, newGovernor);
        multiroleContracts.store.resetMember(0, newGovernor);
    }
}

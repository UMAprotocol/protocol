pragma solidity ^0.6.0;

import "../oracle/implementation/Finder.sol";
import "../oracle/implementation/Constants.sol";


/**
 * @title A contract to track a whitelist of addresses.
 */
contract Umip3Upgrader {
    // Existing governor is the only one who can initiate the upgrade.
    address public existingGovernor;

    // New governor will be the new owner of the finder.
    address public newGovernor;

    // Finder contract to push upgrades to.
    Finder public finder;

    // Addresses to upgrade.
    address public voting;
    address public identifierWhitelist;
    address public store;
    address public financialContractsAdmin;
    address public registry;

    constructor(
        address _existingGovernor,
        address _finder,
        address _voting,
        address _identifierWhitelist,
        address _store,
        address _financialContractsAdmin,
        address _registry,
        address _newGovernor
    ) public {
        existingGovernor = _existingGovernor;
        finder = Finder(_finder);
        voting = _voting;
        identifierWhitelist = _identifierWhitelist;
        store = _store;
        financialContractsAdmin = _financialContractsAdmin;
        registry = _registry;
        newGovernor = _newGovernor;
    }

    function upgrade() external {
        require(msg.sender == existingGovernor, "Upgrade can only be initiated by the existing governor.");
        finder.changeImplementationAddress(OracleInterfaces.Oracle, voting);
        finder.changeImplementationAddress(OracleInterfaces.IdentifierWhitelist, identifierWhitelist);
        finder.changeImplementationAddress(OracleInterfaces.Store, store);
        finder.changeImplementationAddress(OracleInterfaces.FinancialContractsAdmin, financialContractsAdmin);
        finder.changeImplementationAddress(OracleInterfaces.Registry, registry);
        finder.transferOwnership(newGovernor);
    }
}
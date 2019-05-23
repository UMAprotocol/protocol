pragma solidity ^0.5.0;

import "./AdminInterface.sol";
import "./MultiRole.sol";


/**
 * @title Admin for financial contracts in the UMA system.
 * @dev Allows appropriately permissioned admin roles to interact with financial contracts.
 */
contract FinancialContractsAdmin is MultiRole {

    enum Roles {
        // Can set the `Remargin` and `EmergencyShutdown` roles.
        Governance,
        // Is authorized to call `remargin()` on any financial contract in the system.
        Remargin,
        // Is authorized to shutdown any financial contract in the system.
        EmergencyShutdown
    }

    bool private rolesInitialized;

    constructor() public {
        initializeRolesOnce();
    }

    /**
     * @dev Calls emergency shutdown on the provided financial contract.
     */
    function callEmergencyShutdown(address financialContract) external onlyRoleHolder(uint(Roles.EmergencyShutdown)) {
        AdminInterface admin = AdminInterface(financialContract);
        admin.emergencyShutdown();
    }

    /**
     * @dev Calls remargin on the provided financial contract.
     */
    function callRemargin(address financialContract) external onlyRoleHolder(uint(Roles.Remargin)) {
        AdminInterface admin = AdminInterface(financialContract);
        admin.remargin();
    }

    /*
     * @notice Do not call this function externally.
     * @dev Only called from the constructor, and only extracted to a separate method to make the coverage tool work.
     * Will revert if called again.
     */
    function initializeRolesOnce() public {
        require(!rolesInitialized, "Only the constructor should call this method");
        rolesInitialized = true;
        _createExclusiveRole(uint(Roles.Governance), uint(Roles.Governance), msg.sender);
        _createExclusiveRole(uint(Roles.Remargin), uint(Roles.Governance), msg.sender);
        _createExclusiveRole(uint(Roles.EmergencyShutdown), uint(Roles.Governance), msg.sender);
    }
}

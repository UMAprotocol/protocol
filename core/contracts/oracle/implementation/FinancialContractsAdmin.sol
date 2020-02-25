pragma solidity ^0.5.0;

import "../interfaces/AdministrateeInterface.sol";
import "@openzeppelin/contracts/ownership/Ownable.sol";

/**
 * @title Admin for financial contracts in the UMA system.
 * @dev Allows appropriately permissioned admin roles to interact with financial contracts.
 */
contract FinancialContractsAdmin is Ownable {
    /**
     * @dev Calls emergency shutdown on the provided financial contract.
     */
    function callEmergencyShutdown(address financialContract) external onlyOwner {
        AdministrateeInterface administratee = AdministrateeInterface(financialContract);
        administratee.emergencyShutdown();
    }

    /**
     * @dev Calls remargin on the provided financial contract.
     */
    function callRemargin(address financialContract) external onlyOwner {
        AdministrateeInterface administratee = AdministrateeInterface(financialContract);
        administratee.remargin();
    }
}

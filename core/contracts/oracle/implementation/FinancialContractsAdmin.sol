pragma solidity ^0.5.0;

import "../interfaces/AdministrateeInterface.sol";
import "@openzeppelin/contracts/ownership/Ownable.sol";

/**
 * @title Admin for financial contracts in the UMA system.
 * @dev Allows appropriately permissioned admin roles to interact with financial contracts.
 */
contract FinancialContractsAdmin is Ownable {
    /**
     * @notice Calls emergency shutdown on the provided financial contract.
     * @param financialContract address of the FinancialContract to be shut down.
     */
    function callEmergencyShutdown(address financialContract) external onlyOwner {
        AdministrateeInterface administratee = AdministrateeInterface(financialContract);
        administratee.emergencyShutdown();
    }

    /**
     * @notice Calls remargin on the provided financial contract.
     * @param financialContract address of the FinancialContract to be remargined.
     */
    function callRemargin(address financialContract) external onlyOwner {
        AdministrateeInterface administratee = AdministrateeInterface(financialContract);
        administratee.remargin();
    }
}

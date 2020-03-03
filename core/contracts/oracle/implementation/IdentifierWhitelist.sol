pragma solidity ^0.5.0;

import "../interfaces/IdentifierWhitelistInterface.sol";
import "@openzeppelin/contracts/ownership/Ownable.sol";

/**
 * @title Stores a whitelist of supported identifiers that the oracle can provide prices for.
 */
contract IdentifierWhitelist is IdentifierWhitelistInterface, Ownable {
    /****************************************
     *     INTERNAL VARIABLES AND STORAGE   *
     ****************************************/

    mapping(bytes32 => bool) private supportedIdentifiers;

    /****************************************
     *                EVENTS                *
     ****************************************/

    event SupportedIdentifierAdded(bytes32 indexed identifier);
    event SupportedIdentifierRemoved(bytes32 indexed identifier);

    /****************************************
     *    ADMIN STATE MODIFYING FUNCTIONS   *
     ****************************************/

    /**
     * @notice Adds the provided identifier as a supported identifier.
     * @dev Price requests using this identifier will be succeed after this call.
     * @param identifier uniquely identifies added the identifier. Eg: BTC/UCD.
     */
    function addSupportedIdentifier(bytes32 identifier) external onlyOwner {
        if (!supportedIdentifiers[identifier]) {
            supportedIdentifiers[identifier] = true;
            emit SupportedIdentifierAdded(identifier);
        }
    }

    /**
     * @notice Removes the identifier from the whitelist.
     * @dev Price requests using this identifier will no longer succeed after this call.
     * @param identifier uniquely identifies added the identifier. Eg: BTC/UCD.
     */
    function removeSupportedIdentifier(bytes32 identifier) external onlyOwner {
        if (supportedIdentifiers[identifier]) {
            supportedIdentifiers[identifier] = false;
            emit SupportedIdentifierRemoved(identifier);
        }
    }

    /****************************************
     *     WHITELIST GETTERS FUNCTIONS      *
     ****************************************/

    /**
     * @notice Checks whether an identifier is on the whitelist.
     * @param identifier uniquely identifies added the identifier. Eg: BTC/UCD.
     * @return bool if the identifier is supported (or not).
     */
    function isIdentifierSupported(bytes32 identifier) external view returns (bool) {
        return supportedIdentifiers[identifier];
    }
}

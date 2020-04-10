pragma solidity ^0.6.0;

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
    // TODO(#969) Remove once prettier-plugin-solidity can handle the "override" keyword
    // prettier-ignore
    function addSupportedIdentifier(bytes32 identifier) external override onlyOwner {
        require(!supportedIdentifiers[identifier], "Can only add a new identifer");
        supportedIdentifiers[identifier] = true;
        emit SupportedIdentifierAdded(identifier);
    }

    /**
     * @notice Removes the identifier from the whitelist.
     * @dev Price requests using this identifier will no longer succeed after this call.
     * @param identifier uniquely identifies added the identifier. Eg: BTC/UCD.
     */
    // TODO(#969) Remove once prettier-plugin-solidity can handle the "override" keyword
    // prettier-ignore
    function removeSupportedIdentifier(bytes32 identifier) external override onlyOwner {
        require(supportedIdentifiers[identifier], "Can only remove an existing identifer");
        supportedIdentifiers[identifier] = false;
        emit SupportedIdentifierRemoved(identifier);
    }

    /****************************************
     *     WHITELIST GETTERS FUNCTIONS      *
     ****************************************/

    /**
     * @notice Checks whether an identifier is on the whitelist.
     * @param identifier uniquely identifies added the identifier. Eg: BTC/UCD.
     * @return bool if the identifier is supported (or not).
     */
    // TODO(#969) Remove once prettier-plugin-solidity can handle the "override" keyword
    // prettier-ignore
    function isIdentifierSupported(bytes32 identifier) external override view returns (bool) {
        return supportedIdentifiers[identifier];
    }
}

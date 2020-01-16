pragma solidity ^0.5.0;

import "@openzeppelin/contracts/ownership/Ownable.sol";

/**
 * @title A contract to track a whitelist of supported identifiers that the oracle can provide prices for.
 */
contract IdentifierWhitelist is Ownable {
    mapping(bytes32 => bool) private supportedIdentifiers;

    event SupportedIdentifierAdded(bytes32 indexed identifier);
    event SupportedIdentifierRemoved(bytes32 indexed identifier);

    /**
     * @notice Adds the provided identifier as a supported identifier. Price requests using this identifier will be
     * succeed after this call.
     */
    function addSupportedIdentifier(bytes32 identifier) external onlyOwner {
        if (!supportedIdentifiers[identifier]) {
            supportedIdentifiers[identifier] = true;
            emit SupportedIdentifierAdded(identifier);
        }
    }

    /**
     * @notice Removes the identifier from the whitelist. Price requests using this identifier will no longer succeed
     * after this call.
     */
    function removeSupportedIdentifier(bytes32 identifier) external onlyOwner {
        if (supportedIdentifiers[identifier]) {
            supportedIdentifiers[identifier] = false;
            emit SupportedIdentifierRemoved(identifier);
        }
    }

    /**
     * @notice Checks whether an identifier is on the whitelist.
     */
    function isIdentifierSupported(bytes32 identifier) external view returns (bool) {
        return supportedIdentifiers[identifier];
    }
}

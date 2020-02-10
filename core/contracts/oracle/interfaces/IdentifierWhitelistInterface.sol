pragma solidity ^0.5.0;

pragma experimental ABIEncoderV2;

/**
 * @title Interface for whitelists of supported identifiers that the oracle can provide prices for.
 */
interface IdentifierWhitelistInterface {
    /**
     * @notice Adds the provided identifier as a supported identifier. Price requests using this identifier will be
     * succeed after this call.
     */
    function addSupportedIdentifier(bytes32 identifier) external;

    /**
     * @notice Removes the identifier from the whitelist. Price requests using this identifier will no longer succeed
     * after this call.
     */
    function removeSupportedIdentifier(bytes32 identifier) external;

    /**
     * @notice Checks whether an identifier is on the whitelist.
     */
    function isIdentifierSupported(bytes32 identifier) external view returns (bool);
}

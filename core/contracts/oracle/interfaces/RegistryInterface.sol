pragma solidity ^0.5.0;

pragma experimental ABIEncoderV2;

/**
 * @title Interface for a registry of derivatives and derivative creators.
 */
interface RegistryInterface {
    /**
     * @notice Registers a new derivative.
     * @dev Only authorized derivative creators can call this method.
     * @param parties an array of addresses who become party members to a derivative.
     * @param derivativeAddress defines the address of the deployed derivative.
     */
    function registerDerivative(address[] calldata parties, address derivativeAddress) external;

    /**
     * @notice Returns whether the derivative has been registered with the registry.
     * @dev If it is registered, it is an authorized participant in the UMA system.
     * @param derivative address of the derivative contract.
     * @return bool indicates whether the derivative is registered.
     */
    function isDerivativeRegistered(address derivative) external view returns (bool isRegistered);

    /**
     * @notice Returns a list of all derivatives that are associated with a particular party.
     * @param party address of the party.
     * @return an array of the derivatives the party is registered to.
     */
    function getRegisteredDerivatives(address party) external view returns (address[] memory derivatives);

    /**
     * @notice Returns all registered derivatives.
     * @return all registered derivative addresses within the system.
     */
    function getAllRegisteredDerivatives() external view returns (address[] memory derivatives);

    /**
     * @notice Adds a party member to the calling derivative.
     * @dev msg.sender must be the derivative contract to which the party member is added.
     * @param party address to be added to the derivatives.
     */
    function addPartyToDerivative(address party) external;

    /**
     * @notice Removes a party member to the calling derivative.
     * @dev msg.sender must be the derivative contract to which the party member is added.
     * @param party address to be removed to the derivatives.
     */
    function removePartyFromDerivative(address party) external;

    /**
     * @notice checks if a party member is part of a derivative.
     * @param party party to check.
     * @param derivativeAddress address to check against the party.
     * @return bool indicating if the address is a party of the derivative.
     */
    function isPartyMemberOfDerivative(address party, address derivativeAddress) external view returns (bool);
}

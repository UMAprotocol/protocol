pragma solidity ^0.5.0;

pragma experimental ABIEncoderV2;


/**
 * @title Interface for a registry of derivatives and derivative creators
 */
interface RegistryInterface {
    struct RegisteredDerivative {
        address derivativeAddress;
        address derivativeCreator;
    }

    /**
     * @dev Registers a new derivative. Only authorized derivative creators can call this method.
     */
    function registerDerivative(address[] calldata counterparties, address derivativeAddress) external;

    /**
     * @dev Returns whether the derivative has been registered with the registry (and is therefore an authorized
     * participant in the UMA system).
     */
    function isDerivativeRegistered(address derivative) external view returns (bool isRegistered);

    /**
     * @dev Returns a list of all derivatives that are associated with a particular party.
     */
    function getRegisteredDerivatives(address party) external view returns (RegisteredDerivative[] memory derivatives);

    /**
     * @dev Returns all registered derivatives.
     */
    function getAllRegisteredDerivatives() external view returns (RegisteredDerivative[] memory derivatives);
}

/*
  Registry Interface
*/
pragma solidity ^0.5.0;

pragma experimental ABIEncoderV2;


interface RegistryInterface {
    struct RegisteredDerivative {
        address derivativeAddress;
        address derivativeCreator;
    }

    // Registers a new derivative. Only authorized derivative creators can call this method.
    function registerDerivative(address[] calldata counterparties, address derivativeAddress) external;

    // Adds a new derivative creator to this list of authorized creators. Only the owner of this contract can call
    // this method.   
    function addDerivativeCreator(address derivativeCreator) external;

    // Removes a derivative creator to this list of authorized creators. Only the owner of this contract can call this
    // method.  
    function removeDerivativeCreator(address derivativeCreator) external;

    // Returns whether the derivative has been registered with the registry (and is therefore an authorized participant
    // in the UMA system).
    function isDerivativeRegistered(address derivative) external view returns (bool isRegistered);

    // Returns a list of all derivatives that are associated with a particular party.
    function getRegisteredDerivatives(address party) external view returns (RegisteredDerivative[] memory derivatives);

    // Returns all registered derivatives.
    function getAllRegisteredDerivatives() external view returns (RegisteredDerivative[] memory derivatives);

    // Returns whether an address is authorized to register new derivatives.
    function isDerivativeCreatorAuthorized(address derivativeCreator) external view returns (bool isAuthorized);
}
